import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, type TokenStorage } from '../src/api/client.ts';

const origin = 'https://api.example.test';
const user = { id: 'user-a', name: 'Alice', email: 'alice@example.test', musicPreferences: [] };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
function fixture(handle: (path: string) => Response | Promise<Response>) {
  const values = new Map<string, string>();
  const storage: TokenStorage = {
    getItem: async k => values.get(k) ?? null,
    setItem: async (k, v) => { values.set(k, v); },
    deleteItem: async k => { values.delete(k); },
  };
  const calls: { path: string; device?: string }[] = [];
  const client = new ApiClient(origin, storage, async (url, init = {}) => {
    const path = String(url).slice(origin.length);
    calls.push({ path, device: (init.headers as Record<string, string>)['X-Device-Id'] });
    if (path === '/auth/login') return json({ user, accessToken: 'access', refreshToken: 'refresh' });
    if (path === '/auth/logout') return json({});
    return handle(path);
  }, { platform: 'IOS', model: 'iPhone', appVersion: '0.1.0' });
  return { client, values, calls };
}
function cache(values: Map<string, string>, id = 'saved-device') {
  values.set('sonora.device.v1', JSON.stringify({ baseUrl: origin, userId: user.id, id }));
}

test('concurrent first requests wait for one device registration and all include its ID', async () => {
  const started = deferred(), release = deferred();
  const f = fixture(async path => {
    if (path === '/devices') { started.resolve(); await release.promise; return json({ id: 'new-device' }); }
    return json(user);
  });
  await f.client.login(user.email, 'password');
  const profile = f.client.getMyProfile();
  const friends = f.client.request('/friends');
  await started.promise;
  assert.deepEqual(f.calls.map(c => c.path), ['/auth/login', '/devices']);
  release.resolve(); await Promise.all([profile, friends]);
  assert.equal(f.calls.filter(c => c.path === '/devices').length, 1);
  assert.ok(f.calls.filter(c => ['/users/me', '/friends'].includes(c.path)).every(c => c.device === 'new-device'));
});

test('saved device is checked across pages before reuse and no duplicate is created', async () => {
  const f = fixture(path => {
    if (path === '/devices?page=1&limit=100') return json(Array.from({ length: 100 }, (_, i) => ({ id: `other-${i}` })));
    if (path === '/devices?page=2&limit=100') return json([{ id: 'saved-device' }]);
    return json(user);
  });
  cache(f.values); await f.client.login(user.email, 'password'); await f.client.getMyProfile();
  assert.equal(f.calls.some(c => c.path === '/devices'), false);
  assert.equal(f.calls.at(-1)?.device, 'saved-device');
  assert.ok(f.calls.filter(c => c.path.startsWith('/devices?')).every(c => !c.device));
});

test('deleted saved device is replaced before any profile request', async () => {
  const f = fixture(path => json(path.startsWith('/devices?') ? [] : path === '/devices' ? { id: 'replacement' } : user));
  cache(f.values); await f.client.login(user.email, 'password'); await f.client.getMyProfile();
  assert.deepEqual(f.calls.map(c => c.path), ['/auth/login', '/devices?page=1&limit=100', '/devices', '/users/me']);
  assert.equal(f.calls.at(-1)?.device, 'replacement');
  assert.equal(JSON.parse(f.values.get('sonora.device.v1')!).id, 'replacement');
});

test('failed device validation blocks the request and can be retried without a new login', async () => {
  let fail = true;
  const f = fixture(path => path.startsWith('/devices?')
    ? (fail ? json({ message: 'Unavailable' }, 503) : json([{ id: 'saved-device' }])) : json(user));
  cache(f.values); await f.client.login(user.email, 'password');
  await assert.rejects(f.client.getMyProfile(), /Unavailable/);
  assert.equal(f.calls.some(c => c.path === '/users/me'), false);
  assert.equal(f.calls.some(c => c.path === '/devices'), false);
  fail = false; await f.client.getMyProfile();
  assert.equal(f.calls.at(-1)?.device, 'saved-device');
});

test('logout during registration prevents late profile requests and device storage', async () => {
  const started = deferred(), release = deferred();
  const f = fixture(async () => { started.resolve(); await release.promise; return json({ id: 'late-device' }); });
  await f.client.login(user.email, 'password');
  const rejected = assert.rejects(f.client.getMyProfile(), /Session fermée/);
  await started.promise; await f.client.logout(); release.resolve(); await rejected;
  assert.equal(f.client.user, null);
  assert.equal(f.values.has('sonora.device.v1'), false);
  assert.equal(f.calls.some(c => c.path === '/users/me'), false);
});

test('same-account relogin validates the saved device again', async () => {
  let deleted = false;
  const f = fixture(path => json(path.startsWith('/devices?') ? (deleted ? [] : [{ id: 'saved-device' }])
    : path === '/devices' ? { id: 'replacement' } : user));
  cache(f.values); await f.client.login(user.email, 'password'); await f.client.getMyProfile();
  await f.client.logout(); deleted = true;
  await f.client.login(user.email, 'password'); await f.client.getMyProfile();
  assert.equal(f.calls.at(-1)?.device, 'replacement');
});
