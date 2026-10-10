import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomBytes, randomUUID } from 'crypto';
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

type Entry = { id: string; songId: string; position: number };

async function request(method: string, path: string, body?: unknown, token?: string) {
  const response = await realFetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function account(): Promise<{ id: string; token: string }> {
  const email = `${randomUUID()}@example.com`;
  const password = 'Test-password-123!';
  const registered = await request('POST', '/auth/register', { email, password, name: 'Editor' });
  expect(registered.status).toBe(201);
  expect((await request('GET', `/auth/verify-email?token=${verification.get(email)}`)).status).toBe(200);
  const login = await request('POST', '/auth/login', { email, password });
  expect(login.status).toBe(201);
  return { id: registered.body.id, token: login.body.accessToken };
}

let lastTrack = 7000;
const track = () => String(lastTrack++); // a Deezer id no other test used

const add = (id: string, token: string, extra: Record<string, unknown> = {}) =>
  request('POST', `/playlists/${id}/songs`, { externalId: track(), ...extra }, token);
const move = (id: string, entryId: string, token: string, position: number, expectedPosition: number) =>
  request('PATCH', `/playlists/${id}/songs/${entryId}`, { position, expectedPosition }, token);
const remove = (id: string, entryId: string, token: string) =>
  request('DELETE', `/playlists/${id}/songs/${entryId}`, undefined, token);
const songs = async (id: string, token: string): Promise<Entry[]> =>
  (await request('GET', `/playlists/${id}/songs?limit=100`, undefined, token)).body;

// A playlist with `count` songs added by its owner, in this order
async function playlistWithSongs(count: number, options: Record<string, unknown> = {}) {
  const owner = await account();
  const created = await request('POST', '/playlists', { name: 'Editing test', ...options }, owner.token);
  expect(created.status).toBe(201);
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const added = await add(created.body.id, owner.token);
    expect(added.status).toBe(201);
    entries.push(added.body);
  }
  return { owner, id: created.body.id as string, entries };
}

// Runs `body` while a trigger slows one kind of statement down (test schema only), so that
// requests overlap at a chosen point on every run instead of only when the timing is unlucky
async function withSlowTrigger(table: string, timing: string, seconds: number, body: () => Promise<void>) {
  await admin.$executeRawUnsafe(`
    CREATE FUNCTION "${schema}".slow_down() RETURNS trigger AS $$
    BEGIN PERFORM pg_sleep(${seconds}); RETURN COALESCE(NEW, OLD); END $$ LANGUAGE plpgsql`);
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

const statuses = (answers: { status: number }[]) => answers.map((answer) => answer.status).sort();

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

describe('Playlist editing', () => {
  it('adds songs at the end, in the order they were added', async () => {
    const { owner, id, entries } = await playlistWithSongs(3);

    expect(entries.map((entry) => entry.position)).toEqual([1, 2, 3]);
    expect((await songs(id, owner.token)).map((entry) => entry.id)).toEqual(entries.map((entry) => entry.id));
  });

  it('adds a song at the position the client asks for', async () => {
    const { owner, id, entries } = await playlistWithSongs(2);

    const between = await add(id, owner.token, { position: 1.5 });

    expect(between.status).toBe(201);
    expect((await songs(id, owner.token)).map((entry) => entry.id)).toEqual([entries[0].id, between.body.id, entries[1].id]);
  });

  it('refuses a song that is already in the playlist', async () => {
    const { owner, id } = await playlistWithSongs(0);
    const externalId = track();
    expect((await request('POST', `/playlists/${id}/songs`, { externalId }, owner.token)).status).toBe(201);

    expect((await request('POST', `/playlists/${id}/songs`, { externalId }, owner.token)).status).toBe(409);
    expect(await songs(id, owner.token)).toHaveLength(1);
  });

  it('moves a song when the client knows its current position', async () => {
    const { owner, id, entries } = await playlistWithSongs(3);

    const moved = await move(id, entries[2].id, owner.token, 0.5, 3);

    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ id: entries[2].id, position: 0.5 });
    expect((await songs(id, owner.token)).map((entry) => entry.id)).toEqual([entries[2].id, entries[0].id, entries[1].id]);
  });

  it('refuses a move based on an old position, and changes nothing', async () => {
    const { owner, id, entries } = await playlistWithSongs(2);
    expect((await move(id, entries[0].id, owner.token, 5, 1)).status).toBe(200);

    expect((await move(id, entries[0].id, owner.token, 9, 1)).status).toBe(409);
    expect((await songs(id, owner.token)).map((entry) => entry.position)).toEqual([2, 5]);
  });

  it('removes a song, once', async () => {
    const { owner, id, entries } = await playlistWithSongs(2);

    expect(await remove(id, entries[0].id, owner.token)).toEqual({ status: 200, body: { deleted: true } });
    expect((await songs(id, owner.token)).map((entry) => entry.id)).toEqual([entries[1].id]);
    expect((await remove(id, entries[0].id, owner.token)).status).toBe(404);
  });

  it('answers 404 for a song that is not in this playlist', async () => {
    const { owner, id } = await playlistWithSongs(1);
    const other = await playlistWithSongs(1);
    const foreign = other.entries[0];

    expect((await move(id, randomUUID(), owner.token, 5, 1)).status).toBe(404);
    expect((await remove(id, randomUUID(), owner.token)).status).toBe(404);
    // A song of another playlist, reached through this playlist's URL
    expect((await move(id, foreign.id, owner.token, 5, foreign.position)).status).toBe(404);
    expect((await remove(id, foreign.id, owner.token)).status).toBe(404);
    expect(await songs(other.id, other.owner.token)).toMatchObject([{ id: foreign.id, position: foreign.position }]);
  });

  it('lets only the owner and collaborators edit when the licence is INVITED_ONLY', async () => {
    const { owner, id, entries } = await playlistWithSongs(1, { editLicense: 'INVITED_ONLY' });
    const visitor = await account();

    expect((await songs(id, visitor.token)).map((entry) => entry.id)).toEqual([entries[0].id]);
    expect((await add(id, visitor.token)).status).toBe(403);
    expect((await move(id, entries[0].id, visitor.token, 5, 1)).status).toBe(403);
    expect((await remove(id, entries[0].id, visitor.token)).status).toBe(403);
    expect(await songs(id, owner.token)).toMatchObject([{ id: entries[0].id, position: 1 }]);
  });
});

describe('Playlist editing: several people at the same moment', () => {
  it('lets exactly one of several simultaneous moves of the same song succeed', async () => {
    const { owner, id, entries } = await playlistWithSongs(1);

    // Every move is slowed down, so all of them have read the old position before the first one writes
    await withSlowTrigger('PlaylistSong', 'BEFORE UPDATE', 1, async () => {
      const answers = await Promise.all([10, 20, 30, 40].map((position) => move(id, entries[0].id, owner.token, position, 1)));

      expect(statuses(answers)).toEqual([200, 409, 409, 409]);
      const winner = answers.find((answer) => answer.status === 200)!;
      expect(await songs(id, owner.token)).toMatchObject([{ id: entries[0].id, position: winner.body.position }]);
    });
  });

  it('answers 404, not a server error, to all but one of several simultaneous removals', async () => {
    const { owner, id, entries } = await playlistWithSongs(2);

    await withSlowTrigger('PlaylistSong', 'BEFORE DELETE', 1, async () => {
      const answers = await Promise.all(Array.from({ length: 4 }, () => remove(id, entries[0].id, owner.token)));

      expect(statuses(answers)).toEqual([200, 404, 404, 404]);
      expect((await songs(id, owner.token)).map((entry) => entry.id)).toEqual([entries[1].id]);
    });
  });

  it('answers 404 to a move that arrives while the song is being removed', async () => {
    const { owner, id, entries } = await playlistWithSongs(1);

    await withSlowTrigger('PlaylistSong', 'BEFORE DELETE', 1, async () => {
      const removing = remove(id, entries[0].id, owner.token);
      await new Promise((resolve) => setTimeout(resolve, 300)); // the removal now holds the row
      const moved = await move(id, entries[0].id, owner.token, 5, 1);

      expect(moved.status).toBe(404);
      expect((await removing).status).toBe(200);
      expect(await songs(id, owner.token)).toEqual([]);
    });
  });

  it('lets a move finish, then removes the song, when the removal arrives during the move', async () => {
    const { owner, id, entries } = await playlistWithSongs(1);

    await withSlowTrigger('PlaylistSong', 'BEFORE UPDATE', 1, async () => {
      const moving = move(id, entries[0].id, owner.token, 5, 1);
      await new Promise((resolve) => setTimeout(resolve, 300)); // the move now holds the row
      const removed = await remove(id, entries[0].id, owner.token);

      expect((await moving).status).toBe(200);
      expect(removed.status).toBe(200);
      expect(await songs(id, owner.token)).toEqual([]);
    });
  });

  it('gives simultaneous additions at the end different positions', async () => {
    const { owner, id } = await playlistWithSongs(1);

    // Every insertion is slowed down, so all of them would read the same "last position" first
    await withSlowTrigger('PlaylistSong', 'BEFORE INSERT', 0.3, async () => {
      const answers = await Promise.all(Array.from({ length: 4 }, () => add(id, owner.token)));

      expect(statuses(answers)).toEqual([201, 201, 201, 201]);
      expect(answers.map((answer) => answer.body.position).sort()).toEqual([2, 3, 4, 5]);
      expect((await songs(id, owner.token)).map((entry) => entry.position)).toEqual([1, 2, 3, 4, 5]);
    });
  });

  it('still refuses the same song added twice at the same moment', async () => {
    const { owner, id } = await playlistWithSongs(0);
    const externalId = track();

    await withSlowTrigger('PlaylistSong', 'BEFORE INSERT', 0.3, async () => {
      const answers = await Promise.all(Array.from({ length: 3 }, () => request('POST', `/playlists/${id}/songs`, { externalId }, owner.token)));

      expect(statuses(answers)).toEqual([201, 409, 409]);
      expect(await songs(id, owner.token)).toHaveLength(1);
    });
  });
});
