import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiError, type DeviceInfo, type TokenStorage } from '../src/api/client.ts';

const origin = 'https://api.example.test';
const key = 'sonora.session.v1';
const user = { id: 'user-a', name: 'Alice', email: 'alice@example.test', musicPreferences: [] };
const session = (n = 1) => ({ user, accessToken: `access-${n}`, refreshToken: `refresh-${n}` });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function fixture(handle: (path: string) => Promise<Response> | Response, deviceInfo?: DeviceInfo) {
  const values = new Map<string, string>();
  const storage: TokenStorage = {
    getItem: async k => values.get(k) ?? null,
    setItem: async (k, v) => { values.set(k, v); },
    deleteItem: async k => { values.delete(k); },
  };
  const calls: string[] = [];
  const client = new ApiClient(origin, storage, async input => {
    const path = String(input).slice(origin.length);
    calls.push(path);
    if (path === '/auth/login') return json(session());
    if (path === '/auth/logout') return json({});
    return handle(path);
  }, deviceInfo);
  return { client, values, calls };
}
const refused = (status: number) => (error: unknown) => error instanceof ApiError && error.status === status;

test('socket auth is the current access token, without any request when nothing was refused', async () => {
  const f = fixture(() => json({}, 500));
  await f.client.login(user.email, 'pw');
  assert.deepEqual(await f.client.socketAuth(), { token: 'access-1', deviceId: null });
  assert.deepEqual(f.calls, ['/auth/login']);
});

test('socket auth needs a login', async () => {
  const f = fixture(() => json({}));
  await assert.rejects(f.client.socketAuth(), refused(401));
  assert.deepEqual(f.calls, []);
});

test('a refused token is renewed once, also for two callers at the same time', async () => {
  let refreshes = 0;
  const f = fixture(path => {
    if (path === '/auth/refresh') { refreshes++; return json(session(2)); }
    return json({}, 500);
  });
  await f.client.login(user.email, 'pw');
  const [first, second] = await Promise.all([f.client.socketAuth('access-1'), f.client.socketAuth('access-1')]);
  assert.equal(first.token, 'access-2');
  assert.equal(second.token, 'access-2');
  assert.equal(refreshes, 1);
  assert.equal(JSON.parse(f.values.get(key)!).refreshToken, 'refresh-2');
});

test('a refused token that a request has already renewed is not renewed again', async () => {
  let refreshes = 0;
  const f = fixture(path => {
    if (path === '/auth/refresh') { refreshes++; return json(session(refreshes + 1)); }
    return json({}, 500);
  });
  await f.client.login(user.email, 'pw');
  assert.equal((await f.client.socketAuth('access-1')).token, 'access-2');
  // The socket reports the old token late: the session already holds a newer one
  assert.equal((await f.client.socketAuth('access-1')).token, 'access-2');
  assert.equal(refreshes, 1);
});

test('a renewal the server refuses closes the session and gives no token', async () => {
  const f = fixture(path => path === '/auth/refresh' ? json({ message: 'revoked' }, 401) : json({}, 500));
  await f.client.login(user.email, 'pw');
  await assert.rejects(f.client.socketAuth('access-1'), refused(401));
  assert.equal(f.client.user, null);
  assert.equal(f.values.has(key), false);
});

test('a logout during the renewal gives no token, even if the server then answers', async () => {
  const late = deferred<Response>();
  const f = fixture(path => path === '/auth/refresh' ? late.promise : json({}, 500));
  await f.client.login(user.email, 'pw');
  const auth = f.client.socketAuth('access-1');
  await f.client.logout();
  late.resolve(json(session(2)));
  await assert.rejects(auth, refused(401));
  assert.equal(f.client.user, null);
  assert.equal(f.values.has(key), false);
});

test('socket auth carries the registered device, registering it first if no request did yet', async () => {
  const f = fixture(path => path === '/devices' ? json({ id: 'device-1' }) : json({}, 500),
    { platform: 'ANDROID', model: 'Pixel', appVersion: '0.1.0' });
  await f.client.login(user.email, 'pw');
  assert.deepEqual(await f.client.socketAuth(), { token: 'access-1', deviceId: 'device-1' });
  assert.deepEqual(await f.client.socketAuth(), { token: 'access-1', deviceId: 'device-1' });
  assert.equal(f.calls.filter(path => path === '/devices').length, 1);
});

test('a logout at the same moment gives no token, also when the device is already registered', async () => {
  const f = fixture(path => path === '/devices' ? json({ id: 'device-1' }) : json({}, 500),
    { platform: 'ANDROID', model: 'Pixel', appVersion: '0.1.0' });
  await f.client.login(user.email, 'pw');
  await f.client.socketAuth();
  const auth = f.client.socketAuth();
  const logout = f.client.logout();
  await assert.rejects(auth, refused(401));
  await logout;
});

test('a device registration that fails gives no token but keeps the session for a later try', async () => {
  let fail = true;
  const f = fixture(path => {
    if (path === '/devices') return fail ? json({}, 503) : json({ id: 'device-1' });
    return json({}, 500);
  }, { platform: 'ANDROID', model: 'Pixel', appVersion: '0.1.0' });
  await f.client.login(user.email, 'pw');
  await assert.rejects(f.client.socketAuth(), refused(503));
  assert.equal(f.client.user?.id, user.id);
  fail = false;
  assert.deepEqual(await f.client.socketAuth(), { token: 'access-1', deviceId: 'device-1' });
});
