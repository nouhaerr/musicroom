import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facebookCredential, type FacebookSdk } from '../src/features/auth/browser-social.ts';

test('Facebook cancellation produces no credential', async () => {
  const sdk: FacebookSdk = { init() {}, login(callback) { callback({ status: 'unknown' }); } };
  assert.equal(await facebookCredential(sdk), null);
});
test('Facebook returns the user access token and requests email', async () => {
  const sdk: FacebookSdk = { init() {}, login(callback, options) { assert.equal(options.scope, 'public_profile,email'); callback({ authResponse: { accessToken: 'test-token' } }); } };
  assert.deepEqual(await facebookCredential(sdk), { accessToken: 'test-token' });
});
test('Facebook SDK exceptions become actionable errors without leaking SDK data', async () => {
  const sdk: FacebookSdk = { init() {}, login() { throw new Error('sensitive provider detail'); } };
  await assert.rejects(facebookCredential(sdk), error => error instanceof Error && error.message.includes('Allow popups') && !error.message.includes('sensitive'));
});
