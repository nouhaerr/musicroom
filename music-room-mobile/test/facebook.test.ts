import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interactiveFacebookToken, type FacebookDriver } from '../src/auth/facebook-flow.ts';
import { ApiClient, type TokenStorage } from '../src/api/client.ts';
const nonce = 'random-attempt-nonce';
function driver(cancel = false): FacebookDriver {
  return { logOut() {}, login: async () => ({ isCancelled: cancel }), token: async limited => limited ? 'oidc-token' : 'graph-token' };
}
test('iOS passes the nonce with its OIDC token; Android sends only its Graph token', async () => {
  const ios = driver();
  ios.login = async (limited, actualNonce) => {
    assert.equal(limited, true); assert.equal(actualNonce, nonce); return { isCancelled: false };
  };
  assert.deepEqual(await interactiveFacebookToken(ios, 'ios', nonce), { accessToken: 'oidc-token', nonce });
  assert.deepEqual(await interactiveFacebookToken(driver(), 'android', nonce), { accessToken: 'graph-token' });
});
test('Facebook cancellation has no credential; provider errors are sanitized and SDK state cleared', async () => {
  assert.equal(await interactiveFacebookToken(driver(true), 'ios', nonce), null);
  let cleared = 0;
  const d = driver(); d.logOut = () => { cleared++; }; d.login = async () => { throw new Error('secret-token'); };
  await assert.rejects(interactiveFacebookToken(d, 'ios', nonce), { message: 'Unable to sign in with Facebook. Try again or use your email.' });
  assert.equal(cleared, 2);
});
function fixture(status = 201) {
  const values = new Map<string, string>();
  const storage: TokenStorage = { getItem: async k => values.get(k) ?? null, setItem: async (k,v) => { values.set(k,v); }, deleteItem: async k => { values.delete(k); } };
  const calls: { path: string; body: unknown }[] = [];
  const client = new ApiClient('https://api.example.test', storage, async (url, init) => {
    calls.push({ path: new URL(String(url)).pathname, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(status === 201 ? { user: { id: 'u', email: 'a@b.com', name: 'A' }, accessToken: 'access', refreshToken: 'refresh' } : { message: 'Explicit linking required' }), { status });
  });
  return { client, calls, values };
}
test('Facebook login sends credentials to its route and stores only Sonora refresh credentials', async () => {
  const f = fixture();
  assert.equal(await f.client.loginWithFacebook(async () => ({ accessToken: 'facebook-token', nonce })), true);
  assert.deepEqual(f.calls, [{ path: '/auth/facebook', body: { accessToken: 'facebook-token', nonce } }]);
  assert.ok(!JSON.stringify([...f.values]).includes('facebook-token'));
});
test('cancel does not call backend; conflict never auto-links', async () => {
  const f = fixture(409);
  assert.equal(await f.client.loginWithFacebook(async () => null), false);
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.client.loginWithFacebook(async () => ({ accessToken: 'token' })), /Explicit linking/);
  assert.equal(f.calls.length, 1);
});
test('linking requires login before opening the Facebook dialog', async () => {
  const f = fixture(); let called = false;
  await assert.rejects(f.client.linkFacebook(async () => { called = true; return null; }), /Log in/);
  assert.equal(called, false);
});
test('logout during Facebook dialog prevents late authentication', async () => {
  const f = fixture(); let resolve!: (v: { accessToken: string }) => void;
  const token = new Promise<{ accessToken: string }>(r => { resolve = r; });
  const pending = f.client.loginWithFacebook(() => token);
  await f.client.logout(); resolve({ accessToken: 'token' }); assert.equal(await pending, false);
  assert.equal(f.calls.length, 0);
});
test('Facebook linking uses the authenticated route without replacing the Sonora session', async () => {
  const values = new Map<string, string>();
  const storage: TokenStorage = { getItem: async k => values.get(k) ?? null, setItem: async (k,v) => { values.set(k,v); }, deleteItem: async k => { values.delete(k); } };
  const own = { id: 'u', email: 'a@b.com', name: 'A', musicPreferences: [] };
  let authorization: unknown;
  const client = new ApiClient('https://api.example.test', storage, async (url, init) => {
    if (String(url).endsWith('/auth/login')) return new Response(JSON.stringify({ user: own, accessToken: 'access', refreshToken: 'refresh' }), { status: 201 });
    assert.equal(new URL(String(url)).pathname, '/auth/link/facebook');
    authorization = new Headers(init?.headers).get('Authorization');
    assert.deepEqual(JSON.parse(String(init?.body)), { accessToken: 'fb', nonce });
    return new Response(JSON.stringify({ ...own, facebookId: 'fb-user' }), { status: 201 });
  });
  await client.login(own.email, 'password');
  assert.equal(await client.linkFacebook(async () => ({ accessToken: 'fb', nonce })), true);
  assert.equal(authorization, 'Bearer access');
  assert.equal(client.user?.id, own.id);
});
