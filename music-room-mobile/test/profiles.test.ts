import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, type TokenStorage } from '../src/api/client.ts';
import { profileChanges, profileDraft, visibleProfileSections, usersQuery, type OwnProfile } from '../src/api/profiles.ts';
import { socialApi } from '../src/api/social.ts';

const me: OwnProfile = {
  id: 'alice', email: 'alice@example.test', name: 'Alice', musicPreferences: ['jazz'],
  publicInfo: { bio: 'Bonjour', city: 'Paris' },
  friendsOnlyInfo: { bio: 'Pour mes amis', concerts: ['Jazz festival'] },
  privateInfo: { bio: 'Pour moi', reminder: { day: 'Sunday' } },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fixture(handle: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const values = new Map<string, string>();
  const storage: TokenStorage = {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    deleteItem: async key => { values.delete(key); },
  };
  const calls: { url: URL; init: RequestInit }[] = [];
  const client = new ApiClient('https://api.example.test', storage, async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === '/auth/login') return json({ user: me, accessToken: 'access', refreshToken: 'refresh' });
    if (url.pathname === '/devices') return json({ id: 'device-alice' });
    return handle(url, init);
  });
  return { client, calls, values };
}

test('profile editing keeps unrelated JSON fields in their original visibility tier', () => {
  const changes = profileChanges(me, { ...profileDraft(me), name: ' Alice B ', publicBio: ' Nouveau ', genres: ' Jazz, ROCK, jazz, , soul ' });
  assert.equal(changes.name, 'Alice B');
  assert.deepEqual(changes.musicPreferences, ['jazz', 'rock', 'soul']);
  assert.deepEqual(changes.publicInfo, { bio: 'Nouveau', city: 'Paris' });
  assert.deepEqual(changes.friendsOnlyInfo, me.friendsOnlyInfo);
  assert.deepEqual(changes.privateInfo, me.privateInfo);
  assert.equal(me.publicInfo?.bio, 'Bonjour');
  assert.equal(Object.hasOwn(changes, 'email'), false);
});

test('empty sections and genres can be cleared without moving private values into public data', () => {
  const empty = { ...me, publicInfo: null, friendsOnlyInfo: null, privateInfo: null };
  const draft = profileDraft(empty);
  assert.equal(draft.privateBio, '');
  const patch = profileChanges(empty, { ...draft, genres: '', privateBio: 'secret' });
  assert.deepEqual(patch.musicPreferences, []);
  assert.deepEqual(patch.publicInfo, { bio: '' });
  assert.deepEqual(patch.friendsOnlyInfo, { bio: '' });
  assert.deepEqual(patch.privateInfo, { bio: 'secret' });
});

test('invalid profile edits are rejected before any request is sent', async () => {
  const f = fixture(() => json(me));
  await f.client.login(me.email, 'password');
  for (const patch of [
    { name: ' ' }, { genres: 'g'.repeat(51) },
    { genres: Array.from({ length: 51 }, (_, i) => `genre${i}`).join(',') },
  ]) await assert.rejects(f.client.updateMyProfile(me, { ...profileDraft(me), ...patch }));
  assert.equal(f.calls.length, 1);
});

test('saving a profile uses the authenticated device, updates session display and never persists profile data', async () => {
  const f = fixture((_url, init) => json({ ...me, ...JSON.parse(String(init.body)) }));
  await f.client.login(me.email, 'password');
  await f.client.registerDevice('IOS', 'Simulator');
  let notified = '';
  f.client.subscribe(user => { notified = user?.name ?? ''; });
  const saved = await f.client.updateMyProfile(me, { ...profileDraft(me), name: 'Alice Updated' });
  const call = f.calls.at(-1)!;
  assert.equal(call.url.pathname, '/users/me');
  assert.equal(call.init.method, 'PATCH');
  assert.equal((call.init.headers as Record<string, string>)['X-Device-Id'], 'device-alice');
  assert.equal(saved.name, 'Alice Updated');
  assert.equal(f.client.user?.name, 'Alice Updated');
  assert.equal(notified, 'Alice Updated');
  assert.deepEqual(JSON.parse(f.values.get('sonora.session.v1')!), { baseUrl: 'https://api.example.test', refreshToken: 'refresh' });
});

test('another user returned as my profile cannot replace the current session identity', async () => {
  const f = fixture(() => json({ ...me, id: 'bob' }));
  await f.client.login(me.email, 'password');
  await assert.rejects(f.client.getMyProfile(), /Réponse de profil invalide/);
  assert.equal(f.client.user?.id, 'alice');
});

test('a profile response arriving after logout cannot restore personal data to the session', async () => {
  let respond!: (value: Response) => void;
  let entered!: () => void;
  const response = new Promise<Response>(resolve => { respond = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const f = fixture(url => {
    if (url.pathname === '/users/me') { entered(); return response; }
    return json({});
  });
  await f.client.login(me.email, 'password');
  const pending = assert.rejects(f.client.getMyProfile(), /Session fermée/);
  await started;
  await f.client.logout();
  respond(json(me));
  await pending;
  assert.equal(f.client.user, null);
});

test('other-profile sections never render private fields, email or social identifiers', () => {
  const received = { ...me, googleId: 'not-for-display' };
  const sections = visibleProfileSections(received);
  assert.deepEqual(sections.map(s => s.title), ['Informations publiques', 'Informations partagées avec les amis']);
  const rendered = JSON.stringify(sections);
  assert.equal(rendered.includes(me.email), false);
  assert.equal(rendered.includes('Pour moi'), false);
  assert.equal(rendered.includes('not-for-display'), false);
  assert.equal(visibleProfileSections({ id: 'bob', name: 'Bob', publicInfo: {}, musicPreferences: [] }).length, 1);
});

test('search encodes filters separately and paginates names containing URL punctuation', () => {
  const url = new URL(usersQuery(' A&B?limit=100 ', ' R&B ', 3), 'https://api.example.test');
  assert.equal(url.searchParams.get('q'), 'A&B?limit=100');
  assert.equal(url.searchParams.get('genre'), 'r&b');
  assert.equal(url.searchParams.get('limit'), '20');
  assert.equal(url.searchParams.get('page'), '3');
});

test('friendship actions target request IDs for responses and user IDs for removing friends', async () => {
  const f = fixture(() => json({ status: 'ACCEPTED' }));
  await f.client.login(me.email, 'password');
  await f.client.registerDevice('IOS', 'Simulator');
  const api = socialApi(f.client);
  assert.equal((await api.send('bob')).status, 'ACCEPTED');
  assert.deepEqual(JSON.parse(String(f.calls.at(-1)!.init.body)), { userId: 'bob' });
  await api.accept('request-1'); await api.reject('request-2'); await api.cancel('request-3'); await api.remove('bob');
  assert.deepEqual(f.calls.slice(-4).map(c => [c.url.pathname, c.init.method]), [
    ['/friends/requests/request-1/accept', 'POST'], ['/friends/requests/request-2/reject', 'POST'],
    ['/friends/requests/request-3', 'DELETE'], ['/friends/bob', 'DELETE'],
  ]);
  for (const c of f.calls.slice(2)) {
    assert.equal((c.init.headers as Record<string, string>)['X-Device-Id'], 'device-alice');
  }
});

test('a conflict from a duplicate friend request stays visible without retrying the mutation', async () => {
  const f = fixture(() => json({ message: 'Demande déjà envoyée' }, 409));
  await f.client.login(me.email, 'password');
  await assert.rejects(socialApi(f.client).send('bob'), /Demande déjà envoyée/);
  assert.equal(f.calls.length, 2);
});
