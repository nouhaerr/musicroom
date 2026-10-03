import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { PrismaClient } from '../generated/prisma';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailService } from '../src/mail/mail.service';
import { GoogleProvider } from '../src/auth/social/google.provider';
import { FacebookProvider } from '../src/auth/social/facebook.provider';
import { SessionsService } from '../src/auth/sessions.service';

// Every run creates and drops ONLY its own random schema. No truncate/reset of public.
const schema = `musicroom_test_${randomUUID().replace(/-/g, '')}`;
const verification = new Map<string, string>();
const resets = new Map<string, string[]>();
const google = { verify: jest.fn() };
const facebook = { verify: jest.fn() };
let app: INestApplication;
let db: PrismaService;
let admin: PrismaClient;
let base: string;
let schemaCreated = false;
let throttling: jest.SpyInstance;

async function request(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const response = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function account(name = 'Listener') {
  const email = `${randomUUID()}@example.com`;
  const password = 'Test-password-123!';
  const registered = await request('POST', '/auth/register', { email, password, name });
  expect(registered.status).toBe(201);
  expect(registered.body).not.toHaveProperty('passwordHash');
  const verified = await request('GET', `/auth/verify-email?token=${verification.get(email)}`);
  expect(verified.status).toBe(200);
  const login = await request('POST', '/auth/login', { email, password });
  expect(login.status).toBe(201);
  return { ...login.body, id: registered.body.id as string, email, password };
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required; tests use a disposable schema within this database.');
  const url = new URL(process.env.TEST_DATABASE_URL);
  admin = new PrismaClient({ datasources: { db: { url: url.href } } });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  url.searchParams.set('schema', schema);
  Object.assign(process.env, {
    DATABASE_URL: url.href,
    JWT_ACCESS_SECRET: 'e2e-access-secret', JWT_REFRESH_SECRET: 'e2e-refresh-secret',
    JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '7d', GOOGLE_AUTH_ENABLED: 'false',
  });
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    env: process.env, stdio: 'pipe', timeout: 60000,
  });
  // Load the module only after the test environment is configured.
  const { AppModule } = await import('../src/app.module');
  // The global APP_GUARD uses a generated token; override its method only in this test process.
  throttling = jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService).useValue({
      sendVerificationEmail: async (email: string, token: string) => { verification.set(email, token); },
      sendPasswordResetEmail: async (email: string, token: string) => { resets.set(email, [...(resets.get(email) ?? []), token]); },
    })
    .overrideProvider(GoogleProvider).useValue(google)
    .overrideProvider(FacebookProvider).useValue(facebook)
    .compile();
  app = module.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  db = app.get(PrismaService);
});

afterAll(async () => {
  if (app) await app.close();
  throttling?.mockRestore();
  if (schemaCreated) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  if (admin) await admin.$disconnect();
});

describe('Email authentication and persisted sessions', () => {
  it('requires valid input and verified email before login', async () => {
    const email = `${randomUUID()}@example.com`;
    const password = 'Test-password-123!';
    expect((await request('POST', '/auth/register', { email, password, name: 'New' })).status).toBe(201);
    expect((await request('POST', '/auth/login', { email, password })).status).toBe(403);
    expect((await request('POST', '/auth/login', { email, password: ['bad'] })).status).toBe(400);
    expect((await request('POST', '/auth/login', { email, password, role: 'admin' })).status).toBe(400);
    expect((await request('POST', '/auth/login', { email, password: 'wrong' })).status).toBe(401);
  });

  it('returns a conflict for concurrent duplicate registrations', async () => {
    const data = { email: `${randomUUID()}@example.com`, password: 'Test-password-123!', name: 'Duplicate' };
    const results = await Promise.all([request('POST', '/auth/register', data), request('POST', '/auth/register', data)]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
  });

  it('logs out only the current session and immediately rejects its access token', async () => {
    const a = await account();
    const other = await request('POST', '/auth/login', { email: a.email, password: a.password });
    expect((await request('POST', '/auth/logout', {}, a.accessToken)).status).toBe(201);
    expect((await request('GET', '/users/me', undefined, a.accessToken)).status).toBe(401);
    expect((await request('POST', '/auth/refresh', { refreshToken: a.refreshToken })).status).toBe(401);
    expect((await request('GET', '/users/me', undefined, other.body.accessToken)).status).toBe(200);
    expect((await request('POST', '/auth/refresh', { refreshToken: a.accessToken })).status).toBe(401);
  });

  it('detects concurrent refresh replay and revokes all sessions, including the winner', async () => {
    const a = await account();
    const other = await request('POST', '/auth/login', { email: a.email, password: a.password });
    const responses = await Promise.all([
      request('POST', '/auth/refresh', { refreshToken: a.refreshToken }),
      request('POST', '/auth/refresh', { refreshToken: a.refreshToken }),
    ]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 401]);
    const winner = responses.find(r => r.status === 201)!;
    expect((await request('GET', '/users/me', undefined, winner.body.accessToken)).status).toBe(401);
    expect((await request('GET', '/users/me', undefined, other.body.accessToken)).status).toBe(401);
    expect(await db.authSession.count({ where: { userId: a.id, revokedAt: null } })).toBe(0);
    const stored = await db.refreshToken.findMany({ where: { session: { userId: a.id } } });
    expect(stored.every(r => /^[a-f0-9]{64}$/.test(r.tokenHash))).toBe(true);
  });

  it('consumes reset links once, invalidates other links and revokes every session', async () => {
    const a = await account();
    const other = await request('POST', '/auth/login', { email: a.email, password: a.password });
    expect((await request('POST', '/auth/forgot-password', { email: a.email })).status).toBe(201);
    expect((await request('POST', '/auth/forgot-password', { email: a.email })).status).toBe(201);
    const [token, otherToken] = resets.get(a.email)!;
    expect(token).not.toBe(otherToken);
    const responses = await Promise.all([
      request('POST', '/auth/reset-password', { token, newPassword: 'New-password-123!' }),
      request('POST', '/auth/reset-password', { token, newPassword: 'New-password-123!' }),
    ]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 401]);
    expect((await request('POST', '/auth/reset-password', { token: otherToken, newPassword: 'Another-password!' })).status).toBe(401);
    for (const access of [a.accessToken, other.body.accessToken]) {
      expect((await request('GET', '/users/me', undefined, access)).status).toBe(401);
    }
    expect((await request('POST', '/auth/refresh', { refreshToken: a.refreshToken })).status).toBe(401);
    expect((await request('POST', '/auth/login', { email: a.email, password: a.password })).status).toBe(401);
    expect((await request('POST', '/auth/login', { email: a.email, password: 'New-password-123!' })).status).toBe(201);
  });

  it('rejects credentials validated before a password reset', async () => {
    const a = await account();
    const before = await db.user.findUniqueOrThrow({ where: { id: a.id } });
    await request('POST', '/auth/forgot-password', { email: a.email });
    await request('POST', '/auth/reset-password', { token: resets.get(a.email)![0], newPassword: 'New-password-123!' });
    await expect(app.get(SessionsService).create(a.id, before.updatedAt)).rejects.toThrow();
  });
});

describe('Social accounts', () => {
  it.each(['google', 'facebook'])('requires explicit linking for an existing email (%s)', async provider => {
    const a = await account();
    const mock = provider === 'google' ? google : facebook;
    const providerId = randomUUID();
    mock.verify.mockResolvedValue({ providerId, email: a.email, name: 'Social user' });
    const body = provider === 'google' ? { idToken: 'provider-token' } : { accessToken: 'provider-token' };
    expect((await request('POST', `/auth/${provider}`, body)).status).toBe(409);
    expect((await request('POST', `/auth/link/${provider}`, body)).status).toBe(401);
    expect((await request('POST', `/auth/link/${provider}`, body, a.accessToken)).status).toBe(201);
    const login = await request('POST', `/auth/${provider}`, body);
    expect(login.status).toBe(201);
    expect(login.body.user.id).toBe(a.id);
    expect(login.body.user).not.toHaveProperty('passwordHash');
  });

  it('allows only one owner when two accounts link the same social identity concurrently', async () => {
    const a = await account();
    const b = await account();
    google.verify.mockResolvedValue({ providerId: randomUUID(), email: 'social@example.com', name: 'Social' });
    const results = await Promise.all([
      request('POST', '/auth/link/google', { idToken: 'token' }, a.accessToken),
      request('POST', '/auth/link/google', { idToken: 'token' }, b.accessToken),
    ]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
  });
});

describe('Friend requests and profile visibility', () => {
  it('enforces ownership, prevents duplicates, and supports reject, cancel, accept and remove', async () => {
    const a = await account();
    const b = await account();
    const c = await account();
    expect((await request('POST', '/friends/requests', { userId: a.id }, a.accessToken)).status).toBe(400);
    const results = await Promise.all([
      request('POST', '/friends/requests', { userId: b.id }, a.accessToken),
      request('POST', '/friends/requests', { userId: b.id }, a.accessToken),
    ]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    const id = results.find(r => r.status === 201)!.body.id;
    expect((await request('POST', `/friends/requests/${id}/accept`, {}, c.accessToken)).status).toBe(404);
    expect((await request('DELETE', `/friends/requests/${id}`, undefined, b.accessToken)).status).toBe(404);
    expect((await request('POST', `/friends/requests/${id}/reject`, {}, b.accessToken)).status).toBe(201);
    await request('POST', '/friends/requests', { userId: b.id }, a.accessToken);
    expect((await request('DELETE', `/friends/requests/${id}`, undefined, a.accessToken)).status).toBe(200);
    const resent = await request('POST', '/friends/requests', { userId: b.id }, a.accessToken);
    expect((await request('POST', `/friends/requests/${resent.body.id}/accept`, {}, b.accessToken)).status).toBe(201);
    expect((await request('POST', `/friends/requests/${resent.body.id}/accept`, {}, b.accessToken)).status).toBe(409);
    expect((await request('GET', '/friends', undefined, a.accessToken)).body.map((u: { id: string }) => u.id)).toEqual([b.id]);
    expect((await request('DELETE', `/friends/${b.id}`, undefined, a.accessToken)).status).toBe(200);
    expect((await request('GET', '/friends', undefined, b.accessToken)).body).toEqual([]);
  });

  it('auto-accepts simultaneous mutual requests and applies all profile visibility tiers', async () => {
    const a = await account('Jazz listener');
    const b = await account();
    const c = await account();
    expect((await request('PATCH', '/users/me', {
      publicInfo: { bio: 'public' }, friendsOnlyInfo: { bio: 'friends' }, privateInfo: { bio: 'private' }, musicPreferences: [' Jazz ', 'ROCK'],
    }, a.accessToken)).status).toBe(200);
    const responses = await Promise.all([
      request('POST', '/friends/requests', { userId: b.id }, a.accessToken),
      request('POST', '/friends/requests', { userId: a.id }, b.accessToken),
    ]);
    expect(responses.every(r => r.status === 201)).toBe(true);
    expect(responses.some(r => r.body.status === 'ACCEPTED')).toBe(true);
    expect(await db.friendRequest.count({ where: { status: 'PENDING', OR: [{ senderId: a.id }, { receiverId: a.id }] } })).toBe(0);
    for (const viewer of [undefined, c.accessToken]) {
      const profile = (await request('GET', `/users/${a.id}`, undefined, viewer)).body;
      expect(profile.publicInfo.bio).toBe('public');
      for (const field of ['email', 'passwordHash', 'privateInfo', 'friendsOnlyInfo', 'googleId']) expect(profile).not.toHaveProperty(field);
    }
    const friend = (await request('GET', `/users/${a.id}`, undefined, b.accessToken)).body;
    expect(friend.friendsOnlyInfo.bio).toBe('friends');
    expect(friend).not.toHaveProperty('privateInfo');
    expect((await request('GET', `/users/${a.id}`, undefined, a.accessToken)).body.privateInfo.bio).toBe('private');
    const search = await request('GET', '/users/search?q=Jazz&genre=JAZZ&page=1&limit=1');
    expect(search.status).toBe(200);
    expect(search.body).toHaveLength(1);
    expect(search.body[0].musicPreferences).toEqual(['jazz', 'rock']);
    expect(search.body[0]).not.toHaveProperty('email');
    expect((await request('GET', '/users/search?limit=101')).status).toBe(400);
    expect((await request('GET', '/users/search?page=0')).status).toBe(400);
    expect((await request('PATCH', '/users/me', { musicPreferences: { genres: ['jazz'] } }, a.accessToken)).status).toBe(400);
    expect((await request('PATCH', '/users/me', { musicPreferences: ['Jazz', 'jazz'] }, a.accessToken)).status).toBe(400);
    await request('DELETE', `/friends/${b.id}`, undefined, a.accessToken);
    expect((await request('GET', `/users/${a.id}`, undefined, b.accessToken)).body).not.toHaveProperty('friendsOnlyInfo');
  });
});

describe.each(['parties', 'playlists'])('%s invitations', resource => {
  it('hides private resources, handles decline/reinvite/accept and removes access', async () => {
    const owner = await account();
    const invited = await account();
    const stranger = await account();
    const created = await request('POST', `/${resource}`, { name: 'Private resource', visibility: 'PRIVATE' }, owner.accessToken);
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await request('GET', `/${resource}/${id}`, undefined, invited.accessToken)).status).toBe(403);
    expect((await request('POST', `/${resource}/${id}/invite`, { userId: invited.id }, stranger.accessToken)).status).toBe(403);
    const invitation = await request('POST', `/${resource}/${id}/invite`, { userId: invited.id }, owner.accessToken);
    const inviteId = invitation.body.id;
    expect((await request('GET', '/invitations/me', undefined, invited.accessToken)).body.some((i: { id: string }) => i.id === inviteId)).toBe(true);
    const canFind = async (token: string) => (await request('GET', `/${resource}`, undefined, token)).body.some((r: { id: string }) => r.id === id);
    expect(await canFind(invited.accessToken)).toBe(true);
    expect(await canFind(stranger.accessToken)).toBe(false);
    expect((await request('POST', `/invitations/${inviteId}/accept`, {}, stranger.accessToken)).status).toBe(404);
    expect((await request('POST', `/invitations/${inviteId}/decline`, {}, invited.accessToken)).status).toBe(201);
    expect(await canFind(invited.accessToken)).toBe(false);
    await request('POST', `/${resource}/${id}/invite`, { userId: invited.id }, owner.accessToken);
    expect((await request('POST', `/invitations/${inviteId}/accept`, {}, invited.accessToken)).status).toBe(201);
    expect((await request('GET', `/${resource}/mine`, undefined, invited.accessToken)).body.some((r: { id: string }) => r.id === id)).toBe(true);
    expect((await request('DELETE', `/${resource}/${id}/invitations/${invited.id}`, undefined, stranger.accessToken)).status).toBe(403);
    expect((await request('DELETE', `/${resource}/${id}/invitations/${invited.id}`, undefined, owner.accessToken)).status).toBe(200);
    expect(await canFind(invited.accessToken)).toBe(false);
    expect((await request('GET', `/${resource}/${id}`, undefined, invited.accessToken)).status).toBe(403);
  });

  it('cannot restore membership by accepting an invitation concurrently with removal', async () => {
    const owner = await account();
    const invited = await account();
    const created = await request('POST', `/${resource}`, { name: 'Race test', visibility: 'PRIVATE' }, owner.accessToken);
    const id = created.body.id;
    const invitation = await request('POST', `/${resource}/${id}/invite`, { userId: invited.id }, owner.accessToken);
    const [accept, remove] = await Promise.all([
      request('POST', `/invitations/${invitation.body.id}/accept`, {}, invited.accessToken),
      request('DELETE', `/${resource}/${id}/invitations/${invited.id}`, undefined, owner.accessToken),
    ]);
    expect([201, 409]).toContain(accept.status);
    expect(remove.status).toBe(200);
    expect((await request('GET', `/${resource}/${id}`, undefined, invited.accessToken)).status).toBe(403);
    expect((await db.invitation.findUniqueOrThrow({ where: { id: invitation.body.id } })).status).toBe('REVOKED');
  });
});

describe('Device ownership', () => {
  it('never associates another user’s device with logs and only lets the owner delete it', async () => {
    const a = await account();
    const b = await account();
    const device = (await request('POST', '/devices', { platform: 'IOS', model: 'Test', appVersion: '1' }, a.accessToken)).body;
    const headers = { 'X-Device-Id': device.id };
    const before = new Date();
    await request('GET', '/users/me', undefined, b.accessToken, headers);
    await request('GET', '/users/me', undefined, a.accessToken, headers);
    // Logging is intentionally asynchronous; wait for this particular log to be stored.
    let logs: Awaited<ReturnType<typeof db.actionLog.findMany>> = [];
    for (let attempt = 0; attempt < 40; attempt++) {
      logs = await db.actionLog.findMany({ where: { createdAt: { gte: before }, action: 'GET /users/me', userId: { in: [a.id, b.id] } } });
      if (logs.length >= 2) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(logs.find(l => l.userId === b.id)?.deviceId).toBeNull();
    expect(logs.find(l => l.userId === a.id)?.deviceId).toBe(device.id);
    expect((await request('DELETE', `/devices/${device.id}`, undefined, b.accessToken)).status).toBe(404);
    expect((await request('DELETE', `/devices/${device.id}`, undefined, a.accessToken)).status).toBe(200);
    expect(await db.device.findUnique({ where: { id: device.id } })).toBeNull();
  });
});
