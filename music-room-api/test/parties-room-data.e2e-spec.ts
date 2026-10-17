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

type Account = { id: string; name: string; email: string; token: string };
type Card = { id: string; name: string; owner?: Record<string, unknown>; nowPlaying?: { title: string } | null };

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
  const registered = await request('POST', '/auth/register', { email, password, name });
  expect(registered.status).toBe(201);
  expect((await request('GET', `/auth/verify-email?token=${verification.get(email)}`)).status).toBe(200);
  const login = await request('POST', '/auth/login', { email, password });
  expect(login.status).toBe(201);
  return { id: registered.body.id, name, email, token: login.body.accessToken };
}

// A party of this owner with the given songs suggested in this order: returns its id and the queue entry ids
async function party(owner: Account, options: { visibility?: 'PUBLIC' | 'PRIVATE'; songs?: string[] } = {}) {
  const created = await request('POST', '/parties', { name: `Room ${randomUUID()}`, visibility: options.visibility ?? 'PUBLIC' }, owner.token);
  expect(created.status).toBe(201);
  const entries: string[] = [];
  for (const externalId of options.songs ?? []) {
    const suggested = await request('POST', `/parties/${created.body.id}/songs`, { externalId }, owner.token);
    expect(suggested.status).toBe(201);
    entries.push(suggested.body.id);
  }
  return { id: created.body.id as string, name: created.body.name as string, entries };
}

const vote = (id: string, entry: string, user: Account) => request('POST', `/parties/${id}/songs/${entry}/vote`, {}, user.token);
const unvote = (id: string, entry: string, user: Account) => request('DELETE', `/parties/${id}/songs/${entry}/vote`, undefined, user.token);
const myVotes = (id: string, user: Account, query = '') => request('GET', `/parties/${id}/votes/mine${query}`, undefined, user.token);
const invite = (id: string, owner: Account, guest: Account) => request('POST', `/parties/${id}/invite`, { userId: guest.id }, owner.token);

// The card of one party in a list, or undefined when the list does not show it
async function card(path: string, id: string, user: Account): Promise<Card | undefined> {
  const list = await request('GET', `${path}?limit=100`, undefined, user.token);
  expect(list.status).toBe(200);
  return (list.body as Card[]).find((entry) => entry.id === id);
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

describe('My votes in a party (GET /parties/:id/votes/mine)', () => {
  it('lists the queue entries the caller voted for, oldest vote first', async () => {
    const owner = await account('Owner');
    const room = await party(owner, { songs: ['2001', '2002', '2003'] });
    expect((await myVotes(room.id, owner)).body).toEqual([]);

    expect((await vote(room.id, room.entries[2], owner)).status).toBe(201);
    expect((await vote(room.id, room.entries[0], owner)).status).toBe(201);
    const votes = await myVotes(room.id, owner);
    expect(votes.status).toBe(200);
    expect(votes.body).toEqual([room.entries[2], room.entries[0]]);
  });

  it('orders by the date of the vote, not by the order the database happens to return', async () => {
    const owner = await account('Owner');
    const room = await party(owner, { songs: ['2011', '2012', '2013'] });
    for (const entry of room.entries) expect((await vote(room.id, entry, owner)).status).toBe(201);
    // Make the last vote the oldest one: rewriting the row also moves it in the table
    await admin.$executeRawUnsafe(
      `UPDATE "${schema}"."Vote" SET "createdAt" = '2000-01-01' WHERE "partySongId" = $1 AND "userId" = $2`, room.entries[2], owner.id);
    expect((await myVotes(room.id, owner)).body).toEqual([room.entries[2], room.entries[0], room.entries[1]]);
  });

  it('orders votes of the same instant by id, so that two pages never repeat or skip one', async () => {
    const owner = await account('Owner');
    const room = await party(owner, { songs: ['2014', '2015', '2016'] });
    for (const entry of room.entries) expect((await vote(room.id, entry, owner)).status).toBe(201);
    const votes: { id: string; partySongId: string }[] = await admin.$queryRawUnsafe(
      `SELECT id, "partySongId" FROM "${schema}"."Vote" WHERE "userId" = $1 ORDER BY id DESC`, owner.id);
    // Same date for the three, rewritten from the largest id to the smallest: the table now holds them in the opposite order
    for (const { id } of votes) {
      await admin.$executeRawUnsafe(`UPDATE "${schema}"."Vote" SET "createdAt" = '2000-01-01' WHERE id = $1`, id);
    }
    const expected = [...votes].reverse().map((entry) => entry.partySongId);
    expect((await myVotes(room.id, owner)).body).toEqual(expected);
    expect((await myVotes(room.id, owner, '?limit=2')).body).toEqual(expected.slice(0, 2));
    expect((await myVotes(room.id, owner, '?limit=2&page=2')).body).toEqual(expected.slice(2));
  });

  it('never lists the votes of someone else', async () => {
    const owner = await account('Owner');
    const guest = await account('Guest');
    const room = await party(owner, { songs: ['2021', '2022'] });
    expect((await vote(room.id, room.entries[0], owner)).status).toBe(201);
    expect((await vote(room.id, room.entries[1], guest)).status).toBe(201);
    expect((await myVotes(room.id, owner)).body).toEqual([room.entries[0]]);
    expect((await myVotes(room.id, guest)).body).toEqual([room.entries[1]]);
  });

  it('never lists the votes cast in another party', async () => {
    const owner = await account('Owner');
    const room = await party(owner, { songs: ['2031'] });
    const other = await party(owner, { songs: ['2031', '2032'] });
    expect((await vote(other.id, other.entries[0], owner)).status).toBe(201);
    expect((await vote(other.id, other.entries[1], owner)).status).toBe(201);
    expect((await myVotes(room.id, owner)).body).toEqual([]);
    expect((await vote(room.id, room.entries[0], owner)).status).toBe(201);
    expect((await myVotes(room.id, owner)).body).toEqual([room.entries[0]]);
    expect((await myVotes(other.id, owner)).body).toEqual([other.entries[0], other.entries[1]]);
  });

  it('forgets a vote that was removed', async () => {
    const owner = await account('Owner');
    const room = await party(owner, { songs: ['2041', '2042'] });
    expect((await vote(room.id, room.entries[0], owner)).status).toBe(201);
    expect((await vote(room.id, room.entries[1], owner)).status).toBe(201);
    expect((await unvote(room.id, room.entries[0], owner)).status).toBe(200);
    expect((await myVotes(room.id, owner)).body).toEqual([room.entries[1]]);
  });

  it('forgets the vote for a song that has started playing', async () => {
    const owner = await account('Owner');
    const room = await party(owner, { songs: ['2051', '2052'] });
    expect((await vote(room.id, room.entries[0], owner)).status).toBe(201);
    expect((await request('POST', `/parties/${room.id}/next`, { expectedPlaybackVersion: 0 }, owner.token)).status).toBe(201);
    expect((await myVotes(room.id, owner)).body).toEqual([]);
  });

  it('is paginated like every list: pages do not overlap and bad values are refused', async () => {
    const owner = await account('Owner');
    const room = await party(owner, { songs: ['2061', '2062', '2063'] });
    for (const entry of room.entries) expect((await vote(room.id, entry, owner)).status).toBe(201);

    expect((await myVotes(room.id, owner, '?limit=2')).body).toEqual([room.entries[0], room.entries[1]]);
    expect((await myVotes(room.id, owner, '?limit=2&page=2')).body).toEqual([room.entries[2]]);
    expect((await myVotes(room.id, owner, '?limit=2&page=3')).body).toEqual([]);
    for (const query of ['?limit=101', '?limit=0', '?page=0', '?limit=abc', '?page=1.5', '?unknown=1']) {
      expect((await myVotes(room.id, owner, query)).status).toBe(400);
    }
  });

  it('needs a login, and an existing party', async () => {
    const owner = await account('Owner');
    const room = await party(owner);
    expect((await request('GET', `/parties/${room.id}/votes/mine`)).status).toBe(401);
    expect((await myVotes(randomUUID(), owner)).status).toBe(404);
    expect((await myVotes('not-an-id', owner)).status).toBe(404);
  });

  it('follows the access rule of GET /parties/:id on a private party', async () => {
    const owner = await account('Owner');
    const guest = await account('Guest');
    const stranger = await account('Stranger');
    const room = await party(owner, { visibility: 'PRIVATE', songs: ['2071'] });

    expect((await myVotes(room.id, owner)).status).toBe(200);
    expect((await myVotes(room.id, stranger)).status).toBe(403);
    expect((await myVotes(room.id, guest)).status).toBe(403);

    // A pending invitation is enough to see the party, so it is enough here
    const invitation = await invite(room.id, owner, guest);
    expect(invitation.status).toBe(201);
    expect((await myVotes(room.id, guest)).body).toEqual([]);
    expect((await vote(room.id, room.entries[0], guest)).status).toBe(201);
    expect((await myVotes(room.id, guest)).body).toEqual([room.entries[0]]);

    // Revoked: the guest no longer sees the party, nor their own votes in it
    expect((await request('DELETE', `/parties/${room.id}/invitations/${guest.id}`, undefined, owner.token)).status).toBe(200);
    expect((await myVotes(room.id, guest)).status).toBe(403);
    expect((await request('GET', `/parties/${room.id}`, undefined, guest.token)).status).toBe(403);
  });

  it('refuses a guest who declined the invitation', async () => {
    const owner = await account('Owner');
    const guest = await account('Guest');
    const room = await party(owner, { visibility: 'PRIVATE' });
    const invitation = await invite(room.id, owner, guest);
    expect((await myVotes(room.id, guest)).status).toBe(200);
    expect((await request('POST', `/invitations/${invitation.body.id}/decline`, {}, guest.token)).status).toBe(201);
    expect((await myVotes(room.id, guest)).status).toBe(403);
  });
});

describe('Party lists (GET /parties and GET /parties/mine)', () => {
  it('show who hosts each party, with the id and the name only', async () => {
    const owner = await account('Maya Chen');
    const visitor = await account('Visitor');
    const room = await party(owner);

    for (const [path, user] of [['/parties', visitor], ['/parties', owner], ['/parties/mine', owner]] as const) {
      const found = await card(path, room.id, user);
      expect(found?.owner).toEqual({ id: owner.id, name: 'Maya Chen' });
    }
    // Nothing of the account leaks through the list, whatever the user model contains
    const text = JSON.stringify((await request('GET', '/parties?limit=100', undefined, visitor.token)).body);
    expect(text).not.toContain(owner.email);
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('privateInfo');
    expect(text).not.toContain('friendsOnlyInfo');
  });

  it('show what is playing, or null when nothing is', async () => {
    const owner = await account('Owner');
    const visitor = await account('Visitor');
    const room = await party(owner, { songs: ['2101', '2102'] });

    expect((await card('/parties', room.id, visitor))?.nowPlaying).toBeNull();
    expect((await card('/parties/mine', room.id, owner))?.nowPlaying).toBeNull();

    expect((await request('POST', `/parties/${room.id}/next`, { expectedPlaybackVersion: 0 }, owner.token)).status).toBe(201);
    expect((await card('/parties', room.id, visitor))?.nowPlaying).toMatchObject({ title: 'Track 2101', artist: 'Test Artist' });
    expect((await card('/parties/mine', room.id, owner))?.nowPlaying).toMatchObject({ title: 'Track 2101', artist: 'Test Artist' });
  });

  it('keep every field a party had before, and the same answer as the detail for playback', async () => {
    const owner = await account('Owner');
    const room = await party(owner, { songs: ['2111'] });
    expect((await request('POST', `/parties/${room.id}/next`, { expectedPlaybackVersion: 0 }, owner.token)).status).toBe(201);

    const detail = (await request('GET', `/parties/${room.id}`, undefined, owner.token)).body;
    const found = await card('/parties', room.id, owner);
    expect(found).toEqual({ ...detail, owner: { id: owner.id, name: 'Owner' }, playingForMs: expect.any(Number) });
    expect(found).toMatchObject({ id: room.id, name: room.name, visibility: 'PUBLIC', voteLicense: 'EVERYONE', playbackVersion: 1 });
  });

  it('still hide a private party from anyone who is neither its owner nor invited', async () => {
    const owner = await account('Owner');
    const guest = await account('Guest');
    const stranger = await account('Stranger');
    const room = await party(owner, { visibility: 'PRIVATE' });
    expect((await invite(room.id, owner, guest)).status).toBe(201);

    expect(await card('/parties', room.id, stranger)).toBeUndefined();
    expect((await card('/parties', room.id, guest))?.owner).toEqual({ id: owner.id, name: 'Owner' });
    expect((await card('/parties', room.id, owner))?.id).toBe(room.id);
    // "Mine" is for the parties I own or joined: an invitation alone does not put one there
    expect(await card('/parties/mine', room.id, guest)).toBeUndefined();
    expect(await card('/parties/mine', room.id, stranger)).toBeUndefined();
  });

  it('still answer newest first, in pages', async () => {
    const owner = await account('Owner');
    const first = await party(owner);
    const second = await party(owner);
    const mine = await request('GET', '/parties/mine?limit=1', undefined, owner.token);
    expect((mine.body as Card[]).map((entry) => entry.id)).toEqual([second.id]);
    const nextPage = await request('GET', '/parties/mine?limit=1&page=2', undefined, owner.token);
    expect((nextPage.body as Card[]).map((entry) => entry.id)).toEqual([first.id]);
  });
});

// A place-and-time party: votes count only within radiusMeters of the venue, between the two dates
const venue = { latitude: 33.5731, longitude: -7.5898 };
const near = { latitude: 33.5735, longitude: -7.5898 }; // about 45 m north of the venue
const far = { latitude: 33.5831, longitude: -7.5898 }; // about 1.1 km north of the venue
const hours = (from: number, to: number) => ({
  voteStartsAt: new Date(Date.now() + from * 3_600_000).toISOString(),
  voteEndsAt: new Date(Date.now() + to * 3_600_000).toISOString(),
});
const placeAndTime = (changes: Record<string, unknown> = {}) => ({
  name: `Venue ${randomUUID()}`, voteLicense: 'LOCATION_TIME', ...venue, radiusMeters: 200, ...hours(-1, 2), ...changes,
});

describe('Creating a party (POST /parties)', () => {
  it('trims the name, and refuses one that is empty, only spaces, or longer than 100 characters', async () => {
    const owner = await account('Owner');
    const created = await request('POST', '/parties', { name: '  After Hours  ' }, owner.token);
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('After Hours');
    expect((await request('POST', '/parties', { name: 'n'.repeat(100) }, owner.token)).status).toBe(201);
    for (const name of ['', '   ', 'n'.repeat(101)]) {
      expect((await request('POST', '/parties', { name }, owner.token)).status).toBe(400);
    }
  });

  it('creates a place-and-time party with its area and its hours', async () => {
    const owner = await account('Owner');
    const body = placeAndTime();
    const created = await request('POST', '/parties', body, owner.token);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      voteLicense: 'LOCATION_TIME', ...venue, radiusMeters: 200, voteStartsAt: body.voteStartsAt, voteEndsAt: body.voteEndsAt,
    });
  });

  it('refuses a place-and-time party without its hours, or with hours reversed or already over', async () => {
    const owner = await account('Owner');
    const { voteEndsAt } = hours(-1, 2);
    for (const body of [
      placeAndTime({ voteStartsAt: undefined }),
      placeAndTime({ voteEndsAt: undefined }),
      placeAndTime(hours(2, 1)),
      placeAndTime({ voteStartsAt: voteEndsAt, voteEndsAt }),
      placeAndTime(hours(-3, -1)),
    ]) {
      expect((await request('POST', '/parties', body, owner.token)).status).toBe(400);
    }
  });

  it('refuses a place-and-time party without its area, or with a radius outside 50 m to 5 km', async () => {
    const owner = await account('Owner');
    for (const body of [
      placeAndTime({ latitude: undefined }), placeAndTime({ longitude: undefined }), placeAndTime({ radiusMeters: undefined }),
      placeAndTime({ radiusMeters: 49 }), placeAndTime({ radiusMeters: 5001 }), placeAndTime({ radiusMeters: 100.5 }),
    ]) {
      expect((await request('POST', '/parties', body, owner.token)).status).toBe(400);
    }
    for (const radiusMeters of [50, 5000]) {
      expect((await request('POST', '/parties', placeAndTime({ radiusMeters }), owner.token)).status).toBe(201);
    }
  });
});

describe('Voting in a place-and-time party', () => {
  async function venueParty(changes: Record<string, unknown> = {}) {
    const owner = await account('Owner');
    const created = await request('POST', '/parties', placeAndTime(changes), owner.token);
    expect(created.status).toBe(201);
    const suggested = await request('POST', `/parties/${created.body.id}/songs`, { externalId: '3135556' }, owner.token);
    expect(suggested.status).toBe(201);
    return { id: created.body.id as string, entry: suggested.body.id as string };
  }
  const voteAt = (id: string, entry: string, user: Account, position: object) =>
    request('POST', `/parties/${id}/songs/${entry}/vote`, position, user.token);

  it('counts the vote of someone inside the area during the hours', async () => {
    const { id, entry } = await venueParty();
    expect((await voteAt(id, entry, await account('Guest'), near)).status).toBe(201);
  });

  it('refuses a vote without a position, or from outside the area', async () => {
    const { id, entry } = await venueParty();
    const guest = await account('Guest');
    expect((await voteAt(id, entry, guest, {})).status).toBe(400);
    expect((await voteAt(id, entry, guest, far)).status).toBe(403);
  });

  it('refuses a vote before the hours start, and after they end', async () => {
    const guest = await account('Guest');
    const early = await venueParty(hours(1, 2));
    expect((await voteAt(early.id, early.entry, guest, near)).status).toBe(403);
    const late = await venueParty();
    await admin.$executeRawUnsafe(`UPDATE "${schema}"."Party" SET "voteStartsAt" = now() - interval '3 hours', "voteEndsAt" = now() - interval '1 hour' WHERE id = $1`, late.id);
    expect((await voteAt(late.id, late.entry, guest, near)).status).toBe(403);
  });

  it('lets a voter take back their vote from anywhere, at any time: removing needs no position', async () => {
    const { id, entry } = await venueParty();
    const guest = await account('Guest');
    expect((await voteAt(id, entry, guest, near)).status).toBe(201);
    expect((await unvote(id, entry, guest)).status).toBe(200);
  });
});

describe('Searching the room list (GET /parties?q=)', () => {
  const named = (owner: Account, name: string, visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC') =>
    request('POST', '/parties', { name, visibility }, owner.token).then((created) => created.body.id as string);
  const search = async (user: Account, q: string) => {
    const found = await request('GET', `/parties?limit=100&q=${encodeURIComponent(q)}`, undefined, user.token);
    expect(found.status).toBe(200);
    return (found.body as Card[]).map((entry) => entry.id);
  };

  it('finds the rooms whose name contains the search, in any case', async () => {
    const owner = await account('Owner');
    const tag = randomUUID().slice(0, 8);
    const sunset = await named(owner, `Sunset ${tag}`);
    const morning = await named(owner, `Morning ${tag}`);
    expect(await search(owner, `sUnSeT ${tag}`)).toEqual([sunset]);
    expect((await search(owner, tag.toUpperCase())).sort()).toEqual([sunset, morning].sort());
  });

  it('only searches among the rooms the user may see', async () => {
    const owner = await account('Owner');
    const guest = await account('Guest');
    const stranger = await account('Stranger');
    const tag = randomUUID().slice(0, 8);
    const hidden = await named(owner, `Secret ${tag}`, 'PRIVATE');
    expect((await invite(hidden, owner, guest)).status).toBe(201);
    expect(await search(stranger, tag)).toEqual([]);
    expect(await search(guest, tag)).toEqual([hidden]);
    expect(await search(owner, tag)).toEqual([hidden]);
  });

  it('takes %, _ and the backslash as plain characters, not as wildcards', async () => {
    const owner = await account('Owner');
    const tag = randomUUID().slice(0, 8);
    const percent = await named(owner, `100% ${tag}`);
    const underscore = await named(owner, `a_b ${tag}`);
    await named(owner, `1000 ${tag}`);
    await named(owner, `axb ${tag}`);
    expect(await search(owner, `100% ${tag}`)).toEqual([percent]);
    expect(await search(owner, `a_b ${tag}`)).toEqual([underscore]);
    const backslash = await named(owner, `a\\b ${tag}`);
    await named(owner, `ab ${tag}`);
    expect(await search(owner, `a\\b ${tag}`)).toEqual([backslash]);
  });

  it('lists every room for an empty or blank search, and refuses one longer than 100 characters', async () => {
    const owner = await account('Owner');
    const room = await named(owner, `Any ${randomUUID()}`);
    expect(await search(owner, '')).toContain(room);
    expect(await search(owner, '   ')).toContain(room);
    expect((await request('GET', `/parties?q=${'a'.repeat(101)}`, undefined, owner.token)).status).toBe(400);
    expect((await request('GET', '/parties?q=a&q=b', undefined, owner.token)).status).toBe(400);
  });
});

describe('Filtering the room list (GET /parties?visibility=&voteLicense=)', () => {
  const ids = async (user: Account, query: string) => {
    const found = await request('GET', `/parties?limit=100&${query}`, undefined, user.token);
    expect(found.status).toBe(200);
    return (found.body as Card[]).map((entry) => entry.id);
  };
  const created = (owner: Account, body: object) => request('POST', '/parties', body, owner.token).then((answer) => answer.body.id as string);

  it('shows only the public rooms, or only the private rooms the user may see', async () => {
    const owner = await account('Owner');
    const guest = await account('Guest');
    const stranger = await account('Stranger');
    const tag = randomUUID().slice(0, 8);
    const open = await created(owner, { name: `Open ${tag}` });
    const closed = await created(owner, { name: `Closed ${tag}`, visibility: 'PRIVATE' });
    expect((await invite(closed, owner, guest)).status).toBe(201);
    expect(await ids(guest, `visibility=PUBLIC&q=${tag}`)).toEqual([open]);
    expect(await ids(guest, `visibility=PRIVATE&q=${tag}`)).toEqual([closed]);
    expect(await ids(stranger, `visibility=PRIVATE&q=${tag}`)).toEqual([]);
  });

  it('shows the location & time rooms, a public one also among the public rooms', async () => {
    const owner = await account('Owner');
    const tag = randomUUID().slice(0, 8);
    const atVenue = await created(owner, placeAndTime({ name: `Venue ${tag}` }));
    const plain = await created(owner, { name: `Plain ${tag}` });
    expect(await ids(owner, `voteLicense=LOCATION_TIME&q=${tag}`)).toEqual([atVenue]);
    expect((await ids(owner, `visibility=PUBLIC&q=${tag}`)).sort()).toEqual([atVenue, plain].sort());
  });

  it('refuses a filter value that does not exist', async () => {
    const owner = await account('Owner');
    for (const query of ['visibility=SECRET', 'voteLicense=NEARBY']) {
      expect((await request('GET', `/parties?${query}`, undefined, owner.token)).status).toBe(400);
    }
  });
});

describe('How long the current song has been playing, in the room list', () => {
  it('is null when nothing plays, and measured by the server once a song plays', async () => {
    const owner = await account('Owner');
    const room = await party(owner, { songs: ['3135556'] });
    const listed = async () => (await request('GET', `/parties?limit=100&q=${encodeURIComponent(room.name)}`, undefined, owner.token)).body[0];
    expect((await listed()).playingForMs).toBeNull();
    expect((await request('POST', `/parties/${room.id}/next`, { expectedPlaybackVersion: 0 }, owner.token)).status).toBe(201);
    await admin.$executeRawUnsafe(`UPDATE "${schema}"."Party" SET "nowPlayingStartedAt" = now() - interval '5 minutes' WHERE id = $1`, room.id);
    const playingFor = (await listed()).playingForMs;
    expect(playingFor).toBeGreaterThanOrEqual(300_000);
    expect(playingFor).toBeLessThan(310_000);
  });
});
