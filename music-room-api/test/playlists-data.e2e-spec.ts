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

type Account = { id: string; name: string; token: string };
type Card = { id: string; owner: unknown; songsCount: number; cover: string | null };

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
const NO_PICTURE = '7999'; // the fake Deezer gives this track no album picture
const cover = (externalId: string) => `https://cdn.example/${externalId}.jpg`;

const created = (owner: Account, body: object) =>
  request('POST', '/playlists', body, owner.token).then((answer) => answer.body.id as string);
const add = (id: string, user: Account, externalId = track()) =>
  request('POST', `/playlists/${id}/songs`, { externalId }, user.token);
const invite = (id: string, owner: Account, guest: Account) =>
  request('POST', `/playlists/${id}/invite`, { userId: guest.id }, owner.token);
const answer = (invitationId: string, guest: Account, reply: 'accept' | 'decline') =>
  request('POST', `/invitations/${invitationId}/${reply}`, {}, guest.token);
const removeGuest = (id: string, owner: Account, guest: Account) =>
  request('DELETE', `/playlists/${id}/invitations/${guest.id}`, undefined, owner.token);
const detail = (id: string, user: Account) => request('GET', `/playlists/${id}`, undefined, user.token);

// The playlists one list request shows to this user
async function list(user: Account, query: string): Promise<Card[]> {
  const found = await request('GET', `/playlists?limit=100&${query}`, undefined, user.token);
  expect(found.status).toBe(200);
  return found.body;
}
const ids = async (user: Account, query: string) => (await list(user, query)).map((card) => card.id);
const cardOf = async (user: Account, id: string, tag: string) => (await list(user, `q=${tag}`)).find((card) => card.id === id)!;

// One user of each kind around a playlist: its owner, guests whose invitation is pending, accepted,
// declined or removed, and a stranger
async function people(id: string, owner: Account) {
  const pending = await account('Pending');
  const accepted = await account('Accepted');
  const declined = await account('Declined');
  const removed = await account('Removed');
  const stranger = await account('Stranger');
  expect((await invite(id, owner, pending)).status).toBe(201);
  expect((await answer((await invite(id, owner, accepted)).body.id, accepted, 'accept')).status).toBe(201);
  expect((await answer((await invite(id, owner, declined)).body.id, declined, 'decline')).status).toBe(201);
  expect((await answer((await invite(id, owner, removed)).body.id, removed, 'accept')).status).toBe(201);
  expect((await removeGuest(id, owner, removed)).status).toBe(200);
  return { pending, accepted, declined, removed, stranger };
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

  // Fake Deezer: answers /track/:id with a track of that id and its own picture; any other request goes through
  deezer = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const match = target.match(/^https:\/\/api\.deezer\.com\/track\/(\d+)$/);
    if (!match) return realFetch(input, init);
    return new Response(JSON.stringify({
      id: Number(match[1]), title: `Track ${match[1]}`, duration: 200, link: `https://www.deezer.com/track/${match[1]}`,
      preview: '', artist: { name: 'Test Artist' }, album: match[1] === NO_PICTURE ? {} : { cover_medium: cover(match[1]) },
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

describe('The playlist list (GET /playlists)', () => {
  it('shows the public playlists, your own, and the private ones you are invited to', async () => {
    const owner = await account('Owner');
    const tag = randomUUID().slice(0, 8);
    const open = await created(owner, { name: `Open ${tag}` });
    const closed = await created(owner, { name: `Closed ${tag}`, visibility: 'PRIVATE' });
    const { pending, accepted, declined, removed, stranger } = await people(closed, owner);

    for (const user of [owner, pending, accepted]) expect((await ids(user, `q=${tag}`)).sort()).toEqual([open, closed].sort());
    for (const user of [declined, removed, stranger]) expect(await ids(user, `q=${tag}`)).toEqual([open]);
  });

  it('finds the playlists whose name contains the search, in any case', async () => {
    const owner = await account('Owner');
    const tag = randomUUID().slice(0, 8);
    const night = await created(owner, { name: `Night Drive ${tag}` });
    const morning = await created(owner, { name: `Morning ${tag}` });

    expect(await ids(owner, `q=${encodeURIComponent(`nIgHt dRiVe ${tag}`)}`)).toEqual([night]);
    expect((await ids(owner, `q=${tag.toUpperCase()}`)).sort()).toEqual([night, morning].sort());
  });

  it('takes %, _ and the backslash as plain characters, not as wildcards', async () => {
    const owner = await account('Owner');
    const tag = randomUUID().slice(0, 8);
    const percent = await created(owner, { name: `100% ${tag}` });
    const underscore = await created(owner, { name: `a_b ${tag}` });
    const backslash = await created(owner, { name: `a\\b ${tag}` });
    for (const name of ['1000', 'axb', 'ab']) await created(owner, { name: `${name} ${tag}` });

    expect(await ids(owner, `q=${encodeURIComponent(`100% ${tag}`)}`)).toEqual([percent]);
    expect(await ids(owner, `q=${encodeURIComponent(`a_b ${tag}`)}`)).toEqual([underscore]);
    expect(await ids(owner, `q=${encodeURIComponent(`a\\b ${tag}`)}`)).toEqual([backslash]);
  });

  it('lists everything for an empty or blank search, and refuses a search too long or sent twice', async () => {
    const owner = await account('Owner');
    await created(owner, { name: 'Anything' });

    const all = await ids(owner, '');
    expect(all.length).toBeGreaterThan(0);
    expect(await ids(owner, 'q=')).toEqual(all);
    expect(await ids(owner, 'q=%20%20%20')).toEqual(all);
    expect((await request('GET', `/playlists?q=${'x'.repeat(101)}`, undefined, owner.token)).status).toBe(400);
    expect((await request('GET', '/playlists?q=a&q=b', undefined, owner.token)).status).toBe(400);
  });

  it('shows only the public playlists, or only the private ones the user may see', async () => {
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
    for (const value of ['SECRET', 'public']) {
      expect((await request('GET', `/playlists?visibility=${value}`, undefined, owner.token)).status).toBe(400);
    }
  });

  it('counts the songs of each playlist', async () => {
    const owner = await account('Owner');
    const tag = randomUUID().slice(0, 8);
    const id = await created(owner, { name: `Counted ${tag}` });
    const other = await created(owner, { name: `Other ${tag}` });
    expect((await add(other, owner)).status).toBe(201);
    expect((await cardOf(owner, id, tag)).songsCount).toBe(0);

    const first = await add(id, owner);
    expect((await add(id, owner)).status).toBe(201);
    expect((await cardOf(owner, id, tag)).songsCount).toBe(2);

    expect((await request('DELETE', `/playlists/${id}/songs/${first.body.id}`, undefined, owner.token)).status).toBe(200);
    expect((await cardOf(owner, id, tag)).songsCount).toBe(1);
    expect((await cardOf(owner, other, tag)).songsCount).toBe(1);
  });

  it("shows the owner's id and name, nothing else", async () => {
    const owner = await account('Alex Morgan');
    const tag = randomUUID().slice(0, 8);
    const id = await created(owner, { name: `Owned ${tag}` });

    expect((await cardOf(owner, id, tag)).owner).toEqual({ id: owner.id, name: 'Alex Morgan' });
  });

  it('shows the picture of the first song, in the playlist order', async () => {
    const owner = await account('Owner');
    const tag = randomUUID().slice(0, 8);
    const id = await created(owner, { name: `Covered ${tag}` });
    expect((await cardOf(owner, id, tag)).cover).toBeNull();

    const [a, b] = [track(), track()];
    const first = await add(id, owner, a);
    const second = await add(id, owner, b);
    expect((await cardOf(owner, id, tag)).cover).toBe(cover(a));

    // The second song moved before the first one becomes the cover, and the first one again once it is removed
    const moved = await request('PATCH', `/playlists/${id}/songs/${second.body.id}`, { position: first.body.position - 1, expectedPosition: second.body.position }, owner.token);
    expect(moved.status).toBe(200);
    expect((await cardOf(owner, id, tag)).cover).toBe(cover(b));
    expect((await request('DELETE', `/playlists/${id}/songs/${second.body.id}`, undefined, owner.token)).status).toBe(200);
    expect((await cardOf(owner, id, tag)).cover).toBe(cover(a));

    // A first song without a picture gives no cover
    const bare = await created(owner, { name: `Bare ${tag}` });
    expect((await add(bare, owner, NO_PICTURE)).status).toBe(201);
    expect((await add(bare, owner)).status).toBe(201);
    expect((await cardOf(owner, bare, tag)).cover).toBeNull();
  });

  it('keeps the newest playlists first, page after page', async () => {
    const owner = await account('Owner');
    const tag = randomUUID().slice(0, 8);
    const first = await created(owner, { name: `Paged ${tag}` });
    const second = await created(owner, { name: `Paged ${tag}` });
    const third = await created(owner, { name: `Paged ${tag}` });

    const page = async (n: number) =>
      ((await request('GET', `/playlists?limit=2&page=${n}&q=${tag}`, undefined, owner.token)).body as Card[]).map((card) => card.id);
    expect([...(await page(1)), ...(await page(2))]).toEqual([third, second, first]);
  });
});

describe('One playlist (GET /playlists/:id)', () => {
  it("shows the owner's id and name", async () => {
    const owner = await account('Alex Morgan');
    const id = await created(owner, { name: 'Night Drive' });

    expect((await detail(id, owner)).body.owner).toEqual({ id: owner.id, name: 'Alex Morgan' });
  });

  it('tells whether this user may edit, exactly as the server decides when they try', async () => {
    // canEdit, then whether adding a song really works: the two must always agree
    const check = async (id: string, user: Account, expected: boolean) => {
      expect((await detail(id, user)).body.canEdit).toBe(expected);
      expect((await add(id, user)).status).toBe(expected ? 201 : 403);
    };
    const owner = await account('Owner');

    const open = await created(owner, { name: 'Public, everyone edits' });
    const openGuests = await people(open, owner);
    for (const user of [owner, ...Object.values(openGuests)]) await check(open, user, true);

    const curated = await created(owner, { name: 'Public, invited only', editLicense: 'INVITED_ONLY' });
    const curatedGuests = await people(curated, owner);
    await check(curated, owner, true);
    await check(curated, curatedGuests.accepted, true);
    for (const user of [curatedGuests.pending, curatedGuests.declined, curatedGuests.removed, curatedGuests.stranger]) await check(curated, user, false);

    const closed = await created(owner, { name: 'Private, everyone edits', visibility: 'PRIVATE' });
    const closedGuests = await people(closed, owner);
    for (const user of [owner, closedGuests.pending, closedGuests.accepted]) await check(closed, user, true);
    // Who may not see a private playlist gets no page at all, and may not edit it either
    for (const user of [closedGuests.declined, closedGuests.removed, closedGuests.stranger]) {
      expect((await detail(closed, user)).status).toBe(403);
      expect((await add(closed, user)).status).toBe(403);
    }

    const locked = await created(owner, { name: 'Private, invited only', visibility: 'PRIVATE', editLicense: 'INVITED_ONLY' });
    const lockedGuests = await people(locked, owner);
    for (const user of [owner, lockedGuests.accepted]) await check(locked, user, true);
    await check(locked, lockedGuests.pending, false);
  });

  it("gives this user's own invitation, and null without one", async () => {
    const owner = await account('Owner');
    const id = await created(owner, { name: 'Invitations', editLicense: 'INVITED_ONLY' });
    const { pending, accepted, declined, removed, stranger } = await people(id, owner);

    expect((await detail(id, owner)).body.invitation).toBeNull();
    expect((await detail(id, stranger)).body.invitation).toBeNull();
    const own = (await detail(id, pending)).body.invitation;
    expect(own).toEqual({ id: expect.any(String), status: 'PENDING' });
    expect((await detail(id, accepted)).body.invitation).toEqual({ id: expect.any(String), status: 'ACCEPTED' });
    expect((await detail(id, declined)).body.invitation).toEqual({ id: expect.any(String), status: 'DECLINED' });
    expect((await detail(id, removed)).body.invitation).toEqual({ id: expect.any(String), status: 'REVOKED' });

    // The id is the one the page uses to answer: accepting it lets this user edit
    expect((await answer(own.id, pending, 'accept')).status).toBe(201);
    expect((await detail(id, pending)).body).toMatchObject({ canEdit: true, invitation: { id: own.id, status: 'ACCEPTED' } });
  });

  it('still refuses an unknown playlist, and a private one of someone else', async () => {
    const owner = await account('Owner');
    const stranger = await account('Stranger');
    const closed = await created(owner, { name: 'Closed', visibility: 'PRIVATE' });

    expect((await detail(randomUUID(), owner)).status).toBe(404);
    expect((await detail(closed, stranger)).status).toBe(403);
  });
});
