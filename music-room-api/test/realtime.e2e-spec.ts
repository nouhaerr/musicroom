import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
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
import { PartiesService } from '../src/parties/parties.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Every run creates and drops ONLY its own random schema (same pattern as auth-users.e2e-spec.ts)
const schema = `musicroom_test_${randomUUID().replace(/-/g, '')}`;
const ACCESS_SECRET = 'e2e-access-secret';
const verification = new Map<string, string>();
const jwt = new JwtService();
const sockets: Socket[] = [];
const spies: jest.SpyInstance[] = [];
const realFetch = global.fetch;
let app: INestApplication;
let admin: PrismaClient;
let base: string;
let schemaCreated = false;
let throttling: jest.SpyInstance;
let deezer: jest.SpyInstance;

async function request(method: string, path: string, body?: unknown, token?: string) {
  const response = await realFetch(base + path, {
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

  // Fake Deezer: answers /track/:id with a track of that id; any other request goes through
  deezer = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const match = target.match(/^https:\/\/api\.deezer\.com\/track\/(\d+)$/);
    if (!match) return realFetch(input, init);
    const id = Number(match[1]);
    return new Response(JSON.stringify({
      id, title: `Track ${id}`, duration: 200, link: `https://www.deezer.com/track/${id}`,
      preview: '', artist: { name: 'Test Artist' }, album: { cover_medium: '' },
    }), { status: 200 });
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
  for (const spy of spies.splice(0)) spy.mockRestore();
});

afterAll(async () => {
  if (app) await app.close();
  throttling?.mockRestore();
  deezer?.mockRestore();
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

// -----------------------------------------------------------------
// Party snapshots
// -----------------------------------------------------------------
type Snapshot = {
  party: { id: string; playbackVersion: number; nowPlaying: { id: string } | null };
  queue: { id: string; songId: string; voteCount: number }[];
  queueLength: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits until `condition` holds, checking every 10 ms (fails after 3 s)
async function until(condition: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the condition');
    await sleep(10);
  }
}

// Every snapshot a connection receives, in the order they arrive
function record(socket: Socket): Snapshot[] {
  const received: Snapshot[] = [];
  socket.on('party:snapshot', (snapshot: Snapshot) => received.push(snapshot));
  return received;
}

// A connection watching a party, once it has received the snapshot sent on subscribing
async function watcher(token: string, id: string) {
  const socket = await connect({ auth: { token } });
  const received = record(socket);
  expect(await watch(socket, id)).toEqual({ ok: true });
  await until(() => received.length === 1);
  return { socket, received, last: () => received[received.length - 1] };
}

let lastTrack = 5000;
const track = () => String(lastTrack++); // a Deezer id no other test used

const suggest = (id: string, externalId: string, token: string) =>
  request('POST', `/parties/${id}/songs`, { externalId }, token);
const vote = (id: string, entryId: string, token: string) =>
  request('POST', `/parties/${id}/songs/${entryId}/vote`, {}, token);
const unvote = (id: string, entryId: string, token: string) =>
  request('DELETE', `/parties/${id}/songs/${entryId}/vote`, undefined, token);
const next = (id: string, token: string, expectedPlaybackVersion: number) =>
  request('POST', `/parties/${id}/next`, { expectedPlaybackVersion }, token);

// A public party with `count` songs suggested by its owner; returns the queue entry ids in order
async function partyWithSongs(ownerToken: string, count: number) {
  const id = await party(ownerToken);
  const entries: string[] = [];
  for (let i = 0; i < count; i++) {
    const suggested = await suggest(id, track(), ownerToken);
    expect(suggested.status).toBe(201);
    entries.push(suggested.body.id);
  }
  return { id, entries };
}

// What the REST routes show for a party right now: a snapshot must hold exactly this
async function restView(id: string, token: string) {
  const party = (await request('GET', `/parties/${id}`, undefined, token)).body;
  const queue = (await request('GET', `/parties/${id}/queue?limit=100`, undefined, token)).body;
  return { party, queue };
}
const shown = ({ party, queue }: Snapshot) => ({ party, queue });

// Counts the snapshot reads of one party (the reads still happen normally)
function countReads(id: string) {
  const reads = jest.spyOn(app.get(PartiesService), 'snapshot');
  spies.push(reads);
  return () => reads.mock.calls.filter(([partyId]) => partyId === id).length;
}

// Makes the first snapshot read of a party wait, once it has read the database, until `release()`.
// `read` resolves at that moment, so a test can change things while that snapshot is on its way.
function holdNextRead(id: string) {
  const parties = app.get(PartiesService);
  const original = PartiesService.prototype.snapshot.bind(parties);
  let release!: () => void;
  let readDone!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const read = new Promise<void>((resolve) => (readDone = resolve));
  let held = false;
  spies.push(jest.spyOn(parties, 'snapshot').mockImplementation(async (partyId: string) => {
    const snapshot = await original(partyId);
    if (partyId !== id || held) return snapshot;
    held = true;
    readDone();
    await released;
    return snapshot;
  }));
  return { read, release };
}

// Makes the first snapshot read of a party fail, like a database error would
function failNextRead(id: string) {
  const parties = app.get(PartiesService);
  const original = PartiesService.prototype.snapshot.bind(parties);
  let failed = false;
  spies.push(jest.spyOn(parties, 'snapshot').mockImplementation(async (partyId: string) => {
    if (partyId !== id || failed) return original(partyId);
    failed = true;
    throw new Error('database busy');
  }));
}

// The snapshot errors the gateway logged (the logger prints nothing in tests)
function loggedErrors() {
  const errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  spies.push(errors);
  return () => errors.mock.calls.map(([message]) => String(message)).filter((message) => message.startsWith('Snapshot of'));
}

describe('Party snapshots: what watchers receive', () => {
  it('sends the current snapshot on subscribing: the same data as GET /parties/:id and GET /queue', async () => {
    const owner = await account();
    const { id, entries } = await partyWithSongs(owner.accessToken, 2);
    expect((await vote(id, entries[1], owner.accessToken)).status).toBe(201);

    const { received } = await watcher(owner.accessToken, id);

    expect(shown(received[0])).toEqual(await restView(id, owner.accessToken));
    expect(received[0].queue.map((entry) => entry.id)).toEqual([entries[1], entries[0]]);
    expect(received[0].queueLength).toBe(2);
  });

  it('sends every change to everyone watching, with exactly what the REST routes then show', async () => {
    const owner = await account();
    const guest = await account();
    const id = await party(owner.accessToken);
    const host = await watcher(owner.accessToken, id);
    const listener = await watcher(guest.accessToken, id);
    const bothReceived = async (count: number) => {
      await until(() => host.received.length === count && listener.received.length === count);
      const view = await restView(id, owner.accessToken);
      expect(shown(host.last())).toEqual(view);
      expect(shown(listener.last())).toEqual(view);
      return host.last();
    };

    const first = await suggest(id, track(), guest.accessToken);
    expect(first.status).toBe(201);
    expect((await bothReceived(2)).queue).toHaveLength(1);

    const second = await suggest(id, track(), guest.accessToken);
    expect((await bothReceived(3)).queueLength).toBe(2);

    expect((await vote(id, second.body.id, guest.accessToken)).status).toBe(201);
    expect((await bothReceived(4)).queue.map((entry) => entry.id)).toEqual([second.body.id, first.body.id]);

    expect((await unvote(id, second.body.id, guest.accessToken)).status).toBe(200);
    expect((await bothReceived(5)).queue.map((entry) => entry.voteCount)).toEqual([0, 0]);

    expect((await next(id, owner.accessToken, 0)).status).toBe(201);
    const played = await bothReceived(6);
    expect(played.party.nowPlaying?.id).toBe(first.body.songId);
    expect(played.party.playbackVersion).toBe(1);
    expect(played.queue.map((entry) => entry.id)).toEqual([second.body.id]);
  });

  it('holds the first 100 queue entries in play order, and the real length of the queue', async () => {
    const owner = await account();
    const id = await party(owner.accessToken);
    const prisma = app.get(PrismaService);
    const { partyPlaylistId } = await prisma.party.findUniqueOrThrow({ where: { id } });
    const songs = Array.from({ length: 101 }, (_, i) => ({
      id: randomUUID(), title: `Bulk ${i}`, artist: 'Test Artist', durationSec: 200, sourceUri: 'https://www.deezer.com',
    }));
    await prisma.song.createMany({ data: songs });
    // Inserted together, so they share createdAt: the order falls back to votes, then id
    await prisma.partySong.createMany({ data: songs.map((song, i) => ({ songId: song.id, partyPlaylistId, voteCount: i % 3 })) });

    const { received } = await watcher(owner.accessToken, id);

    expect(received[0].queue).toHaveLength(100);
    expect(received[0].queueLength).toBe(101);
    expect(received[0].queue).toEqual((await restView(id, owner.accessToken)).queue);
  });

  it('sends nothing for a refused request', async () => {
    const owner = await account();
    const stranger = await account();
    const id = await party(owner.accessToken);
    const externalId = track();
    const entry = (await suggest(id, externalId, owner.accessToken)).body.id;
    const { received } = await watcher(owner.accessToken, id);
    expect((await vote(id, entry, owner.accessToken)).status).toBe(201);
    await until(() => received.length === 2);

    expect((await suggest(id, externalId, owner.accessToken)).status).toBe(409);
    expect((await vote(id, entry, owner.accessToken)).status).toBe(409);
    expect((await vote(id, randomUUID(), owner.accessToken)).status).toBe(404);
    expect((await unvote(id, entry, stranger.accessToken)).status).toBe(404);
    expect((await next(id, stranger.accessToken, 0)).status).toBe(403);
    expect((await next(id, owner.accessToken, 7)).status).toBe(409);
    await sleep(500);

    expect(received).toHaveLength(2);
  });

  it('removes a vote only through its own party, so the right watchers are told', async () => {
    const owner = await account();
    const voter = await account();
    const other = await party(owner.accessToken);
    const { id, entries } = await partyWithSongs(owner.accessToken, 1);
    const watching = await watcher(owner.accessToken, id);
    const watchingOther = await watcher(owner.accessToken, other);
    expect((await vote(id, entries[0], voter.accessToken)).status).toBe(201);
    await until(() => watching.received.length === 2);

    expect((await unvote(other, entries[0], voter.accessToken)).status).toBe(404);
    expect((await restView(id, owner.accessToken)).queue[0].voteCount).toBe(1);

    expect((await unvote(id, entries[0], voter.accessToken)).status).toBe(200);
    await until(() => watching.received.length === 3);
    expect(watching.last().queue[0].voteCount).toBe(0);
    expect(watchingOther.received).toHaveLength(1);
  });

  it("sends a party's snapshots only to the connections watching it", async () => {
    const owner = await account();
    const { id, entries } = await partyWithSongs(owner.accessToken, 1);
    const otherParty = await party(owner.accessToken);
    const watching = await watcher(owner.accessToken, id);
    const watchingOther = await watcher(owner.accessToken, otherParty);
    const left = await watcher(owner.accessToken, id);
    expect(await send(left.socket, 'unsubscribe', { type: 'party', id })).toEqual({ ok: true });
    const idle = record(await connect({ auth: { token: owner.accessToken } }));

    expect((await vote(id, entries[0], owner.accessToken)).status).toBe(201);
    await until(() => watching.received.length === 2);
    await sleep(300);

    expect(watchingOther.received).toHaveLength(1);
    expect(left.received).toHaveLength(1);
    expect(idle).toHaveLength(0);
  });

  it('sends the snapshot of a new subscription to that connection only', async () => {
    const owner = await account();
    const guest = await account();
    const id = await party(owner.accessToken);
    const first = await watcher(owner.accessToken, id);

    await watcher(guest.accessToken, id);
    await sleep(400);

    expect(first.received).toHaveLength(1);
  });

  it('sends the snapshot again on a repeated subscription, so a client can resynchronize', async () => {
    const owner = await account();
    const id = await party(owner.accessToken);
    const { socket, received } = await watcher(owner.accessToken, id);

    expect(await watch(socket, id)).toEqual({ ok: true });
    await until(() => received.length === 2);
  });

  it('sends no snapshot after a refused subscription', async () => {
    const owner = await account();
    const stranger = await account();
    const id = await party(owner.accessToken, 'PRIVATE');
    const socket = await connect({ auth: { token: stranger.accessToken } });
    const received = record(socket);

    expect(await watch(socket, id)).toEqual(refusal('FORBIDDEN'));
    await sleep(400);

    expect(received).toHaveLength(0);
  });
});

describe('Party snapshots: order, merging and failures', () => {
  it('reads a snapshot as one consistent state, even when a change commits in the middle of the reads', async () => {
    const owner = await account();
    const { id, entries } = await partyWithSongs(owner.accessToken, 2);
    // Pause the snapshot of the subscription below right after it has read the party, and play
    // the next song at that moment: that song leaves the queue and becomes the one playing
    const prisma = app.get(PrismaService);
    const transaction = prisma.$transaction.bind(prisma) as (...args: unknown[]) => Promise<unknown>;
    let moved = false;
    const pauseAfterPartyRead = (tx: any) => new Proxy(tx, {
      get: (client, model) => model !== 'party' ? client[model] : new Proxy(client.party, {
        get: (delegate, method) => method !== 'findUniqueOrThrow' ? delegate[method] : async (args: { where: { id: string } }) => {
          const found = await delegate.findUniqueOrThrow(args);
          if (!moved && args.where.id === id) {
            moved = true;
            expect((await next(id, owner.accessToken, 0)).status).toBe(201);
          }
          return found;
        },
      }),
    });
    spies.push(jest.spyOn(prisma, '$transaction').mockImplementation(((work: unknown, options?: unknown) =>
      typeof work === 'function' ? transaction((tx: unknown) => work(pauseAfterPartyRead(tx)), options) : transaction(work, options)
    ) as never));

    const { received } = await watcher(owner.accessToken, id);
    await until(() => received.length === 2);

    // Entirely before the change, then entirely after it: never the song gone from the queue but not playing
    expect(moved).toBe(true);
    expect(received[0].party).toMatchObject({ playbackVersion: 0, nowPlaying: null });
    expect(received[0].queue.map((entry) => entry.id)).toEqual(entries);
    expect(received[0].queueLength).toBe(2);
    expect(received[1].party.playbackVersion).toBe(1);
    expect(received[1].party.nowPlaying).not.toBeNull();
    expect(received[1].queue.map((entry) => entry.id)).toEqual([entries[1]]);
    expect(received[1].queueLength).toBe(1);
  });

  it('never lets a newer snapshot be overtaken by an older one that was slow to read', async () => {
    const owner = await account();
    const voter = await account();
    const { id, entries } = await partyWithSongs(owner.accessToken, 1);
    const watching = await watcher(owner.accessToken, id);
    const held = holdNextRead(id);

    expect((await vote(id, entries[0], owner.accessToken)).status).toBe(201);
    await held.read;
    expect((await vote(id, entries[0], voter.accessToken)).status).toBe(201);
    await sleep(400);
    held.release();
    await until(() => watching.received.length === 3);

    expect(watching.received.map((snapshot) => snapshot.queue[0].voteCount)).toEqual([0, 1, 2]);
  });

  it('merges the changes made while a snapshot is on its way into one more snapshot', async () => {
    const owner = await account();
    const voters = [await account(), await account(), await account(), await account()];
    const { id, entries } = await partyWithSongs(owner.accessToken, 1);
    const watching = await watcher(owner.accessToken, id);
    const held = holdNextRead(id);

    expect((await vote(id, entries[0], owner.accessToken)).status).toBe(201);
    await held.read;
    // The requests are answered while the snapshot is held: sending never slows a request down
    for (const voter of voters) expect((await vote(id, entries[0], voter.accessToken)).status).toBe(201);
    held.release();
    await until(() => watching.received.length === 3);
    await sleep(600);

    expect(watching.received.map((snapshot) => snapshot.queue[0].voteCount)).toEqual([0, 1, 5]);
  });

  it('sends at most one snapshot per party every 200 ms', async () => {
    const owner = await account();
    const { id, entries } = await partyWithSongs(owner.accessToken, 2);
    const { socket, received } = await watcher(owner.accessToken, id);
    const arrivals: number[] = [];
    socket.on('party:snapshot', () => arrivals.push(Date.now()));

    expect((await vote(id, entries[0], owner.accessToken)).status).toBe(201);
    await until(() => arrivals.length === 1);
    expect((await vote(id, entries[1], owner.accessToken)).status).toBe(201);
    await until(() => arrivals.length === 2);

    expect(arrivals[1] - arrivals[0]).toBeGreaterThanOrEqual(190);
    expect(received[received.length - 1].queue.map((entry) => entry.voteCount)).toEqual([1, 1]);
  });

  it('does not make a party wait for the snapshot of another one', async () => {
    const owner = await account();
    const slow = await partyWithSongs(owner.accessToken, 1);
    const fast = await partyWithSongs(owner.accessToken, 1);
    const watchingSlow = await watcher(owner.accessToken, slow.id);
    const watchingFast = await watcher(owner.accessToken, fast.id);
    const held = holdNextRead(slow.id);

    expect((await vote(slow.id, slow.entries[0], owner.accessToken)).status).toBe(201);
    await held.read;
    expect((await vote(fast.id, fast.entries[0], owner.accessToken)).status).toBe(201);
    await until(() => watchingFast.received.length === 2);
    expect(watchingSlow.received).toHaveLength(1);

    held.release();
    await until(() => watchingSlow.received.length === 2);
  });

  it('does not read a party that nobody watches', async () => {
    const owner = await account();
    const { id, entries } = await partyWithSongs(owner.accessToken, 1);
    const reads = countReads(id);

    expect((await vote(id, entries[0], owner.accessToken)).status).toBe(201);
    await sleep(400);
    expect(reads()).toBe(0);

    const { socket } = await watcher(owner.accessToken, id);
    expect(reads()).toBe(1);
    expect(await send(socket, 'unsubscribe', { type: 'party', id })).toEqual({ ok: true });
    expect((await unvote(id, entries[0], owner.accessToken)).status).toBe(200);
    await sleep(400);
    expect(reads()).toBe(1);
  });

  it('sends nothing to a connection that unsubscribed or closed before its snapshot was read', async () => {
    const owner = await account();
    const { id, entries } = await partyWithSongs(owner.accessToken, 1);
    const watching = await watcher(owner.accessToken, id);
    const errors = loggedErrors();
    const held = holdNextRead(id);
    expect((await vote(id, entries[0], owner.accessToken)).status).toBe(201);
    await held.read;

    // Both subscribe while the room's snapshot is held, so theirs can only be read after it
    const unsubscribed = await connect({ auth: { token: owner.accessToken } });
    const closed = await connect({ auth: { token: owner.accessToken } });
    const toUnsubscribed = record(unsubscribed);
    const toClosed = record(closed);
    expect(await watch(unsubscribed, id)).toEqual({ ok: true });
    expect(await watch(closed, id)).toEqual({ ok: true });
    expect(await send(unsubscribed, 'unsubscribe', { type: 'party', id })).toEqual({ ok: true });
    closed.disconnect();
    held.release();
    await until(() => watching.received.length === 2);
    await sleep(600);

    expect(toUnsubscribed).toHaveLength(0);
    expect(toClosed).toHaveLength(0);
    expect(errors()).toEqual([]);
  });

  it('logs a failed read and tries again 1 s later, and the change itself still succeeds', async () => {
    const owner = await account();
    const { id, entries } = await partyWithSongs(owner.accessToken, 1);
    const watching = await watcher(owner.accessToken, id);
    const errors = loggedErrors();
    failNextRead(id);

    const changedAt = Date.now();
    expect((await vote(id, entries[0], owner.accessToken)).status).toBe(201);
    await until(() => watching.received.length === 2);

    expect(Date.now() - changedAt).toBeGreaterThanOrEqual(950);
    expect(watching.last().queue[0].voteCount).toBe(1);
    expect(errors()).toEqual([`Snapshot of party:${id} failed: database busy`]);
  });

  it('also tries again when the snapshot of a new subscription fails', async () => {
    const owner = await account();
    const id = await party(owner.accessToken);
    const errors = loggedErrors();
    failNextRead(id);

    const { received } = await watcher(owner.accessToken, id);

    expect(received[0].party.id).toBe(id);
    expect(errors()).toEqual([`Snapshot of party:${id} failed: database busy`]);
  });
});
