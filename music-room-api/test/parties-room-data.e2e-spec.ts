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
    expect(found).toEqual({ ...detail, owner: { id: owner.id, name: 'Owner' } });
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
