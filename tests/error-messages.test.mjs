import test from 'node:test';
import assert from 'node:assert/strict';
import { userErrorMessage } from '../extension/lib/error-messages.js';

test('known errors map to actionable messages', () => {
  assert.equal(userErrorMessage('Pairing failed.'), 'Pairing failed. Check the code and try again.');
  assert.equal(
    userErrorMessage('Unable to update tab privacy.'),
    'Could not update this tab. Try reloading the page.',
  );
  assert.equal(
    userErrorMessage('Invalid pairing code.'),
    'That pairing code is invalid. Check the code and try again.',
  );
  assert.equal(userErrorMessage('Invalid tabId.'), 'Could not update this tab. Try reloading the page.');
  assert.equal(
    userErrorMessage('Invalid bridge URL.'),
    'The bridge address is invalid. Check the address and try again.',
  );
});

test('unknown, garbage, and token-shaped inputs fall back to generic', () => {
  assert.equal(userErrorMessage('Error: connect ECONNREFUSED 127.0.0.1'), 'Something went wrong. Run self-test, then check the connection.');
  assert.equal(userErrorMessage('ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), 'Something went wrong. Run self-test, then check the connection.');
  assert.equal(userErrorMessage(null), 'Something went wrong. Run self-test, then check the connection.');
});

test('dynamic background strings fall back to generic (no raw internals)', () => {
  assert.equal(
    userErrorMessage('watch_event delivery failed: TypeError: fetch failed'),
    'Something went wrong. Run self-test, then check the connection.',
  );
  assert.equal(
    userErrorMessage('HTTP 500'),
    'Something went wrong. Run self-test, then check the connection.',
  );
  assert.equal(
    userErrorMessage(undefined),
    'Something went wrong. Run self-test, then check the connection.',
  );
});
