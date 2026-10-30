// @last-edited: 2026-10-30 UTC+7.
// @title: local-clipboard — the clipboard writer that refuses what it cannot place, and the paste that carries it.
// @state: the refusals, the platform limit, and the key events a paste is made of.
// @dependencies: node:test, strict, ../local/clipboard.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureHtml,
  pasteHtml,
  readHtml,
  writeHtml
} from '../local/clipboard.js';

// WHY THE PLATFORM IS FAKED FOR THE REFUSALS.
// The writer shells out to PowerShell on Windows only, and a test that ran it would put text on the machine's real clipboard.
// Faking the platform exercises the limit itself, which is the part that must not silently pass elsewhere.

const asPlatform = async (
  platform,
  run
) => {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', {
    value: platform
  });
  try {
    return await run();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
};

test('an empty buffer is refused before anything is written', async () => {
  await asPlatform('win32', async () => {
    assert.throws(() => writeHtml('   '), /no HTML/);
  });
});

test('a machine without the PowerShell writer is told so instead of failing silently', async () => {
  await asPlatform('darwin', async () => {
    assert.throws(() => writeHtml('<p>x</p>'), /Windows only/);
    assert.throws(() => ensureHtml('<p>x</p>', 'marker'), /Windows only/);
    assert.equal(readHtml(), null);
  });
});

test('a paste is the paste command on the Ctrl+V key, sent down and up', async () => {
  const sent = [];
  const cdp = {
    send: async (
      method,
      params
    ) => {
      sent.push({
        method,
        params
      });
      return null;
    }
  };
  const result = await pasteHtml(cdp);
  assert.equal(result.pasted, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].method, 'Input.dispatchKeyEvent');
  assert.deepEqual(sent[0].params.commands, ['paste']);
  assert.equal(sent[0].params.modifiers, 2, 'the control modifier is the second bit');
  assert.equal(sent[0].params.type, 'keyDown');
  assert.equal(sent[1].params.type, 'keyUp');
});

test('a paste needs the page connection', async () => {
  await assert.rejects(() => pasteHtml(null), /page connection/);
});
