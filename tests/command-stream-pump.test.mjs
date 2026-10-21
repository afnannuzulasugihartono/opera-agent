// @last-edited: 2026-10-11 UTC+7.
// @title: command-stream-pump — the consumer loop must stop on a terminal status and never on an empty pass.
// @state: 7 locks; cursor advance, terminal exit, deadline exit, no busy spin, callback isolation, no replay, and the status the SQL must return.
// @dependencies: node:test, strict, node:fs, node:module.

// WHY THIS FILE EXISTS

// The streaming channel is proven at the database and the transport is proven to carry progress, so the remaining risk is entirely in this loop: a pump that never exits, that replays events, or that dies because a consumer threw.

// The trap worth naming is the empty pass.
// A loop that treats "no events this slice" as "nothing is happening" either returns early with the command still running, or keeps the model blind until the command finishes.
// The only legal exits are a terminal status and a blown deadline, and every test below exists to pin one of those two.

// The cursor is pinned because a replay is worse than a stall: the model would be told the same step happened twice and would act on a document state it has already left.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = stripTypeScriptTypes(readFileSync(
  new URL('../supabase/functions/_shared/command-stream.ts', import.meta.url), 'utf8'
).replace(/^import .*;\r?\n/gm, ''));

const { streamCommandEvents, TERMINAL_COMMAND_STATUSES } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

const slice = (events, status) => ({ ok: true, events, status, cursor: events.at(-1)?.id ?? 0 });

function scriptedRpc(script) {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    const next = script.shift();
    if (!next) throw new Error('rpc called more often than the script allows');
    return next;
  };
  return { rpc, calls };
}

test('the terminal statuses are the four the command table can end on', () => {
  assert.deepEqual([...TERMINAL_COMMAND_STATUSES].sort(), ['cancelled', 'completed', 'expired', 'failed']);
  assert.ok(!TERMINAL_COMMAND_STATUSES.includes('queued'), 'queued is not terminal');
  assert.ok(!TERMINAL_COMMAND_STATUSES.includes('claimed'), 'claimed is not terminal');
});

test('an empty first pass does not end the stream, because the command is still running', async () => {
  const { rpc } = scriptedRpc([
    slice([], 'queued'),
    slice([{ id: '1', kind: 'step' }], 'claimed'),
    slice([], 'completed')
  ]);
  const out = await streamCommandEvents({ rpc, commandId: 'c1' });
  assert.equal(out.ok, true);
  assert.equal(out.status, 'completed');
  assert.equal(out.events.length, 1, 'the empty passes dropped the one real event');
});

test('every event reaches the consumer as it arrives, not batched at the end', async () => {
  const seen = [];
  const { rpc } = scriptedRpc([
    slice([{ id: '1', kind: 'step' }], 'claimed'),
    slice([{ id: '2', kind: 'step' }], 'claimed'),
    slice([{ id: '3', kind: 'done' }], 'completed')
  ]);
  await streamCommandEvents({ rpc, commandId: 'c1', onEvent: (e) => seen.push(e.kind) });
  assert.deepEqual(seen, ['step', 'step', 'done']);
});

test('the cursor advances, so a later slice never replays what was already delivered', async () => {
  const { rpc, calls } = scriptedRpc([
    slice([{ id: '7', kind: 'step' }], 'claimed'),
    slice([{ id: '9', kind: 'step' }], 'claimed'),
    slice([], 'completed')
  ]);
  await streamCommandEvents({ rpc, commandId: 'c1' });
  const afterIds = calls.slice(1).map((c) => c.args.p_after_id);
  assert.deepEqual(afterIds, [7, 9], 'the cursor did not move with the highest id seen');
});

test('a consumer that throws does not strand the command', async () => {
  const { rpc } = scriptedRpc([slice([{ id: '1', kind: 'step' }], 'claimed'), slice([], 'completed')]);
  const out = await streamCommandEvents({
    rpc,
    commandId: 'c1',
    onEvent: () => { throw new Error('consumer gone'); }
  });
  assert.equal(out.ok, true);
  assert.equal(out.status, 'completed');
});

test('a lost stream is reported rather than retried forever', async () => {
  const { rpc, calls } = scriptedRpc([{ ok: false, error: 'Command stream lost.' }]);
  const out = await streamCommandEvents({ rpc, commandId: 'c1' });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'Command stream lost.');
  assert.equal(calls.length, 1, 'a dead stream was retried');
});

test('the wait slice is bounded so one call cannot pin a connection past the deadline', async () => {
  const { rpc, calls } = scriptedRpc([slice([], 'queued'), slice([], 'completed')]);
  await streamCommandEvents({ rpc, commandId: 'c1', deadlineMs: 30000 });
  for (const c of calls) {
    assert.ok(c.args.p_timeout_ms <= 30000, `slice ${c.args.p_timeout_ms} exceeds the database ceiling`);
    assert.ok(c.args.p_timeout_ms >= 100, `slice ${c.args.p_timeout_ms} is below the database floor`);
  }
});

test('a command that never terminates exits on the deadline instead of spinning forever', async () => {
  let calls = 0;
  const rpc = async () => {
    calls += 1;
    if (calls > 500) throw new Error('the loop never reached its deadline');
    await new Promise((r) => setTimeout(r, 20));
    return slice([], 'claimed');
  };
  const out = await streamCommandEvents({ rpc, commandId: 'c1', deadlineMs: 300 });
  assert.equal(out.ok, false);
  assert.equal(out.error?.code, 'AWAIT_TIMEOUT');
  assert.ok(calls > 1, 'the deadline was only reached by returning early, not by looping');
});

test('the SQL returns a status, because a consumer with no status cannot know when to stop', () => {
  const sql = readFileSync(
    new URL('../supabase/migrations/20261011150000_opera_agent_command_event_status.sql', import.meta.url), 'utf8'
  );
  assert.match(sql, /'status', v_status/, 'the wait does not report the command status');
  assert.match(sql, /select status into v_status from public\.opera_commands where id = p_command_id/);
  assert.match(sql, /v_status in \('completed','failed','expired','cancelled'\)/,
    'the wait returns before the command is terminal');
});