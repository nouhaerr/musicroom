import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openEmailInbox } from '../src/auth/open-email.ts';

test('Android opens the native inbox without trying iOS URL schemes', async () => {
  let opened = false;
  await openEmailInbox('android', {
    openAndroidInbox: async () => { opened = true; },
    openURL: async () => { assert.fail('Android must not use iOS schemes'); },
  });
  assert.equal(opened, true);
});

test('iOS falls back from Gmail to Apple Mail', async () => {
  const urls: string[] = [];
  await openEmailInbox('ios', {
    openAndroidInbox: async () => { assert.fail('iOS must not use Android intents'); },
    openURL: async url => { urls.push(url); if (urls.length === 1) throw new Error('Unavailable'); },
  });
  assert.deepEqual(urls, ['googlegmail://', 'message://']);
});

test('missing Android email handler propagates to the UI fallback', async () => {
  await assert.rejects(openEmailInbox('android', {
    openAndroidInbox: async () => { throw new Error('No handler'); },
    openURL: async () => { assert.fail('No misleading compose fallback'); },
  }), /No handler/);
});
