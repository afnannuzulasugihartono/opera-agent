import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { sha256CanonicalLf } from './helpers/canonical-source-hash.mjs';
import { ALLOWED_METHODS, PRODUCT_VERSION } from '../extension/lib/protocol.js';

// MCP surface, consolidated 2026-10-03.
//
// Four files covered the same surface from different angles and every schema
// change had to be re-pinned in each of them, so they now live here as
// sections: A identity, B schemas, C behavior and wiring, D digests. Merged
// from tests/mcp.test.mjs (15) + tests/mcp-inventory-compat-r4.test.mjs (3) +
// tests/mcp-roundtrip-efficiency.test.mjs (14) +
// tests/r9-public-surface-unchanged.test.mjs (6) = 38 assertions. The count is
// the invariant: consolidating must move assertions, never drop or weaken
// them. Per-test comments below keep their original re-freeze reasons, because
// those reasons are the audit trail for why each pin exists.
//
// What this file does NOT cover stays where it was: semantic engine behavior
// remains in tests/semantic-release-gate.test.mjs (only its MCP digest angle
// is duplicated here by necessity, not by design).

const sourceUrl = new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url);
const configUrl = new URL('../supabase/functions/opera-agent-mcp/deno.json', import.meta.url);
const authUrl = new URL('../supabase/functions/opera-agent-mcp/../opera-agent-auth/index.ts', import.meta.url);
const consentUrl = new URL('../oauth-consent/index.html', import.meta.url);
const vercelConfigUrl = new URL('../oauth-consent/vercel.json', import.meta.url);
const supabaseConfigUrl = new URL('../supabase/config.toml', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const config = JSON.parse(await readFile(configUrl, 'utf8'));
const authSource = await readFile(authUrl, 'utf8');
const consentSource = await readFile(consentUrl, 'utf8');
const vercelConfig = JSON.parse(await readFile(vercelConfigUrl, 'utf8'));
const supabaseConfig = await readFile(supabaseConfigUrl, 'utf8');
const contract = JSON.parse(
  fs.readFileSync(new URL('./fixtures/mcp-contract-v1.json', import.meta.url), 'utf8')
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

// T021 — freeze the public compatibility inventory before the R4 compact
// model-facing projection changes any extension output behavior.

const FROZEN_MCP_TOOLS = [
  'activate_tab', 'browser_status', 'capture_page', 'click_at', 'click_element',
  'close_tab', 'drag_pointer', 'fill_element', 'find_elements', 'list_tabs',
  'move_pointer', 'navigate_tab', 'open_url', 'press_key', 'read_page',
  'run_browser_burst', 'run_workflow', 'scroll_page', 'wheel_at'
];

const FROZEN_METHODS = [
  'browser.burst', 'browser.ping', 'media.pause', 'media.play', 'media.seek',
  'media.state', 'page.capture', 'page.click', 'page.collect_links',
  'page.fill', 'page.find', 'page.focus', 'page.key', 'page.pointer',
  'page.query', 'page.read', 'page.scroll', 'page.wait_for', 'tabs.activate',
  'tabs.close', 'tabs.find', 'tabs.get', 'tabs.list', 'tabs.navigate',
  'tabs.open', 'tabs.reload'
];

const FROZEN_READ_PAGE_PROPERTIES = [
  'includeElements', 'limit', 'maxElements', 'offset', 'tabId'
];

const FROZEN_TOOL_SCHEMAS = Object.freeze({
  browser_status: 'e2e1c444ec75f62f',
  run_browser_burst: 'a195bbb8a3566db7',
  run_workflow: '352a3d543e9786b0',
  start_watch: '411495a345c1446c',
  wait_events: '711f765e7122133f', // Re-frozen 2026-10-02 (Phase C): wait_events stops ignoring its declared timeoutMs and declares the envelope opera_watch_events_wait actually returns. It previously advertised the command envelope {ok, commandId, status, result, timing} while the SQL returned {ok, events, cursor, count}, so a model trusting the schema looked for fields that do not exist. The wait_events outputSchema is now the only schema that changed; every other tool digest is byte-identical above.
  stop_watch: 'd4a280daed0ec9c7',
  list_tabs: '2d4798f5650f17b7',
  open_url: '8512165d9e2ca0f2',
  activate_tab: '43712c8acd61d4da',
  navigate_tab: '89d184536dc4e89f',
  close_tab: '2b18e2ed2dd09475',
  read_page: '167c8069bd0525b3',
  capture_page: '9b7f47af69c78b3c',
  find_elements: 'ebd97137bf12ee61',
  click_element: 'e69b352538678f9b',
  fill_element: 'eb24046e23c127f8',
  press_key: '7f46f878a52172bb',
  scroll_page: '964567b192825f66',
  move_pointer: 'b8adb741ad19103a',
  click_at: 'c50c98d5f209134b',
  drag_pointer: '52474fc5dc262439',
  wheel_at: '1bc3d389f2343e4a' // Re-frozen 2026-10-02: Enterprise Phase 4 Task 2 fail-closed CORS (last tool block runs to EOF, covering the Deno.serve CORS handler edit; schema bytes unchanged).
});

// The only tool whose schema the R9-B keyboard commit changed. Everything else
// must stay byte-identical, so an unrelated schema edit cannot ride along.
const R9B_CHANGED_TOOL = 'press_key';
// The press_key digest before R9-B, kept so the record of the change is visible
// and a silent revert cannot be mistaken for "nothing ever changed".
const PRE_R9B_PRESS_KEY_DIGEST = '41a4003cadb60196';
// R9-E then added the hover burst step, which lives inside run_browser_burst's
// schema rather than in a tool of its own.
const R9E_CHANGED_TOOL = 'run_browser_burst';

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

function toolBlocks() {
  const starts = [...source.matchAll(/server\.registerTool\("([a-z_]+)"/g)];
  return starts.map((match, index) => {
    const from = source.indexOf('inputSchema:', match.index);
    const end = index + 1 < starts.length ? starts[index + 1].index : source.length;
    return { name: match[1], schema: source.slice(from, end) };
  });
}

function schemaDigest(schema) {
  return createHash('sha256').update(schema.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
}

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

function sqlBody(sql, fn) {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  assert.ok(start >= 0, `${fn} must exist`);
  const end = sql.indexOf('end $$;', start);
  return sql.slice(start, end);
}

// --- A. identity: names, counts, inventory ------------------------------

test('MCP dependencies are pinned', () => {
  // Re-frozen 2026-10-02: JSR file imports carry a path after the version
  // (edge-runtime.d.ts); the pin requirement is unchanged, only the
  // version-may-be-followed-by-path form is admitted.
  for (const specifier of Object.values(config.imports)) {
    assert.match(specifier, /@[0-9]+\.[0-9]+\.[0-9]+(\/|$)/);
    assert.doesNotMatch(specifier, /@(latest|next)(\/|$)/);
  }
});

test('MCP exposes focused browser tools and no generic command escape hatch', () => {
  const tools = [...source.matchAll(/server\.registerTool\("([a-z_]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tools, [
    'browser_status', 'run_browser_burst', 'run_workflow', 'start_watch', 'wait_events', 'stop_watch', 'list_tabs', 'open_url', 'activate_tab', 'navigate_tab', 'close_tab',
    'read_page', 'capture_page', 'find_elements', 'click_element', 'fill_element', 'press_key', 'scroll_page',
    'move_pointer', 'click_at', 'drag_pointer', 'wheel_at'
  ]);
  assert.equal(new Set(tools).size, tools.length);
  assert.doesNotMatch(source, /registerTool\("(?:run_command|execute_command|raw_command)"/);
});

test('R4 keeps the protocol inventory frozen at 26 allowlisted primitives for release 1.6.14', () => {
  assert.equal(PRODUCT_VERSION, '1.6.14');
  assert.equal(ALLOWED_METHODS.length, 26);
  assert.deepEqual([...ALLOWED_METHODS].sort(), FROZEN_METHODS);
});

test('R4 keeps the public MCP tool inventory frozen at 22 tools (U-T rebaseline: watch tools added)', async () => {
  const registered = [...source.matchAll(/server\.registerTool\("([a-z_]+)"/g)].map((match) => match[1]);
  assert.equal(registered.length, 22); // U-T rebaseline: watch tools added
  assert.deepEqual([...registered].sort(), [...FROZEN_MCP_TOOLS, 'start_watch', 'stop_watch', 'wait_events'].sort());
});

test('R4 keeps the read_page input schema frozen with no view parameter', async () => {
  const start = source.indexOf('server.registerTool("read_page"');
  assert.ok(start >= 0, 'read_page tool must remain registered');
  const end = source.indexOf('server.registerTool(', start + 1);
  const block = source.slice(start, end < 0 ? undefined : end);
  const schemaStart = block.indexOf('inputSchema: {');
  const schemaEnd = block.indexOf('annotations:');
  assert.ok(schemaStart >= 0 && schemaEnd > schemaStart, 'read_page input schema block must be present');
  const schema = block.slice(schemaStart, schemaEnd);
  const properties = [...schema.matchAll(/(\w+):\s*(?:z\.|tabIdSchema)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(properties)].sort(), FROZEN_READ_PAGE_PROPERTIES);
  assert.doesNotMatch(schema, /view:/);
});

test('the tool count and names are unchanged', () => {
  const registered = [...source.matchAll(/server\.registerTool\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.equal(registered.length, 22);
  assert.deepEqual(registered, contract.tools);
  assert.equal(contract.toolCount, 22);
});

test('no generic escape hatch was introduced', () => {
  assert.doesNotMatch(source, /registerTool\("(?:run_command|execute_command|raw_command)"/);
});

// --- B. schemas: per-tool pins, burst vocabulary, keyboard surface --------

test('the frozen schema map matches the live file, and records the one authorized change', () => {
  const blocks = toolBlocks();
  assert.equal(blocks.length, 22, 'the public tool count must not change');
  const actual = {};
  for (const block of blocks) actual[block.name] = schemaDigest(block.schema);
  // Every recorded digest must match the file, so a stale entry cannot mask a
  // later edit and an unauthorized edit cannot pass unnoticed.
  assert.deepEqual(actual, FROZEN_TOOL_SCHEMAS);
  // And the tools that were authorized to change must be recorded as changed.
  assert.notEqual(FROZEN_TOOL_SCHEMAS[R9B_CHANGED_TOOL], PRE_R9B_PRESS_KEY_DIGEST);
  assert.ok(FROZEN_TOOL_SCHEMAS[R9E_CHANGED_TOOL]);
});

test('the shared burst step schema is pinned by its step set, not only by digest', () => {
  // run_browser_burst's inputSchema is a *reference* to burstStepSchema, so the
  // per-tool digest above cannot observe a change inside the shared constant.
  // This is the layer that closes that gap: the public burst vocabulary is
  // pinned by name, so adding or removing a step fails loudly here.
  const steps = [...source.matchAll(/action: z\.literal\("([a-z]+)"\)/g)].map((m) => m[1]);
  // navigate joined the burst vocabulary (maps to the existing tabs.navigate
  // primitive; see the audit-repair note in boundary-locks.mjs). The list stays
  // exact so any further addition fails loudly here.
  assert.deepEqual(steps, [
    'read', 'find', 'click', 'fill', 'key', 'scroll', 'hover', 'wait', 'pointer', 'navigate'
  ]);
  // The burst union must stay strict so unknown step keys are still rejected.
  const union = source.match(/const burstStepSchema = z\.discriminatedUnion\("action", \[([\s\S]*?)\n\]\);/);
  assert.ok(union, 'the burst step union must be locatable');
  assert.equal((union[1].match(/\}\)\.strict\(\)/g) || []).length, steps.length);
  assert.match(source, /z\.array\(burstStepSchema\)\.min\(1\)\.max\(8\)/);
});

test('the keyboard surface now exposes chords and bounded text on both entry points', () => {
  const pressKey = toolBlocks().find((block) => block.name === 'press_key').schema;
  assert.match(pressKey, /key: navigationKeySchema\.optional\(\)/);
  assert.match(pressKey, /modifiers: z\.array\(modifierSchema\)\.max\(4\)\.optional\(\)/);
  assert.match(pressKey, /text: z\.string\(\)\.min\(1\)\.max\(20000\)\.optional\(\)/);

  const burstKeyStep = source.match(/z\.object\(\{\s*action: z\.literal\("key"\)[\s\S]*?\}\)\.strict\(\)/)?.[0] ?? '';
  assert.ok(burstKeyStep, 'the burst key step must exist');
  assert.match(burstKeyStep, /modifiers: z\.array\(modifierSchema\)/);
  assert.match(burstKeyStep, /text: z\.string\(\)\.min\(1\)\.max\(20000\)/);
});

test('the expanded key and modifier vocabularies are bounded', () => {
  const declared = source.match(/const navigationKeySchema = z\.enum\(\[([\s\S]*?)\]\)/)[1]
    .split(',').map((entry) => entry.trim().replace(/^"|"$/g, ''));
  // The original 12 navigation keys must all remain, plus letters, digits, and
  // the editing keys an editor actually needs.
  for (const key of ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft',
    'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Space', 'Backspace', 'Delete']) {
    assert.ok(declared.includes(key), `${key} must stay allowlisted`);
  }
  // The alphabet and digits arrive as spreads, so assert the real sources rather
  // than re-parsing the enum literal.
  const array = (name) => {
    const body = source.match(new RegExp(`const ${name} = "([^"]*)"\\.split\\(""\\)`))?.[1];
    assert.ok(body !== undefined, `${name} must be a split string literal`);
    return [...body];
  };
  const lower = array('lowercaseLetters');
  const upper = array('uppercaseLetters');
  const digits = array('digits');
  assert.equal(lower.length, 26);
  assert.equal(upper.length, 26);
  assert.equal(digits.length, 10);
  assert.equal(lower.join(''), 'abcdefghijklmnopqrstuvwxyz');
  assert.equal(digits.join(''), '0123456789');
  // The enum must actually spread them, or the arrays are dead code.
  const enumBody = source.match(/const navigationKeySchema = z\.enum\(\[([\s\S]*?)\]\)/)[1];
  for (const spread of ['...lowercaseLetters', '...uppercaseLetters', '...digits']) {
    assert.ok(enumBody.includes(spread), `${spread} must be part of the key enum`);
  }
  // Bounded: a fixed vocabulary, not free-form key strings, so nothing
  // arbitrary can be injected through the public surface. The enum literal
  // holds 17 named keys plus the three spreads.
  assert.equal(declared.length, 20);
  assert.equal(declared.filter((entry) => entry.startsWith('...')).length, 3);
  assert.equal(declared.length - 3 + lower.length + upper.length + digits.length, 79);

  const modifiers = source.match(/const modifierSchema = z\.enum\(\[([\s\S]*?)\]\)/)[1]
    .split(',').map((entry) => entry.trim().replace(/^"|"$/g, ''));
  assert.deepEqual(modifiers, ['alt', 'control', 'ctrl', 'shift', 'meta', 'cmd', 'command', 'option', 'super', 'win']);
  assert.equal(modifiers.length <= 10, true);
});

test('the instructions now teach the chords the schema actually accepts', () => {
  const instructions = source.match(/instructions: "([\s\S]*?)",\n/)[1];
  // The R9-G placeholder must be gone: the schema moved, so the guidance moves.
  assert.doesNotMatch(instructions, /are not available on this surface yet/);
  // Re-frozen 2026-10-01: instructions literal escaped (\"), served text unchanged — see 77ec536.
  assert.match(instructions, /select all with key \\"a\\" and modifiers \[\\"control\\"\]/);
  assert.match(instructions, /paste with key \\"v\\" and modifiers \[\\"control\\"\]/);
  // The menu/dialog habit from R9-G must survive, now expressed with the R9-E
  // hover step rather than a hand-built wait between levels.
  assert.match(instructions, /The same rule applies to MENUS and DIALOGS/);
  assert.match(instructions, /use a hover burst step with the found ref via refFromStep/);
  assert.match(instructions, /chain the levels in a single burst/);
});

test('the sensitive-field guard is still advertised for keyboard input', () => {
  const pressKey = toolBlocks().find((block) => block.name === 'press_key').schema;
  const tool = source.slice(source.indexOf('server.registerTool("press_key"'));
  assert.match(tool.slice(0, 1200), /refused on password, OTP, and payment fields/);
  assert.match(pressKey, /executionMode: executionModeSchema/);
});

test('MCP burst schema is bounded and does not expose arbitrary commands or code', () => {
  assert.match(source, /z\.array\(burstStepSchema\)\.min\(1\)\.max\(8\)/);
  assert.match(source, /cannot open, close, loop, branch, or execute JavaScript/);
  assert.doesNotMatch(source, /cannot open, navigate, close/);
  assert.doesNotMatch(source, /browser\.plan/);
});

test('every burst step kind accepts an optional per-step tabId', () => {
  // Audit repair (2026-10-03): the extension executes a per-step tabId, but
  // every burstStepSchema object was .strict() without one, so the public tool
  // rejected cross-tab bursts while appearing to support them. Each of the ten
  // step kinds must carry the optional field; strictness stays so nothing else
  // rides in. Counted structurally: one optional tabId per step kind.
  const start = source.indexOf('const burstStepSchema');
  const end = source.indexOf(']);', start);
  assert.ok(start >= 0 && end > start, 'burstStepSchema block must exist');
  const block = source.slice(start, end);
  const kinds = [...block.matchAll(/action: z\.literal\("([a-z]+)"\)/g)].map((m) => m[1]);
  const tabFields = [...block.matchAll(/tabId: tabIdSchema\.optional\(\)/g)];
  const stricts = [...block.matchAll(/\.strict\(\)/g)];
  assert.deepEqual(kinds, ['read', 'find', 'click', 'fill', 'key', 'scroll', 'hover', 'wait', 'pointer', 'navigate']);
  assert.equal(tabFields.length, kinds.length, `each of the ${kinds.length} step kinds must accept tabId`);
  assert.equal(stricts.length, kinds.length, 'strictness must stay on every step kind');
});

// --- C. behavior and wiring ---------------------------------------------

// Phase C (2026-10-02): make the AI-facing command path pay what it should.
//
// Four defects, all on the MCP surface, all in one commit with one digest
// re-freeze. `tests/mcp-contract-v1.json` freezes the whole-file SHA256, and
// `tests/fixtures/reactive-vm-contract-v1.json` folds that SHA into
// `inventory.digest`, so this commit re-freezes both rather than weakening them.
//
// 1. The MCP server waited on `opera_await`, whose flat 50ms sleep was the coarser of the two available waits, while the gateway already used `opera_await_adaptive`; the two share a signature and a response envelope including the same timing fields, so this is a latency swap with no contract change. page.capture still uses `opera_await_capture`, which scrubs the stored screenshot.
// 2. `wait_events` declares a `timeoutMs` its handler never destructured, so the model could set it and nothing happened.
// 3. `wait_events` declares an `outputSchema` of {ok, commandId, status, result, timing}, which is the *command* envelope. `opera_watch_events_wait` actually returns {ok, events, cursor, count}. A model trusting the declared schema looked for fields that do not exist.
// 4. The 4.5 KB system prompt never mentions `start_watch`, `wait_events`, or `run_workflow`. All three exist to remove model round trips, and the prompt spends three emphatic passages on burst instead. The model cannot use a mechanism it was never told about.

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

test('MCP requires bearer auth and never exposes the service role key', () => {
  assert.match(source, /if \(!await authenticate\(req\)\) return unauthorized\(req\)/);
  assert.match(source, /OPERA_AGENT_MCP_TOKEN/);
  assert.match(source, /OPERA_AGENT_MCP_USER_IDS/);
  assert.match(source, /OPERA_AGENT_MCP_USER_EMAILS/);
  assert.doesNotMatch(source, /SERVICE_ROLE_KEY[^\n]*(?:content|structuredContent|console\.log)/);
});

test('OAuth protected-resource metadata uses the canonical public function URL', () => {
  assert.match(source, /SUPABASE_URL\.replace\(\/\\\/\$\/, ""\)\}\/functions\/v1\/opera-agent-mcp/);
  assert.match(source, /resource: publicBaseUrl\(\)/);
});

test('MCP delegates only known Opera Agent methods', () => {
  const methods = [...source.matchAll(/execute\("([a-z.]+)"/g)].map((match) => match[1]);
  const allowed = new Set([
    'browser.ping', 'browser.burst', 'tabs.list', 'tabs.open', 'tabs.activate', 'tabs.navigate', 'tabs.close',
    'page.read', 'page.capture', 'page.find', 'page.click', 'page.fill', 'page.key', 'page.scroll', 'page.pointer',
    'watch.start', 'watch.stop', 'watch.stop_all', 'watch.list'
  ]);
  assert.ok(methods.length >= 16);
  for (const method of methods) assert.ok(allowed.has(method), `unexpected method ${method}`);
});

test('MCP instructions make browser usage discoverable without mentioning Supabase', () => {
  assert.match(source, /Use Opera Agent whenever the user asks to open, navigate, inspect, click, type, scroll, visually inspect/);
  assert.match(source, /open_url defaults to an inactive tab, retain its returned tabId/);
  assert.match(source, /Never substitute the user's active tab during a multi-step task/);
  assert.match(source, /Never use activate_tab as an implicit recovery step/);
  assert.match(source, /Coordinate actions default to invisible background CDP input/);
  assert.match(source, /Use capture_page adaptively only/);
  assert.match(source, /For lazy result lists, call wheel_at/);
  assert.match(source, /stableKey\/href values/);
  assert.match(source, /pass previousHash to avoid retransmitting unchanged images/);
  assert.match(source, /If a tool returns FOREGROUND_REQUIRED/);
  assert.match(source, /Supabase is internal transport and should not be mentioned/);
});

test('MCP returns screenshots as image content without duplicating base64 in structured metadata', () => {
  assert.match(source, /type: "image", data, mimeType/);
  assert.match(source, /delete metadataScreenshot\.data/);
  assert.match(source, /runCommand\("page\.capture"/);
  // page.capture keeps opera_await_capture because it scrubs the image bytes out
  // of the command row; the ordinary path moved to the adaptive ramp in Phase C.
  assert.match(source, /method === "page\.capture" \? "opera_await_capture" : "opera_await_adaptive"/);
  assert.match(source, /user-private, password, OTP, payment/);
  assert.doesNotMatch(source, /captureVisibleTab/);
});

test('MCP defaults to background tabs and requires explicit automation targets', () => {
  assert.match(source, /active: active \?\? false/);
  assert.doesNotMatch(source, /active: active \?\? true/);
  assert.match(source, /const tabIdSchema = z\.number\(\)\.int\(\)\.nonnegative\(\)/);
  assert.doesNotMatch(source, /const tabIdSchema[^\n]*\.optional\(\)/);
  assert.match(source, /z\.enum\(\["background", "foreground"\]\)\.optional\(\)/);
  assert.doesNotMatch(source, /"auto"/);
  assert.match(source, /executionMode: executionMode \?\? "background"/);
  assert.match(source, /value, trusted: true, executionMode/);
  assert.match(source, /Background mode is invisible and does not activate the tab/);
});

test('MCP preserves structured command failures for foreground permission handling', () => {
  assert.match(source, /class CommandFailure extends Error/);
  assert.match(source, /code: error\.code, message: error\.message/);
  assert.match(source, /throw new CommandFailure\(code, message/);
  assert.match(source, /structuredContent = \{ ok: false, error: failure \}/);
});

test('OAuth config endpoint exposes only public client configuration', () => {
  assert.match(authSource, /SUPABASE_ANON_KEY/);
  assert.match(authSource, /Access-Control-Allow-Origin/);
  assert.match(authSource, /opera-agent-auth-config/);
  assert.doesNotMatch(authSource, /SERVICE_ROLE|OPERA_AGENT_MCP_TOKEN/);
});

test('hosted OAuth consent artifact has no embedded privileged secret', () => {
  assert.match(consentSource, /@supabase\/supabase-js@2\.116\.0/);
  assert.match(consentSource, /opera-agent-auth\/config/);
  assert.match(consentSource, /getAuthorizationDetails/);
  assert.match(consentSource, /approveAuthorization/);
  assert.match(consentSource, /denyAuthorization/);
  assert.match(consentSource, /session\?\.user\?\.is_anonymous/);
  assert.match(consentSource, /data\.user\?\.is_anonymous/);
  assert.match(consentSource, /signOut\(\{ scope: 'local' \}\)/);
  assert.doesNotMatch(consentSource, /service_role|OPERA_AGENT_MCP_TOKEN|eyJhbGci/);
  assert.equal(vercelConfig.rewrites[0].source, '/oauth/consent');
  assert.equal(vercelConfig.rewrites[0].destination, '/');
  assert.ok(vercelConfig.headers[0].headers.some((header) => header.key === 'Content-Security-Policy'));
});

test('hosted OAuth consent module has valid JavaScript syntax', () => {
  const moduleSource = consentSource.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';
  const parseableSource = moduleSource.replace(/^\s*import\s+.*?;\s*$/m, '');
  assert.doesNotThrow(() => new Function(`return (async () => {${parseableSource}\n})`));
});

test('Supabase OAuth config declares a hosted consent page and dynamic registration', () => {
  assert.match(supabaseConfig, /\[auth\.oauth_server\]/);
  assert.match(supabaseConfig, /enabled = true/);
  assert.match(supabaseConfig, /authorization_path = "\/oauth\/consent"/);
  assert.match(supabaseConfig, /allow_dynamic_registration = true/);
});

// --- D. digests: the freeze itself ------------------------------------

test('the whole-file digest fixture is re-frozen to the live file', () => {
  assert.equal(sha256CanonicalLf(source), contract.sourceSha256);
});
