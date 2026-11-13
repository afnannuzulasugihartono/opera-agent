// @last-edited: 2026-11-07 UTC+7.
// @title: mcp-output-tidy — the shape a model reads: the answer first, the transport gone.
// @state: the envelope rules, the tab fields, the bridge fields, and the raw escape hatch.
// @dependencies: node:test, strict, node:fs, node:module.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = stripTypeScriptTypes(readFileSync(
  new URL('../shared/tidy.js', import.meta.url), 'utf8'
));

const { tidyForAi } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

test('the envelope opens and the answer comes out at the top', () => {
  const out = tidyForAi({
    ok: true,
    commandId: 'c-1',
    status: 'completed',
    result: { ok: true, tabs: [{ id: 7, title: 'Page', url: 'https://example.test/', active: true }] },
    timing: { totalMs: 12, queuedMs: 3 }
  });

  assert.deepEqual(out, {
    ok: true,
    tabs: [{ id: 7, title: 'Page', url: 'https://example.test/', active: true }]
  });
  assert.equal('commandId' in out, false);
  assert.equal('status' in out, false);
  assert.equal('timing' in out, false);
  assert.equal('result' in out, false);
});

test('the ok flag is said once', () => {
  const out = tidyForAi({ ok: true, result: { ok: true, value: 1 } });

  assert.deepEqual(out, { ok: true, value: 1 });
  assert.equal(Object.keys(out).filter((key) => key === 'ok').length, 1);
});

test('the browser window chrome is gone and the page facts stay', () => {
  const out = tidyForAi({
    ok: true,
    result: {
      ok: true,
      tabs: [{
        id: 1517046872,
        url: 'https://example.test/',
        title: 'Example',
        active: false,
        muted: false,
        pinned: false,
        audible: false,
        status: 'complete',
        windowId: 1517043800
      }]
    }
  });

  assert.deepEqual(out.tabs[0], {
    id: 1517046872,
    url: 'https://example.test/',
    title: 'Example',
    active: false,
    status: 'complete'
  });
});

test('the bridge keeps its last error and loses its bookkeeping', () => {
  const out = tidyForAi({
    ok: true,
    result: {
      ok: true,
      paired: true,
      bridge: {
        url: 'ws://127.0.0.1:9451',
        port: 9451,
        trace: [{ ms: 1, event: 'in' }],
        alarms: [],
        linked: true,
        replies: 4,
        running: true,
        commands: 2,
        failures: 0,
        lastError: 'bridge refused the handshake'
      }
    }
  });

  assert.deepEqual(out.bridge, { lastError: 'bridge refused the handshake' });
  assert.equal(out.paired, true);
});

test('a bridge with no error is not carried at all', () => {
  const out = tidyForAi({
    ok: true,
    result: { ok: true, bridge: { port: 9451, trace: [], linked: true, commands: 0 } }
  });

  assert.equal('bridge' in out, false);
});

test('a failed workflow keeps what it failed on', () => {
  const out = tidyForAi({
    ok: false,
    runId: 'r-1',
    workflow: 'youtube.skip_ads',
    status: 'failed',
    result: null,
    error: { code: 'NO_AD_FOUND', message: 'no ad to skip' },
    timing: { totalMs: 900 }
  });

  assert.deepEqual(out, {
    ok: false,
    workflow: 'youtube.skip_ads',
    status: 'failed',
    error: { code: 'NO_AD_FOUND', message: 'no ad to skip' }
  });
});

test('a result that is already flat stays flat', () => {
  assert.deepEqual(tidyForAi({ ok: true, events: [], cursor: 0, count: 0 }), {
    ok: true,
    events: [],
    cursor: 0,
    count: 0
  });
});

test('a payload with no ok flag gets one', () => {
  assert.deepEqual(tidyForAi({ id: 'lesson-1' }), { ok: true, id: 'lesson-1' });
});

test('the server tidies every answer and keeps the raw envelope one flag away', () => {
  const index = readFileSync(
    new URL('../hosted/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8'
  );

  assert.match(index, /import \{ tidyForAi \} from "\.\.\/\.\.\/\.\.\/shared\/tidy\.js";/);
  assert.match(index, /OPERA_AGENT_MCP_RAW/);
  assert.match(index, /tidyForAi\(value\)/);
  assert.match(index, /tidyForAi\(shaped\)/);
});
