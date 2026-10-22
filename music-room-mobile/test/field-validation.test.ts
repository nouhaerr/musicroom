import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldValidation } from '../src/auth/field-validation.ts';

test('keeps untouched fields quiet, then validates missing or malformed values', () => {
  assert.equal(fieldValidation('', true, true, false), '');
  assert.equal(fieldValidation('   ', true, false, true), 'This field is required.');
  assert.equal(fieldValidation('invalid', true, true, true), 'Enter a valid email address.');
});
test('correcting a value clears the error without waiting for a timer', () => {
  assert.equal(fieldValidation('  alice@example.com  ', true, true, true), '');
  assert.equal(fieldValidation('Alice', true, false, true), '');
  assert.equal(fieldValidation('', false, false, true), '');
});
