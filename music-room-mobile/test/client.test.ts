import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiError, normalizeBaseUrl, tokenFromInput, type TokenStorage } from '../src/api/client.ts';

const origin = 'https://api.example.test';
const key = 'sonora.session.v1';
const user = { id: 'user-a', name: 'Alice', email: 'alice@example.test', musicPreferences: ['jazz'] };
const session = (n = 1) => ({ user, accessToken: `access-${n}`, refreshToken: `refresh-${n}` });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function fixture(handle: (path: string, init: RequestInit) => Promise<Response> | Response) {
  const values = new Map<string, string>();
  const storage: TokenStorage = {
    getItem: async k => values.get(k) ?? null,
    setItem: async (k, v) => { values.set(k, v); },
    deleteItem: async k => { values.delete(k); },
  };
  const calls: { path: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input).slice(origin.length);
    calls.push({ path, init });
    if (path === '/auth/login') return json(session());
    return handle(path, init);
  };
  return { client: new ApiClient(origin, storage, fetcher), storage, values, calls };
}

test('normalizes origins and refuses credentials, query strings and non-HTTP schemes', () => {
  assert.equal(normalizeBaseUrl(' https://api.example.test/ '), origin);
  for (const bad of ['ftp://host', 'https://user:pass@host', 'https://host/api', 'https://host?token=secret', 'invalid']) {
    assert.throws(() => normalizeBaseUrl(bad));
  }
});
test('extracts a token without fetching the pasted URL', () => {
  assert.equal(tokenFromInput('https://host/auth/reset-password?token=aaa.bbb.ccc'), 'aaa.bbb.ccc');
  assert.equal(tokenFromInput('sonora://auth/verify-email?token=aaa.bbb.ccc'), 'aaa.bbb.ccc');
  for (const bad of ['', 'https://host/reset', 'nonsense']) assert.throws(() => tokenFromInput(bad));
});
test('persists only the refresh token bound to the backend, never a password or access token', async () => {
  const f = fixture(() => json({}));
  await f.client.login('alice@example.test', 'password-fixture');
  assert.deepEqual(JSON.parse(f.values.get(key)!), { baseUrl: origin, refreshToken: 'refresh-1' });
});
test('simultaneous 401s share one refresh, including a late response for the old access token', async () => {
  const late = deferred<Response>();
  let oldCalls = 0;
  let refreshes = 0;
  const f = fixture((path, init) => {
    if (path === '/auth/refresh') { refreshes++; return json(session(2)); }
    if ((init.headers as Record<string, string>).Authorization === 'Bearer access-1') {
      oldCalls++;
      return oldCalls === 1 ? json({}, 401) : late.promise;
    }
    return json(user);
  });
  await f.client.login(user.email, 'pw');
  const first = f.client.request('/users/me');
  const second = f.client.request('/users/me');
  await first;
  late.resolve(json({}, 401));
  await second;
  assert.equal(refreshes, 1);
  assert.equal(JSON.parse(f.values.get(key)!).refreshToken, 'refresh-2');
});
test('removes the old refresh before sending and never retries an ambiguous network failure', async () => {
  let f: ReturnType<typeof fixture>;
  f = fixture(path => {
    if (path === '/auth/refresh') {
      assert.equal(f.values.has(key), false);
      throw new TypeError('network lost after sending');
    }
    return json({}, 401);
  });
  await f.client.login(user.email, 'pw');
  await assert.rejects(f.client.request('/users/me'), /Renouvellement interrompu/);
  assert.equal(f.client.user, null);
  assert.equal(f.values.has(key), false);
  await f.client.restore();
  assert.equal(f.calls.filter(c => c.path === '/auth/refresh').length, 1);
});
test('five concurrent requests wait for the same in-flight refresh', async () => {
  const entered = deferred<void>();
  const response = deferred<Response>();
  let refreshes = 0;
  const f = fixture((path, init) => {
    if (path === '/auth/refresh') { refreshes++; entered.resolve(); return response.promise; }
    return (init.headers as Record<string, string>).Authorization === 'Bearer access-1' ? json({}, 401) : json(user);
  });
  await f.client.login(user.email, 'pw');
  const requests = Array.from({ length: 5 }, () => f.client.request('/users/me'));
  await entered.promise;
  response.resolve(json(session(2)));
  await Promise.all(requests);
  assert.equal(refreshes, 1);
});
test('a storage failure after refresh cannot leave the consumed token available for replay', async () => {
  const f = fixture(path => path === '/auth/refresh' ? json(session(2)) : json({}, 401));
  await f.client.login(user.email, 'pw');
  f.storage.setItem = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(f.client.request('/users/me'), /storage unavailable/);
  assert.equal(f.values.has(key), false);
  assert.equal(f.client.user, null);
});
test('restore rotates a saved refresh; tokens saved for another server are never sent', async () => {
  const f = fixture(() => json(session(2)));
  f.values.set(key, JSON.stringify({ baseUrl: 'https://other.example', refreshToken: 'secret' }));
  await f.client.restore();
  assert.equal(f.calls.length, 0);
  f.values.set(key, JSON.stringify({ baseUrl: origin, refreshToken: 'refresh-1' }));
  await f.client.restore();
  assert.equal(f.client.user?.id, user.id);
  assert.equal(f.calls[0].path, '/auth/refresh');
});
test('logout clears local credentials even when the server is offline', async () => {
  const f = fixture(() => { throw new TypeError('offline'); });
  await f.client.login(user.email, 'pw');
  await assert.rejects(f.client.logout(), /Déconnexion locale effectuée/);
  assert.equal(f.client.user, null);
  assert.equal(f.values.has(key), false);
});
test('a refresh response arriving after logout cannot resurrect the session', async () => {
  const entered = deferred<void>();
  const response = deferred<Response>();
  const f = fixture(path => {
    if (path === '/auth/refresh') { entered.resolve(); return response.promise; }
    return path === '/auth/logout' ? json({}) : json({}, 401);
  });
  await f.client.login(user.email, 'pw');
  const pending = assert.rejects(f.client.request('/users/me'), /Session fermée/);
  await entered.promise;
  await f.client.logout();
  response.resolve(json(session(2)));
  await pending;
  assert.equal(f.client.user, null);
  assert.equal(f.values.has(key), false);
});
test('401 after one refresh clears the session instead of looping', async () => {
  const f = fixture(path => path === '/auth/refresh' ? json(session(2)) : json({}, 401));
  await f.client.login(user.email, 'pw');
  await assert.rejects(f.client.request('/users/me'), ApiError);
  assert.equal(f.calls.filter(c => c.path === '/auth/refresh').length, 1);
  assert.equal(f.client.user, null);
});
test('403 privacy refusal never triggers refresh or clears the session', async () => {
  const f = fixture(() => json({ message: 'Profil privé' }, 403));
  await f.client.login(user.email, 'pw');
  await assert.rejects(f.client.request('/users/other'), (e: unknown) => e instanceof ApiError && e.status === 403);
  assert.equal(f.client.user?.id, user.id);
  assert.equal(f.calls.filter(c => c.path === '/auth/refresh').length, 0);
});
test('device headers are sent only after authenticated registration and metadata is reused', async () => {
  const f = fixture(path => json(path === '/devices' ? { id: 'device-a' } : user));
  await f.client.login(user.email, 'pw');
  await f.client.registerDevice('IOS', 'iPhone');
  await f.client.registerDevice('IOS', 'iPhone');
  await f.client.request('/users/me');
  assert.equal(f.calls.filter(c => c.path === '/devices').length, 1);
  assert.equal((f.calls.at(-1)!.init.headers as Record<string, string>)['X-Device-Id'], 'device-a');
  await f.client.logout();
  assert.equal(f.calls.at(-1)?.path, '/auth/logout');
  assert.equal((f.calls.at(-1)!.init.headers as Record<string, string>)['X-Device-Id'], 'device-a');
});
test('device IDs belonging to another user are replaced, never sent during registration', async () => {
  const f = fixture(() => json({ id: 'device-a' }));
  f.values.set('sonora.device.v1', JSON.stringify({ baseUrl: origin, userId: 'other-user', id: 'foreign-device' }));
  await f.client.login(user.email, 'pw');
  await f.client.registerDevice('ANDROID', 'Emulator');
  assert.equal((f.calls.at(-1)!.init.headers as Record<string, string>)['X-Device-Id'], undefined);
  assert.equal(JSON.parse(f.values.get('sonora.device.v1')!).userId, user.id);
});
test('successful password reset clears the local session and uses POST on the configured server', async () => {
  const f = fixture(() => json({ message: 'OK' }));
  await f.client.login(user.email, 'pw');
  await f.client.reset('https://untrusted.example/auth/reset-password?token=aaa.bbb.ccc', 'new-password');
  assert.equal(f.calls.at(-1)?.path, '/auth/reset-password');
  assert.deepEqual(JSON.parse(String(f.calls.at(-1)?.init.body)), { token: 'aaa.bbb.ccc', newPassword: 'new-password' });
  assert.equal(f.client.user, null);
});
