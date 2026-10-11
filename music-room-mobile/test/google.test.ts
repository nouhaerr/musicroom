import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ApiClient, type TokenStorage } from '../src/api/client.ts';
import { googleConfig, interactiveGoogleToken, type GoogleDriver } from '../src/auth/google-flow.ts';

const web = '123-web.apps.googleusercontent.com';
const ios = '123-ios.apps.googleusercontent.com';
const own = { id: 'alice', name: 'Alice', email: 'alice@example.test', musicPreferences: [], publicInfo: {}, privateInfo: {} };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function fixture(handle: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const values = new Map<string, string>();
  const storage: TokenStorage = {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    deleteItem: async key => { values.delete(key); },
  };
  const calls: { path: string; init: RequestInit }[] = [];
  const client = new ApiClient('https://api.example.test', storage, async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, init });
    if (path === '/auth/login') return json({ user: own, accessToken: 'sonora-access', refreshToken: 'sonora-refresh' });
    return handle(path, init);
  });
  return { client, values, calls };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

test('Google requires platform config and never asks for Google offline access', () => {
  assert.throws(() => googleConfig('ios', web), /not configured/);
  assert.throws(() => googleConfig('android', 'not-a-client'), /not configured/);
  assert.deepEqual(googleConfig('android', web), { webClientId: web, offlineAccess: false, autoSelectOnSignIn: false });
  assert.equal(googleConfig('ios', web, ios).iosClientId, ios);
});

test('Google uses an explicit chooser and clears SDK state; only ID token leaves the adapter', async () => {
  const events: string[] = [];
  const driver: GoogleDriver = {
    configure: () => { events.push('configure'); },
    checkPlayServices: async () => { events.push('play'); },
    signOut: async () => { events.push('clear'); },
    presentExplicitSignIn: async () => { events.push('choose'); return { type: 'success', data: { idToken: 'google-id' } }; },
  };
  assert.equal(await interactiveGoogleToken(driver, googleConfig('android', web), 'android'), 'google-id');
  assert.deepEqual(events, ['configure', 'play', 'clear', 'choose', 'clear']);
});

test('cancelled Google dialogs return no token and native errors never expose their raw contents', async () => {
  const driver: GoogleDriver = {
    configure: () => {}, checkPlayServices: async () => {}, signOut: async () => {},
    presentExplicitSignIn: async () => ({ type: 'cancelled', data: null }),
  };
  assert.equal(await interactiveGoogleToken(driver, googleConfig('ios', web, ios), 'ios'), null);
  driver.presentExplicitSignIn = async () => { throw { code: 'SIGN_IN_CANCELLED', message: 'private' }; };
  assert.equal(await interactiveGoogleToken(driver, googleConfig('ios', web, ios), 'ios'), null);
  driver.presentExplicitSignIn = async () => { throw new Error('secret-provider-value'); };
  await assert.rejects(interactiveGoogleToken(driver, googleConfig('ios', web, ios), 'ios'),
    (e: unknown) => e instanceof Error && !e.message.includes('secret-provider-value'));
});

test('Google login stores only the Sonora refresh token and sends the Google ID token to the login route', async () => {
  const f = fixture(() => json({ user: own, accessToken: 'sonora-access', refreshToken: 'sonora-refresh' }));
  assert.equal(await f.client.loginWithGoogle(async () => 'google-token'), true);
  assert.equal(f.calls[0].path, '/auth/google');
  assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), { idToken: 'google-token' });
  assert.equal((f.calls[0].init.headers as Record<string, string>).Authorization, undefined);
  assert.deepEqual(JSON.parse(f.values.get('sonora.session.v1')!), { baseUrl: 'https://api.example.test', refreshToken: 'sonora-refresh' });
});

test('Google cancellation sends no backend request; 409 never triggers automatic linking', async () => {
  const f = fixture(() => json({ message: 'Liaison explicite nécessaire' }, 409));
  assert.equal(await f.client.loginWithGoogle(async () => null), false);
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.client.loginWithGoogle(async () => 'google-token'), /Liaison explicite/);
  assert.deepEqual(f.calls.map(c => c.path), ['/auth/google']);
  assert.equal(f.values.size, 0);
  assert.equal(f.client.user, null);
});

test('linking requires a Sonora login before opening Google and carries the current device', async () => {
  const f = fixture(path => json(path === '/devices' ? { id: 'device-alice' } : { ...own, googleId: 'linked' }));
  let opened = 0;
  const acquire = async () => { opened++; return 'google-token'; };
  await assert.rejects(f.client.linkGoogle(acquire), /Log in/);
  assert.equal(opened, 0);
  await f.client.login(own.email, 'password');
  await f.client.registerDevice('IOS', 'Simulator');
  assert.equal(await f.client.linkGoogle(acquire), true);
  const call = f.calls.at(-1)!;
  assert.equal(call.path, '/auth/link/google');
  assert.deepEqual(JSON.parse(String(call.init.body)), { idToken: 'google-token' });
  assert.equal((call.init.headers as Record<string, string>).Authorization, 'Bearer sonora-access');
  assert.equal((call.init.headers as Record<string, string>)['X-Device-Id'], 'device-alice');
  assert.equal((f.client.user as typeof own & { googleId: string }).googleId, 'linked');
});

test('a linking conflict preserves the existing Sonora session and does not retry', async () => {
  const f = fixture(() => json({ message: 'Google déjà lié à un autre utilisateur' }, 409));
  await f.client.login(own.email, 'password');
  await assert.rejects(f.client.linkGoogle(async () => 'google-token'), /déjà lié/);
  assert.equal(f.client.user?.id, own.id);
  assert.equal(f.calls.length, 2);
  assert.equal(f.values.has('sonora.session.v1'), true);
});

test('logout while the Google chooser is open prevents a late login or link request', async () => {
  const f = fixture(() => json({}));
  const token = deferred<string>();
  const login = f.client.loginWithGoogle(() => token.promise);
  await f.client.logout(); token.resolve('late-token');
  assert.equal(await login, false);
  assert.equal(f.calls.length, 0);
  await f.client.login(own.email, 'password');
  const secondToken = deferred<string>();
  const linking = assert.rejects(f.client.linkGoogle(() => secondToken.promise), /Session closed/);
  await f.client.logout(); secondToken.resolve('late-token');
  await linking;
  assert.equal(f.calls.some(c => c.path === '/auth/link/google'), false);
});

test('Google redirect plugin keeps existing links and is idempotent; unexpected templates fail explicitly', () => {
  const require = createRequire(import.meta.url);
  const { addGoogleRedirect } = require('../plugins/with-google-redirect.cjs');
  const original = 'import Expo\nreturn super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)';
  const result = addGoogleRedirect(original);
  assert.match(result, /import GoogleSignIn/);
  assert.match(result, /GIDSignIn.sharedInstance.handle\(url\)/);
  assert.match(result, /RCTLinkingManager.application/);
  assert.equal(addGoogleRedirect(result), result);
  assert.throws(() => addGoogleRedirect('new unknown template'), /layout changed/);
});
