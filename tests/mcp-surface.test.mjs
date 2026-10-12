// @last-edited: 2026-10-10 UTC+7.
// @title: mcp-surface.test — surface.test — Test.
// @state: three more places claimed the background pointer was invisible.
// @dependencies: node:test, strict, node:fs, promises, node:crypto, canonical-source-hash, protocol.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { sha256CanonicalLf } from './helpers/canonical-source-hash.mjs';
import { ALLOWED_METHODS, PRODUCT_VERSION } from '../extension/lib/protocol.js';

const sourceUrl = new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url);
const configUrl = new URL('../supabase/functions/opera-agent-mcp/deno.json', import.meta.url);
const authUrl = new URL('../supabase/functions/opera-agent-mcp/../opera-agent-auth/index.ts', import.meta.url);
const consentUrl = new URL('../landing/oauth/consent.html', import.meta.url);
const supabaseConfigUrl = new URL('../supabase/config.toml', import.meta.url);
const siteVercelConfigUrl = new URL('../landing/vercel.json', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const config = JSON.parse(await readFile(configUrl, 'utf8'));
const authSource = await readFile(authUrl, 'utf8');
const consentSource = await readFile(consentUrl, 'utf8');
const siteVercelConfig = JSON.parse(await readFile(siteVercelConfigUrl, 'utf8'));
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

const FROZEN_MCP_TOOLS = [
  'activate_tab', 'browser_status', 'capture_page', 'click_at', 'click_element',
  'close_tab', 'drag_pointer', 'fill_element', 'find_elements', 'list_tabs',
  'media_pause', 'media_play', 'media_seek', 'media_state',
  'move_pointer', 'navigate_tab', 'open_url', 'press_key', 'read_page',
  'run_adhoc', 'run_browser_burst', 'run_program', 'run_workflow', 'scroll_page', 'skill_recall', 'skill_save', 'wheel_at',
  'media_stream_start', 'media_stream_stop', 'media_listen_read'
];

const FROZEN_METHODS = [
  'browser.burst', 'browser.ping', 'media.pause', 'media.play', 'media.seek',
  'media.state', 'media.stream_start', 'media.stream_stop', 'page.capture', 'page.click', 'page.collect_links',
  'page.fill', 'page.find', 'page.focus', 'page.key', 'page.pointer',
  'page.query', 'page.read', 'page.scroll', 'page.wait_for', 'tabs.activate',
  'tabs.close', 'tabs.find', 'tabs.get', 'tabs.list', 'tabs.navigate',
  'tabs.open', 'tabs.reload'
];

const FROZEN_READ_PAGE_PROPERTIES = [
  'includeElements', 'limit', 'maxElements', 'offset', 'tabId'
];

const FROZEN_TOOL_SCHEMAS = Object.freeze({
  browser_status: 'cbc26bda16868a68',
  run_browser_burst: 'd948c904d171e8d3',
  run_workflow: '09ce624d89ed95ba',
  run_program: '4220be7d53db3ab1',
  run_adhoc: '14bb44a13751b230',
  skill_save: '12779fcd8c0787db',
  skill_recall: '778eae1cc693e9a3',
  start_watch: '6080c4ec1568b132',
  wait_events: '5edbf05fabbb14c8',
  stop_watch: '5133e82aa7a83fb1',
  list_tabs: '0ded59ff6c5f1b0c',
  open_url: '9b68095958a8242f',
  activate_tab: '39a762c1732bee92',
  navigate_tab: '4947602daae152c1',
  close_tab: '7fba21a3f036f380',
  read_page: '7724641fbfc8270a',
  capture_page: '744f0230732b9e89',
  find_elements: '5ee494a2286bfe19',
  click_element: '524bbdcd910efb97',
  fill_element: '299f17ba1498cd96',
  press_key: 'e4b0dcdca29f6450',
  scroll_page: '49c584144a526142',
  move_pointer: 'd13a06fe00a47847',
  click_at: '0d0a269d88f73068',
  drag_pointer: '4fd6791950121bbd',
  wheel_at: 'a24a25677ba41390',
  media_state: 'dd36328bc7f5eaad',
  media_play: 'be8f1ff4460c156e',
  media_pause: '733cd49a0e0bea0a',
  media_seek: 'b5e27995716abd38',
  media_stream_start: '0c5fbfac4707448f',
  media_stream_stop: '5df002e4171733eb',
  media_listen_read: '9349cc0da3306131',
  loop_start: '212649bff3efff47',
  loop_read: '42112d0c11c4347d',
  loop_stop: 'ab504dfa4d3a4b53',
  loop_state_start: '520af840e35a5023',
  loop_state_read: '25aa53b167aa6a02',
  loop_state_stop: '9d5a19a9bd910269'
});

const R9B_CHANGED_TOOL = 'press_key';

const PRE_R9B_PRESS_KEY_DIGEST = '41a4003cadb60196';

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

function stripSchemaComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i += 1; continue; }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c; i += 1;
      while (i < n) {
        if (text[i] === '\\') { out += text[i] + (text[i + 1] ?? ''); i += 2; continue; }
        out += text[i];
        if (text[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    out += c; i += 1;
  }
  return out;
}

function schemaDigest(schema) {
  const normalised = stripSchemaComments(schema.replace(/\r\n/g, '\n'))
    .split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
  return createHash('sha256').update(normalised).digest('hex').slice(0, 16);
}

function outputSchemaOf(name) {
  const block = toolBlock(name);
  const at = block.indexOf('outputSchema:');
  assert.ok(at >= 0, `${name} must declare an outputSchema`);

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

test('MCP dependencies are pinned', () => {

  for (const specifier of Object.values(config.imports)) {
    assert.match(specifier, /@[0-9]+\.[0-9]+\.[0-9]+(\/|$)/);
    assert.doesNotMatch(specifier, /@(latest|next)(\/|$)/);
  }
});

test('MCP exposes focused browser tools and no generic command escape hatch', () => {
  const tools = [...source.matchAll(/server\.registerTool\("([a-z_]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tools, [
    'browser_status', 'run_browser_burst', 'run_workflow', 'run_program', 'run_adhoc', 'skill_save', 'skill_recall', 'start_watch', 'wait_events', 'stop_watch', 'loop_start', 'loop_read', 'loop_stop', 'loop_state_start', 'loop_state_read', 'loop_state_stop', 'list_tabs', 'open_url', 'activate_tab', 'navigate_tab', 'close_tab',
    'read_page', 'capture_page', 'find_elements', 'click_element', 'fill_element', 'press_key', 'scroll_page',
    'move_pointer', 'click_at', 'drag_pointer', 'wheel_at',
    'media_state', 'media_play', 'media_pause', 'media_seek',
    'media_stream_start', 'media_stream_stop', 'media_listen_read'
  ]);
  assert.equal(new Set(tools).size, tools.length);
  assert.doesNotMatch(source, /registerTool\("(?:run_command|execute_command|raw_command)"/);
});

test('R4 keeps the protocol inventory frozen at 28 allowlisted primitives for release 1.6.24', () => {
  assert.equal(PRODUCT_VERSION, '1.6.24');
  assert.equal(ALLOWED_METHODS.length, 28);
  assert.deepEqual([...ALLOWED_METHODS].sort(), FROZEN_METHODS);
});

test('R4 keeps the public MCP tool inventory frozen at 39 tools (skill_save/skill_recall added: task lessons save to and recall from the shared skill memory)', async () => {
  const registered = [...source.matchAll(/server\.registerTool\("([a-z_]+)"/g)].map((match) => match[1]);
  assert.equal(registered.length, 39);
  assert.deepEqual([...registered].sort(), [...FROZEN_MCP_TOOLS, 'start_watch', 'stop_watch', 'wait_events', 'loop_start', 'loop_read', 'loop_stop', 'loop_state_start', 'loop_state_read', 'loop_state_stop'].sort());
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
  assert.equal(registered.length, 39);
  assert.deepEqual(registered, contract.tools);
  assert.equal(contract.toolCount, 39);
});

test('no generic escape hatch was introduced', () => {
  assert.doesNotMatch(source, /registerTool\("(?:run_command|execute_command|raw_command)"/);
});

test('an empty allowlist admits nobody, because every caller drives the same device', () => {

  const authenticate = source.match(/async function authenticate\([\s\S]*?\n}\n/)[0];
  assert.match(authenticate, /if \(ALLOWED_USER_IDS\.size === 0 && ALLOWED_USER_EMAILS\.size === 0\) return null;/);
  assert.doesNotMatch(authenticate, /unrestricted/);
  assert.match(authenticate, /!ALLOWED_USER_IDS\.has\(data\.user\.id\) && !ALLOWED_USER_EMAILS\.has\(email\)\) return null/);
});

test('resolveDeviceName never hands out a device the caller does not own', () => {

  const fn = source.match(/async function resolveDeviceName\([\s\S]*?\n}\n/)[0];
  assert.doesNotMatch(fn, /return deviceFromHeader/);
  assert.match(fn, /return null/);
  assert.match(source, /if \(!deviceName\) return unauthorized\(req\);/);
});

test('wait_events exposes only the caller-owned device events', () => {

  const handler = toolBlock('wait_events').slice(toolBlock('wait_events').indexOf('}, ({'));
  assert.match(handler, /event\.device_name === deviceName/);
});

test('wait_events preserves a falsy RPC envelope instead of forcing ok:true', () => {

  const handler = toolBlock('wait_events').slice(toolBlock('wait_events').indexOf('}, ({'));
  assert.match(handler, /ok === false/);
  assert.doesNotMatch(handler, /ok: true, events: rows/);
});

test('each command is stamped with its harness provider, never used for access', () => {

  assert.match(source, /x-opera-provider/);
  assert.match(source, /async function resolveProvider\(req: Request, auth\?: AuthContext \| null\): Promise<string>/);
  assert.match(source, /\[\/chatgpt\|openai-connector\|oai-mcp\/i, "chatgpt"\]/);
  assert.match(source, /\[\/opencode\/i, "opencode"\]/);
  assert.match(source, /return "unknown";/);
  assert.match(source, /const provider = await resolveProvider\(req, authContext\);/);
  assert.match(source, /createServer\(deviceName, provider, caller\)/);
  assert.match(source, /await supabase\.from\("opera_commands"\)\.update\(\{ provider \}\)/);
  assert.match(source, /await supabase\.from\("opera_workflow_runs"\)\.update\(\{ provider \}\)/);
  assert.match(source, /opera_client_name/);
  assert.match(source, /slugifyProvider/);
});

test('listening tools route commands and read transcripts owner-scoped', () => {

  assert.match(source, /execute\("media\.stream_start"/);
  assert.match(source, /execute\("media\.stream_stop"/);
  assert.match(source, /That session belongs to another device\./);
  assert.match(source, /opera_listen_segments/);
  assert.match(source, /Transcript text travels only in this tool result, never on the dashboard\./);
});

test('advertised media capabilities are invocable tools, not just status text', () => {

  for (const [tool, method] of [['media_state', 'media.state'], ['media_play', 'media.play'], ['media_pause', 'media.pause'], ['media_seek', 'media.seek']]) {
    assert.match(source, new RegExp(`server\\.registerTool\\("${tool}"`));
    assert.match(source, new RegExp(`execute\\("${method.replace('.', '\\.')}"`));
  }
  assert.match(source, /seconds: z\.number\(\)\.min\(0\)/, 'seek takes a position in seconds');
});

test('the OAuth client name resolves the provider when headers cannot', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261007090000_opera_client_name.sql', import.meta.url), 'utf8');

  assert.match(sql, /select client_name into v_name from auth\.oauth_clients where id = p_client_id/);
  assert.match(sql, /revoke execute on function public\.opera_client_name\(uuid\) from public, anon/);
});

test('the frozen schema map matches the live file, and records the one authorized change', () => {
  const blocks = toolBlocks();
  assert.equal(blocks.length, 39, 'the public tool count grows only by reviewed decision (skill_save/skill_recall added)');
  const actual = {};
  for (const block of blocks) actual[block.name] = schemaDigest(block.schema);

  assert.deepEqual(actual, FROZEN_TOOL_SCHEMAS);

  assert.notEqual(FROZEN_TOOL_SCHEMAS[R9B_CHANGED_TOOL], PRE_R9B_PRESS_KEY_DIGEST);
  assert.ok(FROZEN_TOOL_SCHEMAS[R9E_CHANGED_TOOL]);
});

test('the shared burst step schema is pinned by its step set, not only by digest', () => {

  const steps = [...source.matchAll(/action: z\.literal\("([a-z]+)"\)/g)].map((m) => m[1]);

  assert.deepEqual(steps, [
    'read', 'find', 'click', 'fill', 'key', 'scroll', 'hover', 'wait', 'pointer', 'navigate'
  ]);

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

  for (const key of ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft',
    'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Space', 'Backspace', 'Delete']) {
    assert.ok(declared.includes(key), `${key} must stay allowlisted`);
  }

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

  const enumBody = source.match(/const navigationKeySchema = z\.enum\(\[([\s\S]*?)\]\)/)[1];
  for (const spread of ['...lowercaseLetters', '...uppercaseLetters', '...digits']) {
    assert.ok(enumBody.includes(spread), `${spread} must be part of the key enum`);
  }

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

  assert.doesNotMatch(instructions, /are not available on this surface yet/);

  assert.match(instructions, /key \\"a\\" and modifiers \[\\"control\\"\] to select all/);
  assert.match(instructions, /key \\"v\\" and modifiers \[\\"control\\"\] to paste/);
  assert.match(instructions, /key \\"Delete\\" to clear that selection/);

  assert.match(instructions, /The same rule applies to MENUS and DIALOGS/);
  assert.match(instructions, /use a hover burst step with the found ref via refFromStep/);
  assert.match(instructions, /chain the levels in a single burst/);
});

test('the instructions warn that typed text does not replace a selection, which was measured not assumed', () => {
  const instructions = source.match(/instructions: "([\s\S]*?)",\n/)[1];

  assert.match(instructions, /does NOT replace an active selection/,
    'the guidance must state the behaviour, not imply that select-all then typing overwrites');
  assert.match(instructions, /appends instead of overwriting/,
    'the consequence must be named, because the failure is silent');
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

test('the MCP command path waits on the adaptive ramp, not the flat 50ms', () => {
  assert.match(source, /"opera_await_adaptive"/);
  assert.doesNotMatch(source, /"opera_await"/);
});

test('page.capture still uses opera_await_capture, which rewrites the screenshot', () => {

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

  for (const body of [flat, adaptive]) {
    assert.match(body, /'AWAIT_TIMEOUT','message','Timed out waiting for command result\.'/);
  }

  assert.match(flat, /pg_sleep\(0\.05\)/);
  assert.match(adaptive, /pg_sleep\(case when v_polls<=4 then 0\.005/);
});

test('wait_events honours the timeoutMs its schema declares', () => {
  const block = toolBlock('wait_events');
  assert.match(block, /timeoutMs\s*:\s*timeoutSchema/);

  const handler = block.slice(block.indexOf('}, ({'));
  assert.match(handler, /\{[^}]*\btimeoutMs\b[^}]*\}/, 'the handler must receive timeoutMs');
  assert.match(handler, /p_timeout_ms:[\s\S]*?timeoutMs\s*\?\?\s*waitMs/);
});

test('timeoutMs takes precedence over the legacy waitMs alias', () => {
  const handler = toolBlock('wait_events').slice(toolBlock('wait_events').indexOf('}, ({'));

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
    /Coordinate actions default to background CDP input and draw a visible cursor marker/,
    /Never use activate_tab as an implicit recovery step/
  ]) {
    assert.match(text, fragment, `instructions must still contain ${fragment}`);
  }
});

test('MCP requires bearer auth and never exposes the service role key', () => {
  assert.match(source, /const authContext = await authenticate\(req\);\n  if \(!authContext\) return unauthorized\(req\)/);
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
    'media.state', 'media.play', 'media.pause', 'media.seek',
    'watch.start', 'watch.stop', 'watch.stop_all', 'watch.list',
    'loop.start', 'loop.read', 'loop.stop'
  ]);
  assert.ok(methods.length >= 16);
  for (const method of methods) assert.ok(allowed.has(method), `unexpected method ${method}`);
});

test('MCP instructions make browser usage discoverable without mentioning Supabase', () => {
  assert.match(source, /Use Opera Agent whenever the user asks to open, navigate, inspect, click, type, scroll, visually inspect/);
  assert.match(source, /open_url defaults to an inactive tab, retain its returned tabId/);
  assert.match(source, /Never substitute the user's active tab during a multi-step task/);
  assert.match(source, /Never use activate_tab as an implicit recovery step/);
  assert.match(source, /Coordinate actions default to background CDP input and draw a visible cursor marker/);
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

  assert.match(source, /A visible cursor marker is drawn in both modes/);
  assert.match(source, /coordinate steps draw a visible cursor marker/);
  assert.doesNotMatch(source, /Background mode is invisible/);
  assert.doesNotMatch(source, /default to invisible background CDP input/);
});

test('MCP preserves structured command failures for foreground permission handling', () => {

  assert.match(source, /import \{ CommandFailure, sealVmProgram \} from "\.\.\/_shared\/seal-vm-program\.js"/);
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

  assert.match(consentSource, /\/oauth\/authorizations\/\$\{encodeURIComponent\(authorizationId\)\}/);
  assert.match(consentSource, /\/oauth\/authorizations\/\$\{encodeURIComponent\(authorizationId\)\}\/consent/);
  assert.match(consentSource, /JSON\.stringify\(\{ action \}\)/);
  assert.doesNotMatch(consentSource, /service_role|OPERA_AGENT_MCP_TOKEN|eyJhbGci/);
  assert.doesNotMatch(consentSource, /type="password"/i, 'the screen asks for no password of ours');
  assert.ok(siteVercelConfig.headers.some((entry) => entry.source === '/oauth/consent'), 'and the site serves it under the policy that permits only Supabase');
  const policy = siteVercelConfig.headers.find((entry) => entry.source === '/oauth/consent').headers.find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(policy, /connect-src https:\/\/\*\.supabase\.co/, 'the consent page reaches Supabase and nothing else');
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

test('the whole-file digest fixture is re-frozen to the live file', () => {
  assert.equal(sha256CanonicalLf(source), contract.sourceSha256);
});

