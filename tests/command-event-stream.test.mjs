// @last-edited: 2026-10-11 UTC+7.
// @title: command-event-stream — the streaming channel between a running command and the model waiting on it.
// @state: 7 locks; table shape, device-scoped emit, kind allowlist, cursor long-poll, bounded wait, grants, and retention.
// @dependencies: node:test, assert, fs.

// WHY THIS FILE EXISTS
//
// The MCP edge function is stateless: every POST builds a fresh server and
// transport, then blocks in opera_await_adaptive until a command finishes. The
// device is the only thing that knows what happened in between, and it had no way
// to say so. A burst of eight steps, or a workflow running for twenty seconds,
// was one opaque wait for the model.
//
// The watch-event channel already solved this exact shape — a cursor long-poll
// that returns the moment rows appear (opera_watch_events_wait, 5ms sleep). This
// file locks the same discipline applied to command execution, where the rows
// carry the consequence of typing into somebody's document.
//
// The security locks are the ones that matter. An event row reaches a model's
// context, so an emit path that trusts its caller would be a prompt-injection
// channel from any paired device to any owner. Emit therefore authenticates the
// device the same way the claim path does, refuses a command that belongs to
// another device, and refuses a kind outside the allowlist rather than storing
// whatever string arrived.
//
// Retention is locked because nothing else prunes this table. Command rows are
// swept; event rows are not, so without an explicit sweep the table grows by one
// row per action for the life of the deployment.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');

const migrationName = '20261011140000_opera_agent_command_events.sql';

const migration = () => {
  try {
    return read(`supabase/migrations/${migrationName}`);
  } catch {
    return '';
  }
};

const has = (needle) => migration().includes(needle);

test('the streaming channel exists as a migration, because the transport cannot invent rows', () => {
  assert.notEqual(migration().length, 0, `${migrationName} is missing; command execution has no event channel`);
});

test('the table is keyed by command and carries a monotonic cursor the wait can resume from', () => {
  assert.ok(has('create table if not exists public.opera_command_events'), 'no table');
  assert.ok(has('command_id uuid'), 'events must belong to a command');
  assert.ok(has('id bigserial'), 'a monotonic id is the cursor the wait resumes from');
  assert.ok(has('kind text'), 'a kind is what the model switches on');
  assert.ok(has('envelope jsonb'), 'the payload');
});

test('the table is closed to anon and authenticated, and carries no permissive read policy', () => {
  assert.ok(/revoke all on (table )?public\.opera_command_events from public, ?anon, ?authenticated/i.test(migration()),
    'the table is readable by anon/authenticated');
  assert.ok(!/create policy[^;]*on public\.opera_command_events/i.test(migration()),
    'a select policy on the table would re-open it to every signed-in user');
});

test('emit authenticates the device and refuses a command that is not its own', () => {
  assert.ok(/create or replace function public\.opera_emit_command_event\(/.test(migration()), 'no emit function');
  assert.ok(has('opera_auth_device'), 'emit must resolve the device through the shared auth helper');
  assert.ok(has('security definer'), 'emit runs with table rights, so it must be explicit about its search_path');

  const owned = migration().match(/from public\.opera_commands\s+where\s+id\s*=\s*p_command_id\s+and\s+device_id\s*=/i);
  assert.ok(owned, 'emit must match the command against the authenticated device id, not just look it up');
});

test('emit refuses a kind outside the allowlist, so a device cannot ship arbitrary payload labels', () => {
  const allow = migration().match(/'(received|step|observation|note|done)'/);
  assert.ok(allow, 'no kind allowlist found');

  const kinds = migration().match(/kind\s*=\s*any\s*\(\s*array\s*\[([^\]]+)\]/i);
  assert.ok(kinds, 'the allowlist must be enforced with an array membership test');

  const listed = [...kinds[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(listed.sort(), ['done', 'note', 'observation', 'received', 'step'],
    'the allowlist drifted from the documented set');
});

test('the wait is a cursor long-poll that returns rows the moment they exist', () => {
  assert.ok(/create or replace function public\.opera_command_events_wait\(/.test(migration()), 'no wait function');

  const loop = migration().match(/loop\b[\s\S]*?end loop;/i);
  assert.ok(loop, 'the wait must be a loop, or it cannot stream');

  assert.ok(/if jsonb_array_length\(v_rows\) > 0 then/i.test(loop[0]),
    'rows present must return immediately, before the deadline is consulted');

  assert.ok(/id\s*>\s*v_after/i.test(migration()), 'the wait must resume from the cursor, or it replays');
  assert.ok(/command_id\s*=\s*p_command_id/i.test(migration()), 'the wait must not read another command\'s stream');
  assert.ok(/pg_sleep\(/i.test(migration()), 'a wait loop with no sleep would spin the database');
});

test('the wait is bounded, so a stalled command cannot pin a connection open', () => {
  const clamp = migration().match(/least\(greatest\(coalesce\(p_timeout_ms[^)]*\)[^)]*\)[^)]*\)/i);
  assert.ok(clamp, 'p_timeout_ms must be clamped on both ends');
  assert.ok(/clock_timestamp\(\)\s*>=\s*v_deadline/i.test(migration()), 'no deadline check; the loop can outlive its budget');
});

test('both functions are service_role only, matching the watch-event channel', () => {
  assert.ok(/revoke all on function public\.opera_emit_command_event\([^)]*\) from public, ?anon, ?authenticated/i.test(migration()),
    'emit is reachable by anon/authenticated');
  assert.ok(/grant execute on function public\.opera_emit_command_event\([^)]*\) to service_role/i.test(migration()),
    'emit is not granted to service_role');
  assert.ok(/revoke all on function public\.opera_command_events_wait\([^)]*\) from public, ?anon, ?authenticated/i.test(migration()),
    'the wait is reachable by anon/authenticated');
  assert.ok(/grant execute on function public\.opera_command_events_wait\([^)]*\) to service_role/i.test(migration()),
    'the wait is not granted to service_role');
});

test('events are swept, because nothing else prunes this table', () => {
  assert.ok(/delete from public\.opera_command_events where created_at < now\(\) - interval/i.test(migration()),
    'no retention sweep; the table grows by one row per action forever');
});

test('the MCP transport can actually carry a stream, so the channel is not dead code', () => {
  const mcp = read('supabase/functions/opera-agent-mcp/index.ts');
  assert.ok(/enableJsonResponse:\s*false/.test(mcp),
    'enableJsonResponse:true answers with one JSON body at the end, so progress can never reach the model');
});