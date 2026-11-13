// @last-edited: 2026-11-08 UTC+7.
// @title: mcp-output-kr — every answer says each fact once, and every collection is an array under a name.
// @state: the envelope rule, the array rule, the flat map answer, and the capture that names its size once.
// @dependencies: node:test, strict, node:fs, node:module.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = stripTypeScriptTypes(readFileSync(
  new URL('../../shared/tidy.js', import.meta.url), 'utf8'
));
const { tidyForAi } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

test('no output keeps the transport envelope', () => {
  const out = tidyForAi({ ok: true, commandId: 'c', status: 'completed', timing: { totalMs: 1 }, result: { ok: true, tabId: 7 } });
  assert.deepEqual(out, { ok: true, tabId: 7 });
});

test('every collection the surface returns is an array under a named field', () => {
  const out = tidyForAi({
    ok: true,
    result: { ok: true, tabs: [], items: [], elements: [], classes: [], events: [], rows: [], skills: [], segments: [] }
  });
  for (const key of ['tabs', 'items', 'elements', 'classes', 'events', 'rows', 'skills', 'segments']) {
    assert.equal(Array.isArray(out[key]), true, key + ' must be an array');
  }
});

test('a map pull keeps one copy of every fact', () => {
  const out = tidyForAi({
    ok: true,
    commandId: 'c',
    result: { ok: true, tabId: 7, class: 'link', offset: 0, limit: 2, total: 3, hasMore: true, nextOffset: 2, elements: [] }
  });
  assert.equal(Object.keys(out).filter((key) => key === 'tabId').length, 1);
  assert.equal(Object.keys(out).filter((key) => key === 'ok').length, 1);
});

test('a capture names its size once, in the crop', () => {
  const capture = readFileSync(new URL('../../extension/worker/capture-page.js', import.meta.url), 'utf8');
  assert.doesNotMatch(capture, /sourceWidth|sourceHeight/, 'the crop already carries the captured width and height');
});