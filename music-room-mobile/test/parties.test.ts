import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, type TokenStorage } from '../src/api/client.ts';
import { clock, partiesApi, progress, type Song } from '../src/api/parties.ts';

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
const ids = (from: number, count: number) => Array.from({ length: count }, (_, index) => `entry-${from + index}`);
const song: Song = { id: 'song-1', externalId: '3135556', title: 'Midnight City', artist: 'M83', durationSec: 243, sourceUri: 'https://example.test/track', thumbnailUrl: null };
const received = Date.parse('2026-10-13T20:00:00.000Z'); // when the phone got the snapshot, on its own clock

test('party actions name the party and the queue entry in the URL, with the method each route expects', async () => {
  const f = fixture(() => json({}));
  await f.client.login(user.email, 'password');
  const api = partiesApi(f.client);
  await api.suggest('party 1', '3135556');
  await api.vote('party 1', 'entry/2');
  await api.vote('party 1', 'entry/2', { latitude: 33.5731, longitude: -7.5898 });
  await api.unvote('party 1', 'entry/2');
  await api.next('party 1', 7);
  assert.deepEqual(f.calls.slice(1).map(c => [c.url.pathname, c.init.method, c.init.body === undefined ? null : JSON.parse(String(c.init.body))]), [
    ['/parties/party%201/songs', 'POST', { externalId: '3135556' }],
    ['/parties/party%201/songs/entry%2F2/vote', 'POST', {}],
    ['/parties/party%201/songs/entry%2F2/vote', 'POST', { latitude: 33.5731, longitude: -7.5898 }],
    ['/parties/party%201/songs/entry%2F2/vote', 'DELETE', null],
    ['/parties/party%201/next', 'POST', { expectedPlaybackVersion: 7 }],
  ]);
});

test('a refusal of the server keeps its status and its message', async () => {
  const f = fixture(() => json({ message: 'You have already voted for this track' }, 409));
  await f.client.login(user.email, 'password');
  await assert.rejects(partiesApi(f.client).vote('party-1', 'entry-1'),
    (error: unknown) => error instanceof Error && 'status' in error && error.status === 409 && error.message === 'You have already voted for this track');
  assert.equal(f.calls.length, 2); // the vote is not sent a second time
});

test('my votes are read page after page until a page is not full', async () => {
  const pages = [ids(0, 100), ids(100, 100), ids(200, 3)];
  const f = fixture(url => json(pages[Number(url.searchParams.get('page')) - 1]));
  await f.client.login(user.email, 'password');
  const voted = await partiesApi(f.client).myVotes('party 1');
  assert.equal(voted.size, 203);
  assert.ok(voted.has('entry-0') && voted.has('entry-150') && voted.has('entry-202'));
  assert.deepEqual(f.calls.slice(1).map(c => c.url.pathname + c.url.search), [
    '/parties/party%201/votes/mine?page=1&limit=100',
    '/parties/party%201/votes/mine?page=2&limit=100',
    '/parties/party%201/votes/mine?page=3&limit=100',
  ]);
});

test('no vote, or fewer than a page, is one request', async () => {
  for (const page of [[], ids(0, 99)]) {
    const f = fixture(() => json(page));
    await f.client.login(user.email, 'password');
    assert.equal((await partiesApi(f.client).myVotes('party-1')).size, page.length);
    assert.equal(f.calls.length, 2);
  }
});

test('an answer that is not a list of ids is refused instead of being shown', async () => {
  for (const body of [null, {}, 'entry-1', [1, 2], ['entry-1', null], [{ partySongId: 'entry-1' }]]) {
    const f = fixture(() => json(body));
    await f.client.login(user.email, 'password');
    await assert.rejects(partiesApi(f.client).myVotes('party-1'), /Invalid votes response/);
  }
});

test('progress is what the server measured plus the time since the phone received it', () => {
  delete process.env.EXPO_PUBLIC_SONG_SECONDS;
  const snapshot = { party: { nowPlaying: song }, playingForMs: 12_000 };
  assert.deepEqual(progress(snapshot, received, received), { elapsedSec: 12, durationSec: 243 });
  assert.deepEqual(progress(snapshot, received, received + 3_900), { elapsedSec: 15, durationSec: 243 });
  assert.deepEqual(progress(snapshot, received, received + 9_000_000), { elapsedSec: 243, durationSec: 243 }); // over: the bar stays full
  assert.deepEqual(progress(snapshot, received, received - 800), { elapsedSec: 11, durationSec: 243 }); // "now" is refreshed once a second and may lag
  assert.deepEqual(progress({ ...snapshot, playingForMs: 0 }, received, received - 800), { elapsedSec: 0, durationSec: 243 });
});

test('progress never depends on what time the phone thinks it is', () => {
  delete process.env.EXPO_PUBLIC_SONG_SECONDS;
  const snapshot = { party: { nowPlaying: song }, playingForMs: 12_000 };
  // The same 5 seconds after reception, on a phone whose clock is right, 38 minutes late, or a year ahead
  for (const clock of [Date.parse('2026-10-13T04:38:26Z'), Date.parse('2026-10-13T04:00:18Z'), Date.parse('2027-10-13T04:38:26Z')]) {
    assert.deepEqual(progress(snapshot, clock, clock + 5_000), { elapsedSec: 17, durationSec: 243 });
  }
});

test('the song length setting caps every song, and anything that is not a positive number is ignored', () => {
  const snapshot = { party: { nowPlaying: song }, playingForMs: 0 };
  try {
    process.env.EXPO_PUBLIC_SONG_SECONDS = '30';
    assert.deepEqual(progress(snapshot, received, received + 12_000), { elapsedSec: 12, durationSec: 30 });
    assert.deepEqual(progress(snapshot, received, received + 100_000), { elapsedSec: 30, durationSec: 30 });
    // A song shorter than the setting keeps its own length
    assert.deepEqual(progress({ ...snapshot, party: { nowPlaying: { ...song, durationSec: 20 } } }, received, received + 25_000), { elapsedSec: 20, durationSec: 20 });
    for (const value of ['', '0', '-5', 'thirty', ' ']) {
      process.env.EXPO_PUBLIC_SONG_SECONDS = value;
      assert.deepEqual(progress(snapshot, received, received + 100_000), { elapsedSec: 100, durationSec: 243 });
    }
  } finally {
    delete process.env.EXPO_PUBLIC_SONG_SECONDS;
  }
});

test('there is no progress without a song, or without the server\'s measure', () => {
  assert.equal(progress({ party: { nowPlaying: null }, playingForMs: null }, received, received), null);
  assert.equal(progress({ party: { nowPlaying: null }, playingForMs: 5_000 }, received, received), null);
  assert.equal(progress({ party: { nowPlaying: song }, playingForMs: null }, received, received), null);
  // A server that does not send the measure yet
  assert.equal(progress({ party: { nowPlaying: song } } as Parameters<typeof progress>[0], received, received), null);
});

test('durations are shown as minutes and two-digit seconds', () => {
  assert.deepEqual([0, 5, 59, 60, 245, 600, 3725].map(clock), ['0:00', '0:05', '0:59', '1:00', '4:05', '10:00', '62:05']);
});
