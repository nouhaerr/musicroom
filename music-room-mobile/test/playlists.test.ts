import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, type TokenStorage } from '../src/api/client.ts';
import { droppedPosition, playlistsApi, type PlaylistEntry } from '../src/api/playlists.ts';

const user = { id: 'alice', email: 'alice@example.test', name: 'Alice', musicPreferences: [] };
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
    if (url.pathname === '/auth/login') return json({ user, accessToken: 'access', refreshToken: 'refresh' });
    return handle(url, init);
  });
  return { client, calls };
}

test('the playlist list asks for one page of one chip, and sends the search only when there is one', async () => {
  const f = fixture(() => json([]));
  await f.client.login(user.email, 'password');
  const api = playlistsApi(f.client);
  await api.list(2, '', 'PUBLIC');
  await api.list(1, 'rüfüs & co/2?', 'PRIVATE');
  assert.deepEqual(f.calls.slice(1).map(c => [c.url.pathname, Object.fromEntries(c.url.searchParams)]), [
    ['/playlists', { page: '2', limit: '20', visibility: 'PUBLIC' }],
    ['/playlists', { page: '1', limit: '20', visibility: 'PRIVATE', q: 'rüfüs & co/2?' }],
  ]);
});

test('a playlist list answer that is not a list is refused instead of being shown', async () => {
  const f = fixture(() => json({ playlists: [] }));
  await f.client.login(user.email, 'password');
  await assert.rejects(playlistsApi(f.client).list(1, '', 'PUBLIC'), /Invalid playlists response/);
});

test('the playlist page, a removal and an answer name the playlist, the song and the invitation in the URL', async () => {
  const page = { id: 'playlist 1', ownerId: 'bob', name: 'Night Drive', visibility: 'PUBLIC', editLicense: 'EVERYONE', owner: { id: 'bob', name: 'Bob' }, canEdit: true, invitation: null };
  const f = fixture(url => json(url.pathname.startsWith('/playlists/playlist%201') && !url.pathname.includes('/songs/') ? page : {}));
  await f.client.login(user.email, 'password');
  const api = playlistsApi(f.client);
  assert.deepEqual(await api.page('playlist 1'), page);
  await api.remove('playlist 1', 'entry/2');
  await api.answer('invitation/3', true);
  await api.answer('invitation/3', false);
  assert.deepEqual(f.calls.slice(1).map(c => [c.url.pathname, c.init.method ?? 'GET', c.init.body === undefined ? null : JSON.parse(String(c.init.body))]), [
    ['/playlists/playlist%201', 'GET', null],
    ['/playlists/playlist%201/songs/entry%2F2', 'DELETE', null],
    ['/invitations/invitation%2F3/accept', 'POST', {}],
    ['/invitations/invitation%2F3/decline', 'POST', {}],
  ]);
});

test('a playlist page answer without its owner or canEdit is refused instead of being shown', async () => {
  for (const answer of [{}, { owner: { id: 'bob', name: 'Bob' } }, { canEdit: true }, { canEdit: 'yes', owner: { id: 'bob', name: 'Bob' } }]) {
    const f = fixture(() => json(answer));
    await f.client.login(user.email, 'password');
    await assert.rejects(playlistsApi(f.client).page('p'), /Invalid playlist response/);
  }
});

// A song of a playlist with only what the drag maths reads
const at = (id: string, position: number) => ({ id, position }) as PlaylistEntry;

test('a dropped song goes halfway between its new neighbours, or one step past the end it reached', () => {
  const [a, b, c, d] = [at('a', 1), at('b', 2), at('c', 3), at('d', 4)];
  assert.equal(droppedPosition([a, d, b, c], 1), 1.5); // between a and b
  assert.equal(droppedPosition([d, a, b, c], 0), 0); // first: one step before a
  assert.equal(droppedPosition([b, c, d, a], 3), 5); // last: one step after d
  assert.equal(droppedPosition([a], 0), 1); // alone: its own place
});

test('a move names the playlist and the song, and sends the place the song had when it was seen', async () => {
  const f = fixture(() => json({}));
  await f.client.login(user.email, 'password');
  await playlistsApi(f.client).move('playlist 1', 'entry/2', 1.5, 4);
  assert.deepEqual([f.calls[1].url.pathname, f.calls[1].init.method, JSON.parse(String(f.calls[1].init.body))],
    ['/playlists/playlist%201/songs/entry%2F2', 'PATCH', { position: 1.5, expectedPosition: 4 }]);
});

test('adding a song names the playlist and sends the catalog id', async () => {
  const f = fixture(() => json({}));
  await f.client.login(user.email, 'password');
  await playlistsApi(f.client).add('playlist 1', '3135556');
  assert.deepEqual([f.calls[1].url.pathname, f.calls[1].init.method, JSON.parse(String(f.calls[1].init.body))],
    ['/playlists/playlist%201/songs', 'POST', { externalId: '3135556' }]);
});

test('creating a playlist sends its name and rules, and inviting names the playlist and the friend', async () => {
  const f = fixture(() => json({ id: 'playlist 1' }));
  await f.client.login(user.email, 'password');
  const api = playlistsApi(f.client);
  await api.create({ name: 'Night Drive', visibility: 'PRIVATE', editLicense: 'INVITED_ONLY' });
  await api.invite('playlist 1', 'user/2');
  assert.deepEqual(f.calls.slice(1).map(c => [c.url.pathname, c.init.method, JSON.parse(String(c.init.body))]), [
    ['/playlists', 'POST', { name: 'Night Drive', visibility: 'PRIVATE', editLicense: 'INVITED_ONLY' }],
    ['/playlists/playlist%201/invite', 'POST', { userId: 'user/2' }],
  ]);
});
