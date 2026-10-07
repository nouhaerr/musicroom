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
  expect((await request('POST', '/auth/register', { email, password, name: 'Listener' })).status).toBe(201);
  const verificationToken = verification.get(email)!;
  expect((await request('GET', `/auth/verify-email?token=${verificationToken}`)).status).toBe(200);
  const login = await request('POST', '/auth/login', { email, password });
  expect(login.status).toBe(201);
  return { accessToken: login.body.accessToken as string, refreshToken: login.body.refreshToken as string, verificationToken };
}

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
