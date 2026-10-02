import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { sha256CanonicalLf } from './helpers/canonical-source-hash.mjs';

// Phase C (2026-10-02): make the AI-facing command path pay what it should.
//
// Four defects, all on the MCP surface, all in one commit with one digest
// re-freeze. `tests/mcp-contract-v1.json` freezes the whole-file SHA256, and
// `tests/fixtures/reactive-vm-contract-v1.json` folds that SHA into
// `inventory.digest`, so this commit re-freezes both rather than weakening them.
//
// 1. The MCP server waited on `opera_await`, which polls at a flat 50ms. The
//    gateway already used `opera_await_adaptive`, whose ramp starts at 5ms. The
//    AI-facing path therefore had the worse wait of the two. Phase A measured
//    the two at the same iteration count for a 10x finer first response, so this
//    is not a database-cost change.
//
// 2. `wait_events` declares a `timeoutMs` its handler never destructures, so the
//    model could set it and nothing happened.
//
// 3. `wait_events` declares an `outputSchema` of
//    {ok, commandId, status, result, timing}, which is the *command* envelope.
//    `opera_watch_events_wait` actually returns {ok, events, cursor, count}. A
//    model trusting the declared schema looks for fields that do not exist.
//
// 4. The 4.5 KB system prompt never mentions `start_watch`, `wait_events`, or
//    `run_workflow`. All three exist to remove model round trips, and the
//    prompt spends three emphatic passages on burst instead. The model cannot
//    use a mechanism it was never told about.

const source = fs.readFileSync(
  new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url),
  'utf8'
);
const core = fs.readFileSync(
  new URL('../supabase/migrations/20260907204146_opera_agent_1_0_0_core.sql', import.meta.url),
  'utf8'
);
const etw = fs.readFileSync(
  new URL('../supabase/migrations/20260922000000_opera_agent_ut_etw.sql', import.meta.url),
  'utf8'
);
const screenshot = fs.readFileSync(
  new URL('../supabase/migrations/20260910121107_opera_agent_adaptive_screenshot.sql', import.meta.url),
  'utf8'
);

function instructions() {
  const line = source.split('\n').find((l) => l.includes('instructions:'));
  assert.ok(line, 'the MCP server must still declare instructions');
  const from = line.indexOf('instructions: "') + 'instructions: "'.length;
  return line.slice(from, line.lastIndexOf('"'));
}

function toolBlock(name) {
  const starts = [...source.matchAll(/server\.registerTool\("([a-z_]+)"/g)];
  const index = starts.findIndex((m) => m[1] === name);
  assert.ok(index >= 0, `${name} must be registered`);
  const from = source.indexOf('inputSchema:', starts[index].index);
  const end = index + 1 < starts.length ? starts[index + 1].index : source.length;
  return source.slice(from, end);
}

function sqlBody(sql, fn) {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  assert.ok(start >= 0, `${fn} must exist`);
  const end = sql.indexOf('end $$;', start);
  return sql.slice(start, end);
}

// --- 1. the AI path gets the ramp -----------------------------------------

test('the MCP command path waits on the adaptive ramp, not the flat 50ms', () => {
  assert.match(source, /"opera_await_adaptive"/);
  assert.doesNotMatch(source, /"opera_await"/);
});

test('page.capture still uses opera_await_capture, which rewrites the screenshot', () => {
  // It scrubs the image bytes out of the command row and stores them, so it
  // cannot be swapped for the plain command wait.
  assert.match(sqlBody(screenshot, 'opera_await_capture'), /scrubbed/);
  assert.match(source, /method === "page\.capture" \? "opera_await_capture" : "opera_await_adaptive"/);
});

test('the swap is contract-neutral: both waits share a signature and a response shape', () => {
  const flat = sqlBody(core, 'opera_await');
  const adaptive = sqlBody(etw, 'opera_await_adaptive');
  for (const body of [flat, adaptive]) {
    assert.match(body, /p_command_id uuid,?\s*p_timeout_ms integer/);
    assert.match(body, /'commandId',v_cmd\.id/);
    assert.match(body, /'status',v_cmd\.status/);
    assert.match(body, /'result',v_cmd\.result/);
    assert.match(body, /'queuedMs'/);
    assert.match(body, /'totalMs'/);
  }
  // Identical failure envelopes too.
  for (const body of [flat, adaptive]) {
    assert.match(body, /'AWAIT_TIMEOUT','message','Timed out waiting for command result\.'/);
  }
  // The only intended difference is the sleep schedule.
  assert.match(flat, /pg_sleep\(0\.05\)/);
  assert.match(adaptive, /pg_sleep\(case when v_polls<=4 then 0\.005/);
});

// --- 2. wait_events honours its declared timeoutMs ------------------------

test('wait_events honours the timeoutMs its schema declares', () => {
  const block = toolBlock('wait_events');
  assert.match(block, /timeoutMs\s*:\s*timeoutSchema/);
  // The handler must destructure it and feed the RPC, not merely declare it.
  const handler = block.slice(block.indexOf('}, ({'));
  assert.match(handler, /\{[^}]*\btimeoutMs\b[^}]*\}/, 'the handler must receive timeoutMs');
  assert.match(handler, /p_timeout_ms:[\s\S]*?timeoutMs\s*\?\?\s*waitMs/);
});

test('timeoutMs takes precedence over the legacy waitMs alias', () => {
  const handler = toolBlock('wait_events').slice(toolBlock('wait_events').indexOf('}, ({'));
  // Precedence, not addition: a caller that sets both gets timeoutMs.
  assert.match(handler, /timeoutMs\s*\?\?\s*waitMs\s*\?\?\s*25000/);
});

test('waitMs stays accepted so an existing caller is not broken', () => {
  const block = toolBlock('wait_events');
  assert.match(block, /waitMs:\s*z\.number\(\)\.int\(\)\.min\(500\)\.max\(30000\)/);
});

// --- 3. wait_events declares the envelope it actually returns -------------

function outputSchemaOf(name) {
  const block = toolBlock(name);
  const at = block.indexOf('outputSchema:');
  assert.ok(at >= 0, `${name} must declare an outputSchema`);
  // Brace-matched slice so a nested object inside the schema cannot end it early.
  let depth = 0;
  for (let i = at + 'outputSchema:'.length; i < block.length; i += 1) {
    if (block[i] === '{') depth += 1;
    else if (block[i] === '}') {
      depth -= 1;
      if (depth === 0) return block.slice(at, i + 1);
    }
  }
  assert.fail(`${name} outputSchema is not brace-balanced`);
}

test('wait_events outputSchema matches what opera_watch_events_wait returns', () => {
  const sql = sqlBody(etw, 'opera_watch_events_wait');
  const declared = outputSchemaOf('wait_events');
  for (const key of ['ok', 'events', 'cursor', 'count']) {
    assert.match(declared, new RegExp(`\\b${key}:`), `outputSchema must declare ${key}`);
    assert.match(sql, new RegExp(`'${key}'`), `the SQL must return ${key}`);
  }
  // And must NOT declare the command envelope it never returns.
  for (const key of ['commandId', 'status', 'result', 'timing']) {
    assert.doesNotMatch(declared, new RegExp(`\\b${key}:`), `outputSchema must not declare ${key}`);
  }
});

test('the event shape is pinned to the columns the SQL actually selects', () => {
  const sql = sqlBody(etw, 'opera_watch_events_wait');
  const declared = outputSchemaOf('wait_events');
  for (const column of ['id', 'watcher_id', 'device_name', 'envelope', 'created_at']) {
    assert.match(sql, new RegExp(`\\b${column}\\b`), `the SQL must select ${column}`);
    assert.match(declared, new RegExp(`\\b${column}:`), `outputSchema must declare ${column}`);
  }
});

// --- 4. the prompt finally names the round-trip-removing tools ------------

test('the instructions name start_watch, wait_events and run_workflow', () => {
  const text = instructions();
  for (const tool of ['start_watch', 'wait_events', 'run_workflow']) {
    assert.match(text, new RegExp(`\\b${tool}\\b`), `instructions must mention ${tool}`);
  }
});

test('the guidance states why each one removes a round trip', () => {
  const text = instructions();
  assert.match(text, /no model round trip sits between the page changing and the action happening/i);
  assert.match(text, /instead of re-reading the page to notice/i);
  assert.match(text, /rather than polling/i);
  assert.match(text, /executes the whole versioned sequence server-side/i);
  // Each tool must be tied to the job it does, not merely named.
  const watchAt = text.indexOf('start_watch');
  const eventsAt = text.indexOf('wait_events');
  const workflowAt = text.indexOf('run_workflow');
  assert.ok(watchAt < eventsAt, 'start_watch must be introduced before wait_events');
  assert.ok(eventsAt < workflowAt, 'the watch pair must precede run_workflow');
});

test('the pre-existing instruction fragments all survive', () => {
  const text = instructions();
  for (const fragment of [
    /open_url defaults to an inactive tab, retain its returned tabId/,
    /stableKey\/href values/,
    /If a tool returns FOREGROUND_REQUIRED/,
    /Supabase is internal transport and should not be mentioned/,
    /that stale ref is refused on purpose/,
    /refFromStep/,
    /Coordinate actions default to invisible background CDP input/,
    /Never use activate_tab as an implicit recovery step/
  ]) {
    assert.match(text, fragment, `instructions must still contain ${fragment}`);
  }
});

test('the tool count and names are unchanged', () => {
  const contract = JSON.parse(
    fs.readFileSync(new URL('./fixtures/mcp-contract-v1.json', import.meta.url), 'utf8')
  );
  const registered = [...source.matchAll(/server\.registerTool\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.equal(registered.length, 22);
  assert.deepEqual(registered, contract.tools);
  assert.equal(contract.toolCount, 22);
});

test('no generic escape hatch was introduced', () => {
  assert.doesNotMatch(source, /registerTool\("(?:run_command|execute_command|raw_command)"/);
});

test('the whole-file digest fixture is re-frozen to the live file', () => {
  const contract = JSON.parse(
    fs.readFileSync(new URL('./fixtures/mcp-contract-v1.json', import.meta.url), 'utf8')
  );
  assert.equal(sha256CanonicalLf(source), contract.sourceSha256);
});