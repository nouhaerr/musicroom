import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, type TokenStorage } from '../src/api/client.ts';
import { songsApi } from '../src/api/songs.ts';

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
const track = { externalId: '3135556', title: 'Harder, Better, Faster, Stronger', artist: 'Daft Punk', coverUrl: null };

test('the search sends the text as it was typed, and gives back the songs found', async () => {
  const f = fixture(() => json({ total: 1, items: [track] }));
  await f.client.login(user.email, 'password');
  assert.deepEqual(await songsApi(f.client).search('rüfüs & co/2?'), [track]);
  const [call] = f.calls.slice(1);
  assert.equal(call.url.pathname, '/songs/search');
  assert.equal(call.url.searchParams.get('q'), 'rüfüs & co/2?');
  assert.deepEqual([...call.url.searchParams.keys()], ['q']);
});

test('an answer without a list of songs is refused instead of being shown', async () => {
  for (const answer of [{ total: 0 }, { items: 'none' }, null]) {
    const f = fixture(() => json(answer));
    await f.client.login(user.email, 'password');
    await assert.rejects(songsApi(f.client).search('daft punk'), /Invalid search response/);
  }
});

test('a refusal of the server keeps its message', async () => {
  const f = fixture(() => json({ message: 'Music catalog unavailable' }, 502));
  await f.client.login(user.email, 'password');
  await assert.rejects(songsApi(f.client).search('daft punk'), (error: unknown) => error instanceof Error && error.message === 'Music catalog unavailable');
});
