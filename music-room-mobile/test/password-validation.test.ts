import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordValidation } from '../src/auth/password-validation.ts';

test('new passwords need eight characters and an ASCII number', () => {
  for (const password of ['', 'abcdefg', 'abcdefgh', 'abcdef1', 'abcdefg１', 'abcdefg١']) {
    assert.equal(passwordValidation(password, password).valid, false, password);
  }
  for (const password of ['abcdefg1', '1abcdefg', 'abcd1efg', '12345678']) {
    assert.equal(passwordValidation(password, password).valid, true, password);
  }
});

test('password rules report length and number separately', () => {
  assert.deepEqual(passwordValidation('abc1', '').password.map(rule => rule.valid), [false, true]);
  assert.deepEqual(passwordValidation('abcdefgh', '').password.map(rule => rule.valid), [true, false]);
});

test('confirmation feedback distinguishes empty, mismatched and matching inputs', () => {
  assert.deepEqual(passwordValidation('abcdefgh1', '').confirm, [{ message: 'Confirm your password.', valid: false }]);
  assert.deepEqual(passwordValidation('abcdefgh1', 'abcdefgh2').confirm, [{ message: "Passwords don't match.", valid: false }]);
  assert.deepEqual(passwordValidation('abcdefgh1', 'abcdefgh1').confirm, [{ message: 'Passwords match.', valid: true }]);
  assert.equal(passwordValidation('changed12', 'abcdefgh1').valid, false);
});

test('matching weak passwords remain invalid and empty inputs never count as matching', () => {
  assert.equal(passwordValidation('abc1', 'abc1').valid, false);
  assert.equal(passwordValidation('', '').confirm[0].valid, false);
});

test('Unicode characters count once, consistently with backend MinLength', () => {
  assert.equal(passwordValidation('😀😀😀😀😀😀1', '😀😀😀😀😀😀1').valid, false);
  assert.equal(passwordValidation('😀😀😀😀😀😀😀1', '😀😀😀😀😀😀😀1').valid, true);
});
