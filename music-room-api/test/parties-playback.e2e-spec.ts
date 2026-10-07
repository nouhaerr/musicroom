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

type QueueEntry = { id: string; songId: string; voteCount: number };

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

const suggest = (id: string, externalId: string, token: string) =>
  request('POST', `/parties/${id}/songs`, { externalId }, token);

// A party with the given songs suggested in this order, its owner and a guest
async function partyWithSongs(externalIds = ['1001', '1002', '1003']) {
  const owner = await account('Owner');
  const guest = await account('Guest');
  const party = await request('POST', '/parties', { name: 'Playback test' }, owner);
  expect(party.status).toBe(201);
  for (const externalId of externalIds) expect((await suggest(party.body.id, externalId, owner)).status).toBe(201);
  return { owner, guest, id: party.body.id as string };
}

const queue = async (id: string, token: string): Promise<QueueEntry[]> =>
  (await request('GET', `/parties/${id}/queue`, undefined, token)).body;

const detail = async (id: string, token: string) => (await request('GET', `/parties/${id}`, undefined, token)).body;

const next = (id: string, token: string, expectedPlaybackVersion: unknown) =>
  request('POST', `/parties/${id}/next`, { expectedPlaybackVersion }, token);

// What a client compares before and after a refused request: playback and queue must be untouched
const snapshot = async (id: string, token: string) => {
  const party = await detail(id, token);
  return {
    playing: party.nowPlaying?.id ?? null,
    version: party.playbackVersion,
    queue: (await queue(id, token)).map((entry) => entry.id),
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs `body` while a trigger slows one kind of statement down (test schema only), so that two
// requests overlap at a chosen point on every run instead of only when the timing is unlucky
async function withSlowTrigger(table: string, timing: string, body: () => Promise<void>) {
  await admin.$executeRawUnsafe(`
    CREATE FUNCTION "${schema}".slow_down() RETURNS trigger AS $$
    BEGIN PERFORM pg_sleep(1); RETURN COALESCE(NEW, OLD); END $$ LANGUAGE plpgsql`);
  await admin.$executeRawUnsafe(`
    CREATE TRIGGER slow_down ${timing} ON "${schema}"."${table}"
    FOR EACH ROW EXECUTE FUNCTION "${schema}".slow_down()`);
  try {
    await body();
  } finally {
    await admin.$executeRawUnsafe(`DROP TRIGGER slow_down ON "${schema}"."${table}"`);
    await admin.$executeRawUnsafe(`DROP FUNCTION "${schema}".slow_down()`);
  }
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
    expect((await detail(id, guest)).playbackVersion).toBe(0);
    const last = (await queue(id, owner))[2];
    expect((await request('POST', `/parties/${id}/songs/${last.id}/vote`, {}, guest)).status).toBe(201);

    const played = await next(id, owner, 0);
    expect(played.status).toBe(201);
    expect(played.body.nowPlaying.id).toBe(last.songId);
    expect(played.body.playbackVersion).toBe(1);

    const remaining = await queue(id, owner);
    expect(remaining).toHaveLength(2);
    expect(remaining.some((entry) => entry.songId === last.songId)).toBe(false);
    const seenByGuest = await detail(id, guest);
    expect(seenByGuest.nowPlaying.id).toBe(last.songId);
    expect(seenByGuest.playbackVersion).toBe(1);
  });

  it('plays the earliest suggestion when votes are tied', async () => {
    const { owner, id } = await partyWithSongs();
    const [first, second] = await queue(id, owner);

    expect((await next(id, owner, 0)).body.nowPlaying.id).toBe(first.songId);
    expect((await next(id, owner, 1)).body.nowPlaying.id).toBe(second.songId);
  });

  it('only lets the owner change the track', async () => {
    const { guest, id } = await partyWithSongs();
    expect((await next(id, guest, 0)).status).toBe(403);
  });

  it('rejects a missing, malformed or out-of-range version with 400', async () => {
    const { owner, id } = await partyWithSongs();
    const before = await snapshot(id, owner);

    expect((await request('POST', `/parties/${id}/next`, {}, owner)).status).toBe(400);
    for (const version of ['0', -1, 1.5, null, 2147483648, 1e21]) {
      expect((await next(id, owner, version)).status).toBe(400);
    }
    expect((await request('POST', `/parties/${id}/next`, { expectedNowPlayingSongId: randomUUID() }, owner)).status).toBe(400);
    expect(await snapshot(id, owner)).toEqual(before);
  });
});

describe('Party playback: the optimistic lock', () => {
  it('refuses a stale version with 409 and changes neither playback nor the queue', async () => {
    const { owner, id } = await partyWithSongs();
    expect((await next(id, owner, 0)).status).toBe(201);
    const before = await snapshot(id, owner);

    expect((await next(id, owner, 0)).status).toBe(409);
    expect((await next(id, owner, 5)).status).toBe(409);
    expect(await snapshot(id, owner)).toEqual(before);
  });

  it('refuses a replayed request after the same song is suggested and played again', async () => {
    const { owner, id } = await partyWithSongs(['1001', '1002']);
    const songA = (await next(id, owner, 0)).body.nowPlaying.id;

    const again = await suggest(id, '1001', owner);
    expect(again.status).toBe(201);
    expect((await request('POST', `/parties/${id}/songs/${again.body.id}/vote`, {}, owner)).status).toBe(201);
    const replayed = await next(id, owner, 1);
    expect(replayed.status).toBe(201);
    expect(replayed.body.nowPlaying.id).toBe(songA);
    const before = await snapshot(id, owner);

    // The exact request that just succeeded, sent again from the old playback state
    expect((await next(id, owner, 1)).status).toBe(409);
    expect(await snapshot(id, owner)).toEqual(before);
  });

  it('refuses a request from the first A after an A -> B -> A sequence', async () => {
    const { owner, id } = await partyWithSongs(['1001', '1002', '1003']);
    const songA = (await next(id, owner, 0)).body.nowPlaying.id;
    const songB = (await next(id, owner, 1)).body.nowPlaying.id;
    expect(songB).not.toBe(songA);

    const again = await suggest(id, '1001', owner);
    expect((await request('POST', `/parties/${id}/songs/${again.body.id}/vote`, {}, owner)).status).toBe(201);
    const backToA = await next(id, owner, 2);
    expect(backToA.body.nowPlaying.id).toBe(songA);
    expect(backToA.body.playbackVersion).toBe(3);
    const before = await snapshot(id, owner);

    // A is playing again, but this request was made when A was playing the first time
    expect((await next(id, owner, 1)).status).toBe(409);
    expect(await snapshot(id, owner)).toEqual(before);
  });

  it('lets exactly one of several simultaneous requests with the same version through', async () => {
    const { owner, id } = await partyWithSongs(['1001', '1002', '1003', '1004', '1005']);
    expect((await next(id, owner, 0)).status).toBe(201);

    const results = await Promise.all(Array.from({ length: 4 }, () => next(id, owner, 1)));

    expect(results.map((result) => result.status).sort()).toEqual([201, 409, 409, 409]);
    const after = await snapshot(id, owner);
    expect(after.version).toBe(2);
    expect(after.queue).toHaveLength(3);
    expect(after.playing).toBe(results.find((result) => result.status === 201)!.body.nowPlaying.id);
  });
});

describe('Party playback: the end of the queue', () => {
  it('stops playback when the queue is empty, then has nothing left to do', async () => {
    const { owner, guest, id } = await partyWithSongs(['1001']);
    expect((await next(id, owner, 0)).body.nowPlaying.id).toBeDefined();

    const stopped = await next(id, owner, 1);
    expect(stopped.status).toBe(201);
    expect(stopped.body.nowPlaying).toBeNull();
    expect(stopped.body.nowPlayingStartedAt).toBeNull();
    expect(stopped.body.playbackVersion).toBe(2);
    expect((await detail(id, guest)).nowPlaying).toBeNull();

    // Nothing is playing and nothing is queued: refused, and the version does not move
    expect((await next(id, owner, 2)).status).toBe(409);
    expect((await detail(id, owner)).playbackVersion).toBe(2);
  });

  it('returns 409 on a party that never had any song', async () => {
    const owner = await account('Owner');
    const party = await request('POST', '/parties', { name: 'Empty party' }, owner);
    expect((await next(party.body.id, owner, 0)).status).toBe(409);
    expect((await detail(party.body.id, owner)).playbackVersion).toBe(0);
  });

  it('plays again when a song is suggested after playback stopped', async () => {
    const { owner, id } = await partyWithSongs(['1001']);
    await next(id, owner, 0);
    await next(id, owner, 1);

    expect((await suggest(id, '1002', owner)).status).toBe(201);
    const resumed = await next(id, owner, 2);
    expect(resumed.status).toBe(201);
    expect(resumed.body.nowPlaying.title).toBe('Track 1002');
  });
});

describe('Party playback: votes arriving while the track changes', () => {
  it('answers 404 to a vote for a song that starts playing at the same moment', async () => {
    const { owner, guest, id } = await partyWithSongs(['1001', '1002']);
    const top = (await queue(id, owner))[0];

    // The vote passes its checks, then its INSERT is held back while "next" removes the song
    await withSlowTrigger('Vote', 'BEFORE INSERT', async () => {
      const vote = request('POST', `/parties/${id}/songs/${top.id}/vote`, {}, guest);
      await sleep(300);
      const played = await next(id, owner, 0);
      expect(played.status).toBe(201);
      expect(played.body.nowPlaying.id).toBe(top.songId);
      expect((await vote).status).toBe(404);
    });
  });

  it('lets a vote removal and "next" on the same song both succeed', async () => {
    const { owner, guest, id } = await partyWithSongs(['1001', '1002']);
    const top = (await queue(id, owner))[0];
    expect((await request('POST', `/parties/${id}/songs/${top.id}/vote`, {}, guest)).status).toBe(201);

    // The removal deletes the vote, then pauses before updating the song's counter:
    // "next" arrives in between and wants the same two rows
    await withSlowTrigger('Vote', 'AFTER DELETE', async () => {
      const removal = request('DELETE', `/parties/${id}/songs/${top.id}/vote`, undefined, guest);
      await sleep(300);
      const played = await next(id, owner, 0);
      expect((await removal).status).toBe(200);
      expect(played.status).toBe(201);
      expect(played.body.nowPlaying.id).toBe(top.songId);
    });
  });

  it('keeps a vote that was cast just before the song starts playing from breaking "next"', async () => {
    const { owner, guest, id } = await partyWithSongs(['1001', '1002']);
    const top = (await queue(id, owner))[0];
    expect((await request('POST', `/parties/${id}/songs/${top.id}/vote`, {}, guest)).status).toBe(201);

    const played = await next(id, owner, 0);
    expect(played.status).toBe(201);
    expect(played.body.nowPlaying.id).toBe(top.songId);
    expect(await queue(id, owner)).toHaveLength(1);
  });
});
