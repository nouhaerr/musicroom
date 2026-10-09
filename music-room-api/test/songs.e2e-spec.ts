import { BadGatewayException, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { PrismaClient } from '../generated/prisma';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SongsModule } from '../src/songs/songs.module';
import { SongsService } from '../src/songs/songs.service';

// Every run creates and drops ONLY its own random schema (same pattern as auth-users.e2e-spec.ts)
const schema = `musicroom_test_${randomUUID().replace(/-/g, '')}`;
let admin: PrismaClient;
let schemaCreated = false;
let testModule: TestingModule;
let songs: SongsService;
let db: PrismaService;
let fetchSpy: jest.SpyInstance;

// What Deezer answers for this track, whichever spelling of the id was requested
const deezerTrack = {
  id: 67238732,
  title: 'Instant Crush (feat. Julian Casablancas)',
  duration: 337,
  link: 'https://www.deezer.com/track/67238732',
  preview: 'https://cdnt-preview.dzcdn.net/preview.mp3',
  artist: { name: 'Daft Punk' },
  album: { cover_medium: 'https://cdn-images.dzcdn.net/cover.jpg' },
};

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required; tests use a disposable schema within this database.');
  const url = new URL(process.env.TEST_DATABASE_URL);
  admin = new PrismaClient({ datasources: { db: { url: url.href } } });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  url.searchParams.set('schema', schema);
  process.env.DATABASE_URL = url.href;
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    env: process.env, stdio: 'pipe', timeout: 60000,
  });

  testModule = await Test.createTestingModule({ imports: [PrismaModule, SongsModule] }).compile();
  await testModule.init();
  songs = testModule.get(SongsService);
  db = testModule.get(PrismaService);
});

afterAll(async () => {
  if (testModule) await testModule.close();
  if (schemaCreated) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  if (admin) await admin.$disconnect();
});

beforeEach(async () => {
  await db.song.deleteMany();
  // Fake Deezer that answers after 50 ms: concurrent imports all miss the database first,
  // then all try to insert at the same moment
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return new Response(JSON.stringify(deezerTrack), { status: 200 });
  });
});

afterEach(() => fetchSpy.mockRestore());

describe('SongsService.findOrCreateByExternalId', () => {
  it('imports a track once when concurrent requests race for it', async () => {
    // Slow down every INSERT into Song (test schema only): all requests check the table
    // before any of them has inserted, which makes the race happen on every run
    await admin.$executeRawUnsafe(`
      CREATE FUNCTION "${schema}".slow_song_insert() RETURNS trigger AS $$
      BEGIN PERFORM pg_sleep(0.2); RETURN NEW; END $$ LANGUAGE plpgsql`);
    await admin.$executeRawUnsafe(`
      CREATE TRIGGER slow_song_insert BEFORE INSERT ON "${schema}"."Song"
      FOR EACH ROW EXECUTE FUNCTION "${schema}".slow_song_insert()`);

    try {
      const results = await Promise.all(
        Array.from({ length: 5 }, () => songs.findOrCreateByExternalId('67238732')),
      );

      expect(new Set(results.map((song) => song.id)).size).toBe(1);
      expect(await db.song.count({ where: { externalId: '67238732' } })).toBe(1);
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER slow_song_insert ON "${schema}"."Song"`);
    }
  });

  it('resolves different spellings of the same Deezer id to one song', async () => {
    const padded = await songs.findOrCreateByExternalId('067238732');
    const plain = await songs.findOrCreateByExternalId('67238732');

    expect(plain.id).toBe(padded.id);
    expect(padded.externalId).toBe('67238732');
    expect(await db.song.count()).toBe(1);
  });

  // Each of these made the import fail in the database (or stored a wrong row) before the
  // Deezer answer was fully validated: the catalog is at fault (502), and nothing is stored
  it.each([
    ['a duration above 32 bits', { duration: 2 ** 31 }],
    ['a decimal duration', { duration: 1.5 }],
    ['a title with a NUL character', { title: 'a\u0000b' }],
    ['an artist with a NUL character', { artist: { name: 'a\u0000b' } }],
    ['a title too long to be indexed', { title: randomBytes(1500).toString('hex') }],
    ['a cover that is not text', { album: { cover_medium: { url: 'https://cdn-images.dzcdn.net/cover.jpg' } } }],
    ['a decimal id', { id: 1.5 }],
    ['an error that is null', { error: null }],
  ])('refuses to import a track with %s, and stores nothing', async (_label, fields) => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ ...deezerTrack, ...fields }), { status: 200 }));

    await expect(songs.findOrCreateByExternalId('67238732')).rejects.toBeInstanceOf(BadGatewayException);

    expect(await db.song.count()).toBe(0);
    warn.mockRestore();
  });

  it('stores a track with the longest title and duration the validation accepts', async () => {
    // 500 random characters of 3 bytes each: the worst case for the index on Song.title
    const title = Array.from({ length: 500 }, () => String.fromCharCode(0x4e00 + Math.floor(Math.random() * 0x5000))).join('');
    fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ ...deezerTrack, title, duration: 2 ** 31 - 1 }), { status: 200 }));

    const song = await songs.findOrCreateByExternalId('67238732');

    expect(song).toMatchObject({ title, durationSec: 2 ** 31 - 1 });
  });
});
