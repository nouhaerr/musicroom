import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { PrismaClient } from '../generated/prisma';
import { MailService } from '../src/mail/mail.service';
import { GoogleProvider } from '../src/auth/social/google.provider';
import { FacebookProvider } from '../src/auth/social/facebook.provider';

// Every run creates and drops ONLY its own random schema (same pattern as auth-users.e2e-spec.ts)
const schema = `musicroom_test_${randomUUID().replace(/-/g, '')}`;
const verification = new Map<string, string>();
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

async function account(name: string): Promise<string> {
  const email = `${randomUUID()}@example.com`;
  const password = 'Test-password-123!';
  expect((await request('POST', '/auth/register', { email, password, name })).status).toBe(201);
  expect((await request('GET', `/auth/verify-email?token=${verification.get(email)}`)).status).toBe(200);
  const login = await request('POST', '/auth/login', { email, password });
  expect(login.status).toBe(201);
  return login.body.accessToken;
}

// A party with three suggested songs (in this order), its owner and a guest
async function partyWithSongs() {
  const owner = await account('Owner');
  const guest = await account('Guest');
  const party = await request('POST', '/parties', { name: 'Playback test' }, owner);
  expect(party.status).toBe(201);
  for (const externalId of ['1001', '1002', '1003']) {
    expect((await request('POST', `/parties/${party.body.id}/songs`, { externalId }, owner)).status).toBe(201);
  }
  return { owner, guest, id: party.body.id as string };
}

const queue = async (id: string, token: string) => (await request('GET', `/parties/${id}/queue`, undefined, token)).body;

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

afterAll(async () => {
  if (app) await app.close();
  throttling?.mockRestore();
  deezer?.mockRestore();
  if (schemaCreated) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  if (admin) await admin.$disconnect();
});

describe('Party playback (POST /parties/:id/next)', () => {
  it('plays the top-voted song, removes it from the queue and shows it to everyone', async () => {
    const { owner, guest, id } = await partyWithSongs();
    const last = (await queue(id, owner))[2];
    expect((await request('POST', `/parties/${id}/songs/${last.id}/vote`, {}, guest)).status).toBe(201);

    const next = await request('POST', `/parties/${id}/next`, {}, owner);
    expect(next.status).toBe(201);
    expect(next.body.nowPlaying.id).toBe(last.songId);

    const remaining = await queue(id, owner);
    expect(remaining).toHaveLength(2);
    expect(remaining.some((s: { songId: string }) => s.songId === last.songId)).toBe(false);
    expect((await request('GET', `/parties/${id}`, undefined, guest)).body.nowPlaying.id).toBe(last.songId);
  });

  it('rejects a stale view with 409 and plays the earliest suggestion on a tie', async () => {
    const { owner, id } = await partyWithSongs();
    const [first, second] = await queue(id, owner);

    const played = await request('POST', `/parties/${id}/next`, {}, owner);
    expect(played.body.nowPlaying.id).toBe(first.songId);
    expect((await request('POST', `/parties/${id}/next`, {}, owner)).status).toBe(409);

    const next = await request('POST', `/parties/${id}/next`, { expectedNowPlayingSongId: first.songId }, owner);
    expect(next.status).toBe(201);
    expect(next.body.nowPlaying.id).toBe(second.songId);
  });

  it('lets only one of two simultaneous nexts through', async () => {
    const { owner, id } = await partyWithSongs();
    const current = (await request('POST', `/parties/${id}/next`, {}, owner)).body.nowPlaying.id;

    const results = await Promise.all([
      request('POST', `/parties/${id}/next`, { expectedNowPlayingSongId: current }, owner),
      request('POST', `/parties/${id}/next`, { expectedNowPlayingSongId: current }, owner),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await queue(id, owner)).toHaveLength(1);
  });

  it('only lets the owner change the track', async () => {
    const { guest, id } = await partyWithSongs();
    expect((await request('POST', `/parties/${id}/next`, {}, guest)).status).toBe(403);
  });

  it('returns 409 when the queue is empty', async () => {
    const owner = await account('Owner');
    const party = await request('POST', '/parties', { name: 'Empty party' }, owner);
    expect((await request('POST', `/parties/${party.body.id}/next`, {}, owner)).status).toBe(409);
  });

  it('rejects an expected song id that is not a UUID', async () => {
    const { owner, id } = await partyWithSongs();
    expect((await request('POST', `/parties/${id}/next`, { expectedNowPlayingSongId: 'nope' }, owner)).status).toBe(400);
  });
});
