import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomBytes, randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { PrismaClient } from '../generated/prisma';
import { MailService } from '../src/mail/mail.service';
import { PartiesService } from '../src/parties/parties.service';
import { PlaylistsService } from '../src/playlists/playlists.service';
import { PrismaService } from '../src/prisma/prisma.service';
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
// The files of one run share process.env: put these back at the end
const limitsBefore = { MAX_PARTY_SONGS: process.env.MAX_PARTY_SONGS, MAX_PLAYLIST_SONGS: process.env.MAX_PLAYLIST_SONGS };

type Account = { id: string; name: string; token: string };

async function request(method: string, path: string, body?: unknown, token?: string) {
  const response = await realFetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // Not every route answers JSON: the email verification link may answer a page
  const contentType = response.headers.get('content-type') ?? '';
  return { status: response.status, body: contentType.includes('application/json') ? await response.json() : await response.text() };
}

async function account(name: string): Promise<Account> {
  const email = `${randomUUID()}@example.com`;
  const password = 'Test-password-123!';
  const registered = await request('POST', '/auth/register', { email, password, name }, undefined);
  expect(registered.status).toBe(201);
  expect((await request('GET', `/auth/verify-email?token=${verification.get(email)}`)).status).toBe(200);
  const login = await request('POST', '/auth/login', { email, password });
  expect(login.status).toBe(201);
  return { id: registered.body.id, name, token: login.body.accessToken };
}

let lastTrack = 8000;
const track = () => String(lastTrack++); // a Deezer id no other test used
const cover = (externalId: string) => `https://cdn.example/${externalId}.jpg`;

const created = (owner: Account, body: object) =>
  request('POST', '/playlists', body, owner.token).then((answer) => answer.body.id as string);
const add = (id: string, user: Account, externalId = track()) =>
  request('POST', `/playlists/${id}/songs`, { externalId }, user.token);



beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required; tests use a disposable schema within this database.');
  const url = new URL(process.env.TEST_DATABASE_URL);
  admin = new PrismaClient({ datasources: { db: { url: url.href } } });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  url.searchParams.set('schema', schema);
  Object.assign(process.env, {
    DATABASE_URL: url.href,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '7d', GOOGLE_AUTH_ENABLED: 'false',
    // This whole file runs with small limits, different so that each list is seen to follow its own
    MAX_PARTY_SONGS: '3', MAX_PLAYLIST_SONGS: '4',
  });
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    env: process.env, stdio: 'pipe', timeout: 60000,
  });

  // Fake Deezer: answers /track/:id with a track of that id and its own picture; any other request goes through
  deezer = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const match = target.match(/^https:\/\/api\.deezer\.com\/track\/(\d+)$/);
    if (!match) return realFetch(input, init);
    return new Response(JSON.stringify({
      id: Number(match[1]), title: `Track ${match[1]}`, duration: 200, link: `https://www.deezer.com/track/${match[1]}`,
      preview: '', artist: { name: 'Test Artist' }, album: { cover_medium: cover(match[1]) },
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
  for (const [name, value] of Object.entries(limitsBefore)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('The song limits come from MAX_PARTY_SONGS (3 here) and MAX_PLAYLIST_SONGS (4 here)', () => {
  // Rows added straight into the database, past the limit: only a snapshot's own size can then keep it to the limit
  async function bulkSongs(count: number) {
    const songs = Array.from({ length: count }, () => ({ id: randomUUID(), title: 'Bulk', artist: 'Test Artist', durationSec: 200, sourceUri: 'https://www.deezer.com' }));
    await app.get(PrismaService).song.createMany({ data: songs });
    return songs;
  }

  it('fills a party queue up to 3 songs, and its snapshot carries 3', async () => {
    const owner = await account('Owner');
    const id = (await request('POST', '/parties', { name: 'Small queue' }, owner.token)).body.id as string;
    const suggest = () => request('POST', `/parties/${id}/songs`, { externalId: track() }, owner.token);
    for (let n = 0; n < 3; n++) expect((await suggest()).status).toBe(201);
    const refused = await suggest();
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe('The queue is full (3 songs). Vote for a song already in it.');

    const { partyPlaylistId } = await app.get(PrismaService).party.findUniqueOrThrow({ where: { id } });
    await app.get(PrismaService).partySong.createMany({ data: (await bulkSongs(2)).map((song) => ({ songId: song.id, partyPlaylistId })) });
    const snapshot = await app.get(PartiesService).snapshot(id);
    expect(snapshot.queue).toHaveLength(3);
    expect(snapshot.queueLength).toBe(5);
  });

  it('fills a playlist up to 4 songs, and its snapshot carries 4', async () => {
    const owner = await account('Owner');
    const id = await created(owner, { name: 'Small playlist' });
    for (let n = 0; n < 4; n++) expect((await add(id, owner)).status).toBe(201);
    const refused = await add(id, owner);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe('This playlist is full (4 songs). Remove a song to add another.');

    await app.get(PrismaService).playlistSong.createMany({ data: (await bulkSongs(2)).map((song, n) => ({ songId: song.id, playlistId: id, position: 10 + n, addedById: owner.id })) });
    const snapshot = await app.get(PlaylistsService).snapshot(id);
    expect(snapshot.songs).toHaveLength(4);
    expect(snapshot.songsLength).toBe(6);
  });
});
