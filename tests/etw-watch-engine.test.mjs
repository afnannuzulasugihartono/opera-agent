import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

// U-T Event-Triggered Workflows (2026-09-22): the watch engine compiles a
// model's intent into device-local trigger rules so reaction speed follows the
// page, not the model round trip. The pure policy engine is exercised for real
// in Node (trigger kinds, any/all composition, debounce, deadline, once/repeat,
// maxEvents, already-true-at-arm); migration and gateway are source-contract
// locked like the U-S suite.

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const { validateRule, evaluateRules, TRIGGER_KINDS } = await import('../extension/lib/watch.js');

const rule = (over = {}) => ({
  ruleId: 'r1',
  trigger: { kind: 'selectorPresence', selector: '.skip' },
  action: { type: 'report' },
  mode: 'once',
  maxEvents: 1,
  deadlineMs: 60000,
  debounceMs: 0,
  ...over
});

test('trigger kinds are the documented set (fail-closed for unknown kinds)', () => {
  assert.deepEqual([...TRIGGER_KINDS].sort(), ['adState', 'mediaTime', 'navigation', 'selectorGone', 'selectorPresence', 'textMatch', 'urlChange'].sort());
  assert.equal(validateRule(rule({ trigger: { kind: 'mindReading' } })).ok, false);
  assert.equal(validateRule(rule()).ok, true);
  assert.equal(validateRule(rule({ deadlineMs: 10_000_000 })).ok, false, 'deadline is bounded');
  assert.equal(validateRule(rule({ maxEvents: 0 })).ok, false);
});

test('selectorPresence fires and once-rules retire; gone fires only after presence', () => {
  let now = 1000;
  const snap = (present) => ({ facts: { r1: { present } }, url: 'https://x/', adState: false, mediaTime: 0 });
  let st = {};
  const r1 = rule();
  let out = evaluateRules([r1], snap(false), st, now);
  st = out.state;
  out = evaluateRules([r1], snap(true), st, now += 10);
  st = out.state;
  assert.equal(out.fired.length, 1);
  assert.equal(st.r1.fireCount, 1);
  const again = evaluateRules([r1], snap(true), st, now += 10);
  assert.equal(again.fired.length, 0, 'once-rule retires after firing');
  // gone: armed while absent must NOT fire until a presence was observed
  const g = rule({ ruleId: 'g1', trigger: { kind: 'selectorGone', selector: '.x' } });
  let s2 = {};
  const absent = { facts: { g1: { present: false } }, url: '', adState: false, mediaTime: 0 };
  s2 = evaluateRules([g], absent, s2, now).state;
  s2 = evaluateRules([g], absent, s2, now += 10).state;
  const noFire = evaluateRules([g], absent, s2, now += 10);
  assert.equal(noFire.fired.length, 0, 'no gone-fire without prior presence');
  s2 = noFire.state;
  s2 = evaluateRules([g], { ...absent, facts: { g1: { present: true } } }, s2, now).state;
  const last = evaluateRules([g], absent, s2, now += 10);
  assert.equal(last.fired.length, 1, 'fires when present->absent');
});

test('composition any/all + textMatch + urlChange + adState + mediaTime', () => {
  const snap = (o) => ({ facts: {}, url: o.url ?? 'https://x/', adState: !!o.ad, mediaTime: o.t ?? 0, text: o.text });
  let st = {};
  const rules = [
    rule({ ruleId: 'a1', trigger: { kind: 'textMatch', text: 'Skip', mode: 'contains' } }),
    rule({ ruleId: 'a2', trigger: { kind: 'urlChange' } }),
    rule({ ruleId: 'a3', trigger: { kind: 'adState', state: 'on' }, mode: 'repeat', maxEvents: 5 }),
    rule({ ruleId: 'a4', trigger: { kind: 'mediaTime', atSeconds: 30 } })
  ];
  st = evaluateRules(rules, snap({ url: 'https://x/', text: 'nope' }), st, 1000).state;
  const urlChanged = st.a2.baselineUrl ?? '';
  assert.notEqual(urlChanged, undefined, 'urlChange arms a baseline');
  const out = evaluateRules(rules, snap({ url: 'https://x/watch?v=1', text: 'Skip Ad now', ad: true, t: 31 }), st, 1100);
  const ids = out.fired.map((f) => f.ruleId).sort();
  assert.deepEqual(ids, ['a1', 'a2', 'a3', 'a4']);
});

test('already-true at arm fires immediately (the T041 lesson); debounce then throttles', () => {
  let st = {};
  const d = rule({ ruleId: 'd1', mode: 'repeat', maxEvents: 10, debounceMs: 500, deadlineMs: 5000 });
  // present on the very first evaluation = already-true-at-arm → fires NOW
  const first = evaluateRules([d], { facts: { d1: { present: true } }, url: '', adState: false, mediaTime: 0 }, st, 100);
  assert.equal(first.fired.length, 1, 'already-true must not be swallowed');
  st = first.state;
  const throttled = evaluateRules([d], { facts: { d1: { present: true } }, url: '', adState: false, mediaTime: 0 }, st, 300);
  assert.equal(throttled.fired.length, 0, 'inside debounce window');
  const ok = evaluateRules([d], { facts: { d1: { present: true } }, url: '', adState: false, mediaTime: 0 }, throttled.state, 700);
  assert.equal(ok.fired.length, 1);
  const dead = evaluateRules([d], { facts: { d1: { present: true } }, url: '', adState: false, mediaTime: 0 }, ok.state, 6000);
  assert.equal(dead.fired.length, 0, 'past deadline the rule never fires again');
  assert.equal(dead.state.d1.retired, true);
});

test('background exposes watch primitives and caps; bridge ingests events', () => {
  const bg = read('extension/background.js');
  assert.match(bg, /case 'watch\.start'/);
  assert.match(bg, /case 'watch\.stop'/);
  assert.match(bg, /watch\.stop_all/);
  assert.match(bg, /MAX_WATCHERS_PER_TAB|WATCHERS_PER_TAB/);
  assert.match(bg, /lib\/watch\.js/);
  const bridge = read('supabase/functions/opera-agent-bridge/index.ts');
  assert.match(bridge, /watch_event/);
  assert.match(bridge, /opera_watch_event_ingest/);
  assert.match(bridge, /start_workflow/);
  assert.match(bridge, /opera_start_workflow/);
});

test('migration adds events table, adaptive await, run_fast with service_role grants', () => {
  const src = read('supabase/migrations/20260922000000_opera_agent_ut_etw.sql');
  assert.match(src, /create table if not exists public\.opera_watch_events/);
  assert.match(src, /create or replace function public\.opera_watch_events_wait\(p_watcher text, ?p_after_seq bigint, ?p_timeout_ms integer/);
  assert.match(src, /pg_sleep\(0\.005\)/);
  assert.match(src, /create or replace function public\.opera_await_adaptive\(p_command_id uuid, ?p_timeout_ms integer/);
  assert.match(src, /create or replace function public\.opera_run_fast\(p_method text, ?p_params jsonb, ?p_timeout_ms integer, ?p_device_name text, ?p_request_id text/);
  assert.match(src, /grant execute on function public\.opera_run_fast\(text, ?jsonb, ?integer, ?text, ?text\) to service_role/);
  assert.match(src, /retention|delete from public\.opera_watch_events/i);
});

test('gateway is one-hop universal ingress with GPT-Actions-compatible auth', () => {
  const src = read('supabase/functions/opera-agent-gateway/index.ts');
  assert.match(src, /Deno\.serve/);
  assert.match(src, /x-opera-agent-token/, 'header auth');
  assert.match(src, /apiKey/, 'body auth because GPT Actions cannot set headers');
  assert.match(src, /opera_run_fast/, 'enqueue+await in ONE SQL call');
  assert.match(src, /openapi\.json/, 'GPT Actions schema endpoint');
  assert.match(src, /p_request_id/, 'idempotency key passthrough');
});

test('MCP gains start_watch/wait_events/stop_watch wired to the device path', () => {
  const src = read('supabase/functions/opera-agent-mcp/index.ts');
  assert.match(src, /start_watch/);
  assert.match(src, /wait_events/);
  assert.match(src, /stop_watch/);
});
