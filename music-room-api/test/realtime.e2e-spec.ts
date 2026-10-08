import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { io, Socket } from 'socket.io-client';
import { PrismaClient } from '../generated/prisma';
import { MailService } from '../src/mail/mail.service';
import { GoogleProvider } from '../src/auth/social/google.provider';
import { FacebookProvider } from '../src/auth/social/facebook.provider';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';

// Every run creates and drops ONLY its own random schema (same pattern as auth-users.e2e-spec.ts)
const schema = `musicroom_test_${randomUUID().replace(/-/g, '')}`;
const ACCESS_SECRET = 'e2e-access-secret';
const verification = new Map<string, string>();
const jwt = new JwtService();
const sockets: Socket[] = [];
let app: INestApplication;
let admin: PrismaClient;
let base: string;
let schemaCreated = false;
let throttling: jest.SpyInstance;

async function request(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function account() {
  const email = `${randomUUID()}@example.com`;
  const password = 'Test-password-123!';
  const registered = await request('POST', '/auth/register', { email, password, name: 'Listener' });
  expect(registered.status).toBe(201);
  const verificationToken = verification.get(email)!;
  expect((await request('GET', `/auth/verify-email?token=${verificationToken}`)).status).toBe(200);
  const login = await request('POST', '/auth/login', { email, password });
  expect(login.status).toBe(201);
  return {
    id: registered.body.id as string,
    accessToken: login.body.accessToken as string,
    refreshToken: login.body.refreshToken as string,
    verificationToken,
  };
}

async function party(ownerToken: string, visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC'): Promise<string> {
  const created = await request('POST', '/parties', { name: 'Realtime test', visibility }, ownerToken);
  expect(created.status).toBe(201);
  return created.body.id;
}

// Sends a message and waits for the server's acknowledgement (fails after 3 s without one)
const send = (socket: Socket, event: string, ...args: unknown[]) => socket.timeout(3000).emitWithAck(event, ...args);

const watch = (socket: Socket, id: string) => send(socket, 'subscribe', { type: 'party', id });

// How many connections the server currently has in a party's room
const watchers = (id: string) => app.get(RealtimeGateway).server.sockets.adapter.rooms.get(`party:${id}`)?.size ?? 0;

const refusal = (code: string) => ({ ok: false, error: { code, message: expect.any(String) } });

// Resolves with the connected socket, or rejects with the server's refusal message
function connect(options: Parameters<typeof io>[1] = {}): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(base, { transports: ['websocket'], reconnection: false, forceNew: true, ...options });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => reject(error));
  });
}

// The claims of a real access token, re-signed with other options to build invalid variants
function claims(accessToken: string) {
  const { sub, email, sid, type } = jwt.decode(accessToken) as Record<string, string>;
  return { sub, email, sid, type };
}
const inSeconds = (seconds: number) => Math.floor(Date.now() / 1000) + seconds;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required; tests use a disposable schema within this database.');
  const url = new URL(process.env.TEST_DATABASE_URL);
  admin = new PrismaClient({ datasources: { db: { url: url.href } } });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  url.searchParams.set('schema', schema);
  Object.assign(process.env, {
    DATABASE_URL: url.href,
    JWT_ACCESS_SECRET: ACCESS_SECRET, JWT_REFRESH_SECRET: 'e2e-refresh-secret',
    JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '7d', GOOGLE_AUTH_ENABLED: 'false',
  });
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    env: process.env, stdio: 'pipe', timeout: 60000,
  });

  // Load the module only after the test environment is configured.
  const { AppModule } = await import('../src/app.module');
  throttling = jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
  const testModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService).useValue({
      sendVerificationEmail: async (email: string, token: string) => { verification.set(email, token); },
      sendPasswordResetEmail: async () => undefined,
    })
    .overrideProvider(GoogleProvider).useValue({ verify: jest.fn() })
    .overrideProvider(FacebookProvider).useValue({ verify: jest.fn() })
    .compile();
  app = testModule.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.disconnect();
});

afterAll(async () => {
  if (app) await app.close();
  throttling?.mockRestore();
  if (schemaCreated) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  if (admin) await admin.$disconnect();
});

describe('Realtime connection: only a valid login gets in', () => {
  it('accepts a valid access token sent in the handshake auth', async () => {
    const { accessToken } = await account();
    const socket = await connect({ auth: { token: accessToken } });
    expect(socket.connected).toBe(true);
  });

  it('accepts a valid access token sent as an Authorization header', async () => {
    const { accessToken } = await account();
    const socket = await connect({ extraHeaders: { Authorization: `Bearer ${accessToken}` } });
    expect(socket.connected).toBe(true);
  });

  it('also works over HTTP long-polling, the fallback when WebSocket is blocked', async () => {
    const { accessToken } = await account();
    const socket = await connect({ transports: ['polling'], auth: { token: accessToken } });
    expect(socket.connected).toBe(true);
  });

  it.each([
    ['no token at all', () => ({})],
    ['an empty token', () => ({ auth: { token: '' } })],
    ['a token that is not a JWT', () => ({ auth: { token: 'not-a-token' } })],
    ['a token that is a number', () => ({ auth: { token: 12345 } })],
    ['a token that is an object', () => ({ auth: { token: { sub: 'x' } } })],
    ['a token that is a list', () => ({ auth: { token: ['a', 'b'] } })],
    ['an oversized token', () => ({ auth: { token: 'a'.repeat(5000) } })],
    ['a header without the Bearer prefix', () => ({ extraHeaders: { Authorization: 'not-a-token' } })],
  ])('refuses %s', async (_label, options) => {
    await expect(connect(options())).rejects.toThrow('Unauthorized');
  });

  it.each([
    ['signed with another secret', (c: object) => jwt.sign({ ...c, exp: inSeconds(60) }, { secret: 'attacker-secret', algorithm: 'HS256' })],
    ['that is already expired', (c: object) => jwt.sign({ ...c, exp: inSeconds(-60) }, { secret: ACCESS_SECRET, algorithm: 'HS256' })],
    ['signed with another algorithm', (c: object) => jwt.sign({ ...c, exp: inSeconds(60) }, { secret: ACCESS_SECRET, algorithm: 'HS512' })],
    ['with no signature (alg none)', (c: object) => jwt.sign({ ...c, exp: inSeconds(60) }, { secret: '', algorithm: 'none' })],
    ['without an expiry', (c: object) => jwt.sign({ ...c }, { secret: ACCESS_SECRET, algorithm: 'HS256' })],
    ['for a session that does not exist', (c: object) => jwt.sign({ ...c, sid: randomUUID(), exp: inSeconds(60) }, { secret: ACCESS_SECRET, algorithm: 'HS256' })],
    ['for another user than its session', (c: object) => jwt.sign({ ...c, sub: randomUUID(), exp: inSeconds(60) }, { secret: ACCESS_SECRET, algorithm: 'HS256' })],
    ['of the wrong type', (c: object) => jwt.sign({ ...c, type: 'refresh', exp: inSeconds(60) }, { secret: ACCESS_SECRET, algorithm: 'HS256' })],
  ])('refuses a token %s', async (_label, forge) => {
    const { accessToken } = await account();
    await expect(connect({ auth: { token: forge(claims(accessToken)) } })).rejects.toThrow('Unauthorized');
  });

  it('refuses the refresh token and the email verification token of a real account', async () => {
    const { refreshToken, verificationToken } = await account();
    await expect(connect({ auth: { token: refreshToken } })).rejects.toThrow('Unauthorized');
    await expect(connect({ auth: { token: verificationToken } })).rejects.toThrow('Unauthorized');
  });

  it('refuses an access token after logout, even though it has not expired', async () => {
    const { accessToken } = await account();
    await connect({ auth: { token: accessToken } });
    expect((await request('POST', '/auth/logout', {}, accessToken)).status).toBe(201);
    await expect(connect({ auth: { token: accessToken } })).rejects.toThrow('Unauthorized');
  });

  it('closes the connection at the moment the access token expires', async () => {
    const { accessToken } = await account();
    const shortLived = jwt.sign({ ...claims(accessToken), exp: inSeconds(2) }, { secret: ACCESS_SECRET, algorithm: 'HS256' });
    const socket = await connect({ auth: { token: shortLived } });
    const events: string[] = [];
    socket.on('session:expired', () => events.push('session:expired'));

    const reason = await new Promise((resolve) => socket.once('disconnect', resolve));

    expect(events).toEqual(['session:expired']);
    expect(reason).toBe('io server disconnect');
  }, 10000);

  it('keeps accepting valid logins after a burst of refused ones', async () => {
    const { accessToken } = await account();
    const refused = await Promise.allSettled(Array.from({ length: 20 }, () => connect({ auth: { token: 'garbage' } })));
    expect(refused.every((result) => result.status === 'rejected')).toBe(true);
    expect((await connect({ auth: { token: accessToken } })).connected).toBe(true);
  });
});

describe('Realtime subscriptions: who may watch a party', () => {
  it('lets any logged-in user watch a public party', async () => {
    const owner = await account();
    const stranger = await account();
    const id = await party(owner.accessToken);
    const socket = await connect({ auth: { token: stranger.accessToken } });

    expect(await watch(socket, id)).toEqual({ ok: true });
    expect(watchers(id)).toBe(1);
  });

  it('lets the owner watch their private party', async () => {
    const owner = await account();
    const id = await party(owner.accessToken, 'PRIVATE');
    const socket = await connect({ auth: { token: owner.accessToken } });

    expect(await watch(socket, id)).toEqual({ ok: true });
    expect(watchers(id)).toBe(1);
  });

  it('refuses a private party to someone who is not invited', async () => {
    const owner = await account();
    const stranger = await account();
    const id = await party(owner.accessToken, 'PRIVATE');
    const socket = await connect({ auth: { token: stranger.accessToken } });

    expect(await watch(socket, id)).toEqual(refusal('FORBIDDEN'));
    expect(watchers(id)).toBe(0);
  });

  it('follows an invitation through its whole life: pending, accepted, revoked', async () => {
    const owner = await account();
    const guest = await account();
    const id = await party(owner.accessToken, 'PRIVATE');
    const socket = await connect({ auth: { token: guest.accessToken } });
    expect(await watch(socket, id)).toEqual(refusal('FORBIDDEN'));

    const invitation = await request('POST', `/parties/${id}/invite`, { userId: guest.id }, owner.accessToken);
    expect(invitation.status).toBe(201);
    expect(await watch(socket, id)).toEqual({ ok: true });
    expect(await send(socket, 'unsubscribe', { type: 'party', id })).toEqual({ ok: true });

    expect((await request('POST', `/invitations/${invitation.body.id}/accept`, {}, guest.accessToken)).status).toBe(201);
    expect(await watch(socket, id)).toEqual({ ok: true });
    expect(await send(socket, 'unsubscribe', { type: 'party', id })).toEqual({ ok: true });

    expect((await request('DELETE', `/parties/${id}/invitations/${guest.id}`, undefined, owner.accessToken)).status).toBe(200);
    expect(await watch(socket, id)).toEqual(refusal('FORBIDDEN'));
    expect(watchers(id)).toBe(0);
  });

  it('refuses a private party after the invitation was declined', async () => {
    const owner = await account();
    const guest = await account();
    const id = await party(owner.accessToken, 'PRIVATE');
    const invitation = await request('POST', `/parties/${id}/invite`, { userId: guest.id }, owner.accessToken);
    expect((await request('POST', `/invitations/${invitation.body.id}/decline`, {}, guest.accessToken)).status).toBe(201);
    const socket = await connect({ auth: { token: guest.accessToken } });

    expect(await watch(socket, id)).toEqual(refusal('FORBIDDEN'));
  });

  it('answers NOT_FOUND for a party that does not exist', async () => {
    const { accessToken } = await account();
    const socket = await connect({ auth: { token: accessToken } });

    expect(await watch(socket, randomUUID())).toEqual(refusal('NOT_FOUND'));
  });
});

describe('Realtime subscriptions: what a client may send', () => {
  const id = randomUUID();

  it.each([
    ['nothing', []],
    ['null', [null]],
    ['a string', ['party']],
    ['a number', [42]],
    ['a list', [[{ type: 'party', id }]]],
    ['an empty object', [{}]],
    ['no id', [{ type: 'party' }]],
    ['no type', [{ id }]],
    ['a type that cannot be watched', [{ type: 'user', id }]],
    ['a type that is not text', [{ type: ['party'], id }]],
    ['an id that is not a UUID', [{ type: 'party', id: 'abc' }]],
    ['an id that is not text', [{ type: 'party', id: { $ne: null } }]],
    ['an extra field', [{ type: 'party', id, admin: true }]],
    ['two arguments', [{ type: 'party', id }, { type: 'party', id }]],
  ])('refuses %s with BAD_REQUEST, for subscribe and unsubscribe', async (_label, args) => {
    const { accessToken } = await account();
    const socket = await connect({ auth: { token: accessToken } });

    expect(await send(socket, 'subscribe', ...args)).toEqual(refusal('BAD_REQUEST'));
    expect(await send(socket, 'unsubscribe', ...args)).toEqual(refusal('BAD_REQUEST'));
    expect(socket.connected).toBe(true);
  });

  it('stays connected and usable after messages it does not understand', async () => {
    const owner = await account();
    const partyId = await party(owner.accessToken);
    const socket = await connect({ auth: { token: owner.accessToken } });

    socket.emit('subscribe');
    socket.emit('no-such-event', { anything: true });
    socket.emit('subscribe', 'x'.repeat(2000));

    expect(await watch(socket, partyId)).toEqual({ ok: true });
  });
});

describe('Realtime subscriptions: joining and leaving', () => {
  it('counts a repeated subscription once', async () => {
    const owner = await account();
    const id = await party(owner.accessToken);
    const socket = await connect({ auth: { token: owner.accessToken } });

    expect(await watch(socket, id)).toEqual({ ok: true });
    expect(await watch(socket, id)).toEqual({ ok: true });
    expect(watchers(id)).toBe(1);
  });

  it('keeps two connections of the same user separate', async () => {
    const owner = await account();
    const id = await party(owner.accessToken);
    const phone = await connect({ auth: { token: owner.accessToken } });
    const tablet = await connect({ auth: { token: owner.accessToken } });

    await watch(phone, id);
    await watch(tablet, id);
    expect(watchers(id)).toBe(2);
    await send(phone, 'unsubscribe', { type: 'party', id });
    expect(watchers(id)).toBe(1);
  });

  it('unsubscribes, and accepts an unsubscribe from a party it was not watching', async () => {
    const owner = await account();
    const id = await party(owner.accessToken);
    const socket = await connect({ auth: { token: owner.accessToken } });
    await watch(socket, id);

    expect(await send(socket, 'unsubscribe', { type: 'party', id })).toEqual({ ok: true });
    expect(watchers(id)).toBe(0);
    expect(await send(socket, 'unsubscribe', { type: 'party', id })).toEqual({ ok: true });
    expect(await send(socket, 'unsubscribe', { type: 'party', id: randomUUID() })).toEqual({ ok: true });
  });

  it('leaves every room when the connection closes', async () => {
    const owner = await account();
    const id = await party(owner.accessToken);
    const socket = await connect({ auth: { token: owner.accessToken } });
    await watch(socket, id);
    expect(watchers(id)).toBe(1);

    socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(watchers(id)).toBe(0);
  });

  it('leaves no trace when the client disconnects while its subscription is being checked', async () => {
    const owner = await account();
    const id = await party(owner.accessToken);
    const socket = await connect({ auth: { token: owner.accessToken } });

    socket.emit('subscribe', { type: 'party', id });
    socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(watchers(id)).toBe(0);
  });

  it('allows 20 subscriptions per connection, refuses the 21st, and frees a place on unsubscribe', async () => {
    const owner = await account();
    const ids: string[] = [];
    for (let i = 0; i < 21; i++) ids.push(await party(owner.accessToken));
    const socket = await connect({ auth: { token: owner.accessToken } });

    for (const id of ids.slice(0, 20)) expect(await watch(socket, id)).toEqual({ ok: true });
    expect(await watch(socket, ids[20])).toEqual(refusal('TOO_MANY'));
    expect(await watch(socket, ids[0])).toEqual({ ok: true });

    expect(await send(socket, 'unsubscribe', { type: 'party', id: ids[0] })).toEqual({ ok: true });
    expect(await watch(socket, ids[20])).toEqual({ ok: true });
  });

  it('holds the limit when many subscriptions arrive at the same moment', async () => {
    const owner = await account();
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push(await party(owner.accessToken));
    const socket = await connect({ auth: { token: owner.accessToken } });

    const answers = await Promise.all(ids.map((id) => watch(socket, id)));

    expect(answers.filter((answer) => answer.ok)).toHaveLength(20);
    expect(answers.filter((answer) => !answer.ok)).toEqual(Array(5).fill(refusal('TOO_MANY')));
    expect(ids.reduce((total, id) => total + watchers(id), 0)).toBe(20);
  });
});

describe('Realtime subscriptions: a logout reaches an open connection', () => {
  it('refuses a subscription after logout and closes the connection', async () => {
    const owner = await account();
    const id = await party(owner.accessToken);
    const socket = await connect({ auth: { token: owner.accessToken } });
    const events: string[] = [];
    socket.on('session:expired', () => events.push('session:expired'));
    const closed = new Promise((resolve) => socket.once('disconnect', resolve));

    expect((await request('POST', '/auth/logout', {}, owner.accessToken)).status).toBe(201);

    expect(await watch(socket, id)).toEqual(refusal('UNAUTHORIZED'));
    expect(await closed).toBe('io server disconnect');
    expect(events).toEqual(['session:expired']);
    expect(watchers(id)).toBe(0);
  });

  it('does not disturb another user when someone logs out', async () => {
    const leaving = await account();
    const staying = await account();
    const id = await party(staying.accessToken);
    const socket = await connect({ auth: { token: staying.accessToken } });

    expect((await request('POST', '/auth/logout', {}, leaving.accessToken)).status).toBe(201);

    expect(await watch(socket, id)).toEqual({ ok: true });
    expect(socket.connected).toBe(true);
  });
});
