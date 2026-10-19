import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, type TokenStorage } from '../src/api/client.ts';
import { playlistsApi } from '../src/api/playlists.ts';

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
