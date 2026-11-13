// @last-edited: 2026-11-09 UTC+7.
// @title: mcp-surface.test — the MCP surface the cloud advertises is the one the tools register.
// @state: the tool names, their count, their titles, what each one returns, their documented inputs, the consent page, and the digest of the source that holds them.
// @dependencies: node:test, strict, node:fs, promises, node:crypto, canonical-source-hash, protocol.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { sha256ContractSource } from '../helpers/canonical-source-hash.mjs';
import { ALLOWED_METHODS, PRODUCT_VERSION } from '../../extension/lib/protocol.js';
import { mcpSurfaceSource } from '../helpers/mcp-surface-source.mjs';
import { siteHeaders } from '../helpers/site-headers.mjs';

const configUrl = new URL('../../hosted/functions/opera-agent-mcp/deno.json', import.meta.url);
const authUrl = new URL('../../hosted/functions/opera-agent-mcp/../opera-agent-auth/index.ts', import.meta.url);
const consentUrl = new URL('../../landing/oauth/consent.html', import.meta.url);
const supabaseConfigUrl = new URL('../../hosted/config.toml', import.meta.url);

const source = await mcpSurfaceSource();
const config = JSON.parse(await readFile(configUrl, 'utf8'));
const authSource = await readFile(authUrl, 'utf8');
const consentSource = await readFile(consentUrl, 'utf8');
const siteHeadersFile = siteHeaders();
const supabaseConfig = await readFile(supabaseConfigUrl, 'utf8');
const contract = JSON.parse(
  fs.readFileSync(new URL('../fixtures/mcp-contract-v1.json', import.meta.url), 'utf8')
);
const core = fs.readFileSync(
  new URL('../../hosted/migrations/20260907204146_opera_agent_1_0_0_core.sql', import.meta.url),
  'utf8'
);
const etw = fs.readFileSync(
  new URL('../../hosted/migrations/20260922000000_opera_agent_ut_etw.sql', import.meta.url),
  'utf8'
);
const screenshot = fs.readFileSync(
  new URL('../../hosted/migrations/20260910121107_opera_agent_adaptive_screenshot.sql', import.meta.url),
  'utf8'
);

const FROZEN_MCP_TOOLS = [
  'activate_tab', 'browser_status', 'capture_page', 'click_element',
  'close_tab', 'fill_element', 'find_elements', 'list_tabs',
  'media_pause', 'media_play', 'media_seek', 'media_state',
  'navigate_tab', 'open_url', 'pointer', 'press_key', 'read_page', 'stream_keys',
  'run_adhoc', 'run_browser_burst', 'run_program', 'run_workflow', 'scroll_page', 'skill_recall', 'skill_save',
  'media_stream_start', 'media_stream_stop', 'media_listen_read',
  'check_update', 'apply_update', 'dump_page', 'save_page', 'record_start', 'record_stop', 'switch_device', 'search_bing'
];

const FROZEN_METHODS = [
  'browser.burst', 'browser.ping', 'extension.update', 'media.pause', 'media.play', 'media.seek',
  'media.state', 'media.stream_start', 'media.stream_stop', 'page.capture', 'page.click', 'page.collect_links',
  'page.dump',
  'page.fill', 'page.find', 'page.focus', 'page.key', 'page.pointer',
  'page.query', 'page.read', 'page.record_start', 'page.record_stop', 'page.scan', 'page.scroll', 'page.stream', 'page.wait_for',
  'statement.download', 'statement.manifest',
  'tabs.activate', 'tabs.close', 'tabs.find', 'tabs.get', 'tabs.list', 'tabs.navigate',
  'tabs.open', 'tabs.reload'
];

const FROZEN_READ_PAGE_PROPERTIES = [
  'all', 'class', 'includeElements', 'limit', 'maxElements', 'offset', 'tabId', 'timeoutMs', 'view'
];

const FROZEN_TOOL_SCHEMAS = Object.freeze({
  browser_status: '51fc361281e4aff7',
  check_update: '8108134269296267',
  apply_update: '2239e02e26fe25f6',
  run_browser_burst: 'ddfc9835ac4f4e9a',
  run_workflow: '09ce624d89ed95ba',
  run_program: '4220be7d53db3ab1',
  run_adhoc: '14bb44a13751b230',
  skill_save: '12779fcd8c0787db',
  skill_recall: '778eae1cc693e9a3',
  start_watch: '54e2f66cb2b202e6',
  wait_events: '5edbf05fabbb14c8',
  stop_watch: '1afb5c0e3ace0e78',
  list_tabs: '0ded59ff6c5f1b0c',
  open_url: '82c1021da3a1dc02',
  activate_tab: '6b33a62b8f071dd0',
  navigate_tab: 'e48d509464c7d5ab',
  close_tab: '7e963cf5ec747863',
  read_page: '362cc7ec8aaf20c7',
  capture_page: '3e263f2f10804cc6',
  find_elements: 'f6eb0d7b9da2c372',
  click_element: 'e4293043033ea470',
  fill_element: '0e866354339eec8b',
  press_key: 'e4b0dcdca29f6450',
  stream_keys: 'b7a9ea7790c77159',
  scroll_page: '11fa6036c82606fd',
  pointer: '836f2c29cfa5b6f4',
  media_state: 'dd36328bc7f5eaad',
  media_play: 'be8f1ff4460c156e',
  media_pause: '733cd49a0e0bea0a',
  media_seek: 'b5e27995716abd38',
  media_stream_start: '0c5fbfac4707448f',
  media_stream_stop: '5df002e4171733eb',
  media_listen_read: '9834f1ca13dbeae9',
  statement_manifest: 'c8e06f753d58ad98',
  statement_deliver: '7a4a87bc8e59884b',
  invoice_create: '06cfef1148eed4af',
  record_start: '067fb032b10b3f6f',
  record_stop: 'a5a690be3a1dd2e6',
  dump_page: '5833609063d2ffe7',
  save_page: '63e082d6d801f284',
  search_bing: 'aad02c9a8447a630',
  switch_device: '0c842fac613a8416',
});

const PLAN_DOOR_CHANGED_TOOL = 'invoice_create';

const PRE_PLAN_DOOR_INVOICE_CREATE_DIGEST = '17f9342a25c0c011';

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
    const end = index + 1 < starts.length
      ? starts[index + 1].index
      : source.indexOf('\n  });', match.index) + '\n  });'.length;
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
    'browser_status', 'check_update', 'apply_update', 'run_browser_burst', 'run_workflow', 'run_program', 'run_adhoc', 'skill_save', 'skill_recall', 'start_watch',
    'wait_events', 'stop_watch', 'list_tabs', 'open_url', 'activate_tab', 'navigate_tab', 'close_tab',
    'read_page', 'capture_page', 'record_start', 'record_stop', 'dump_page', 'save_page', 'search_bing', 'find_elements', 'click_element', 'fill_element', 'press_key', 'stream_keys', 'scroll_page',
    'pointer',
    'media_state', 'media_play', 'media_pause', 'media_seek',
    'media_stream_start', 'media_stream_stop', 'media_listen_read',
    'statement_deliver', 'statement_manifest', 'invoice_create', 'switch_device'
  ]);
  assert.equal(new Set(tools).size, tools.length);
  assert.doesNotMatch(source, /registerTool\("(?:run_command|execute_command|raw_command)"/);
});

test('R4 keeps the protocol inventory frozen at 36 allowlisted primitives - page.stream, statement and extension.update added, then the armed recorder and the scan', () => {
  assert.equal(PRODUCT_VERSION, '1.6.50');
  assert.equal(ALLOWED_METHODS.length, 36);
  assert.deepEqual([...ALLOWED_METHODS].sort(), FROZEN_METHODS);
});

test('R20 merges read_page_map into read_page view=map, so the public MCP tool inventory is 42 tools', async () => {
  const registered = [...source.matchAll(/server\.registerTool\("([a-z_]+)"/g)].map((match) => match[1]);
  assert.equal(registered.length, 42);
  assert.deepEqual([...registered].sort(), [...FROZEN_MCP_TOOLS, 'start_watch', 'stop_watch', 'wait_events', 'statement_deliver', 'statement_manifest', 'invoice_create'].sort());
});

test('R20 merges the map into read_page view=map; the schema carries the full map surface', async () => {
  const start = source.indexOf('server.registerTool("read_page"');
  assert.ok(start >= 0, 'read_page tool must remain registered');
  const end = source.indexOf('server.registerTool(', start + 1);
  const block = source.slice(start, end < 0 ? undefined : end);
  const schemaStart = block.indexOf('inputSchema: {');
  const schemaEnd = block.indexOf('annotations:');
  assert.ok(schemaStart >= 0 && schemaEnd > schemaStart, 'read_page input schema block must be present');
  const schema = block.slice(schemaStart, schemaEnd);
  const properties = [...schema.matchAll(/(\w+):\s*(?:z\.|tabIdSchema|timeoutSchema)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(properties)].sort(), FROZEN_READ_PAGE_PROPERTIES);
  assert.match(schema, /view:/);
  assert.match(source, /executeMap\(\{ tabId/);
});

test('the status tool names the worker faults it answers', () => {
  assert.match(source, /registerTool\("browser_status", \{[\s\S]{0,900}?errorCount/, 'the description says what the fault fields are');
});

test('the status tool says whether the extension is there at all', () => {
  assert.match(source, /registerTool\("browser_status", \{[\s\S]{0,900}?extensionPresent/, 'the description says how to tell an installed extension from an absent one');
  assert.match(source, /deviceStatus/, 'and the device state is named');
  assert.match(source, /latestExtensionVersion/, 'and the newest published version is named, so an extension Chrome has not installed yet is visible');
  assert.match(source, /extensionUpdatePending/, 'and the gap is stated as a fact');
});

test('browser_status answers its plan even when the command it carried failed', () => {
  const at = source.indexOf('async function executeStatus');
  assert.ok(at >= 0, 'executeStatus stays a named function');
  const end = source.indexOf('\nfunction ', at + 1);
  const body = source.slice(at, end < 0 ? undefined : end);
  assert.doesNotMatch(body, /if \(answer\.isError\) return answer;/, 'the plan is merged before the failure is returned');
  assert.match(body, /planInfo\(/, 'the plan is resolved on every path, success and failure alike');
  assert.match(body, /structuredContent \?\? \{\}\),\s*\.\.\.\(plan \?\? \{\}\)/, 'the failure path spreads the original structuredContent before adding the plan, so the failure taxonomy survives');
  assert.match(body, /part\.type === "text" \? \{ \.\.\.part, text: JSON\.stringify\(merged\) \} : part/, 'and the text part is re-serialized from the same merged object');
});

test('the tool count and names match the contract', () => {
  const registered = [...source.matchAll(/server\.registerTool\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.equal(registered.length, 42);
  assert.deepEqual(registered, contract.tools);
  assert.equal(contract.toolCount, 42);
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

// WHY THIS TEST MOVED AND NOT ITS INTENT.
// The pin used to be honored forever: one stale pairing blackholed every hosted command to AWAIT_OUTCOME_UNKNOWN behind a 401 that read as a broken credential.
// The contract is now: the pin decides while the browser heartbeats, ownership is always checked against the caller's user_id, a sleeping pin is a named 503 refusal that names the awake browsers instead of a silent switch to another browser, and no fresh browser at all is a named refusal too, never a 401 and never an invented name.

test('resolveDeviceFresh never hands out a device the caller does not own', () => {

  const fn = source.match(/async function resolveDeviceFresh\([\s\S]*?\n}\n/)[0];
  assert.doesNotMatch(fn, /return deviceFromHeader/);
  assert.match(fn, /\.eq\("user_id", auth\.userId\)/);
  assert.match(fn, /return resolveDevice\(\{ pin:/);
  assert.match(source, /if \(!resolution\.name\)/);
  assert.match(source, /function noLiveDevice\(req: Request\)/);
  assert.match(source, /function pinnedDeviceNotLive\(req: Request, resolution: DeviceResolution(, provider\?: string)?\)/);
  assert.match(source, /pinned_device_not_live/);
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
  assert.match(source, /createServer\(resolution\.name, provider, caller, resolution\)/);
  assert.match(source, /p_provider: provider \|\| null/);
  assert.doesNotMatch(source, /await supabase\.from\("opera_commands"\)\.update\(\{ provider \}\)/);
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
  const sql = fs.readFileSync(new URL('../../hosted/migrations/20261007090000_opera_client_name.sql', import.meta.url), 'utf8');

  assert.match(sql, /select client_name into v_name from auth\.oauth_clients where id = p_client_id/);
  assert.match(sql, /revoke execute on function public\.opera_client_name\(uuid\) from public, anon/);
});

// The readable-input change moved fifteen schemas: every inline field now carries its own description, the three tools that declared the transport envelope now declare the flat one, and the four tab and url fields now share one schema instead of repeating their own.
// The map records the digest each one moved from, so a reader can tell a reviewed change from a drift.

const READABLE_INPUTS_MOVED = Object.freeze({
  run_browser_burst: 'd948c904d171e8d3',
  start_watch: '6080c4ec1568b132',
  stop_watch: '5133e82aa7a83fb1',
  read_page: '7724641fbfc8270a',
  capture_page: '288795a580c4c54a',
  find_elements: '5ee494a2286bfe19',
  click_element: '524bbdcd910efb97',
  fill_element: '299f17ba1498cd96',
  stream_keys: '9487610ec1707601',
  scroll_page: '49c584144a526142',
  pointer: 'a07a0e1b5843bfb4',
  open_url: '9b68095958a8242f',
  activate_tab: '39a762c1732bee92',
  navigate_tab: '4947602daae152c1',
  close_tab: '7fba21a3f036f380'
});

test('the frozen schema map matches the live file, and records the changes it has approved', () => {
  const blocks = toolBlocks();
  assert.equal(blocks.length, 42, 'the public tool count changes only by reviewed decision (loop tools removed; check_update and apply_update joined; record_start, record_stop and switch_device joined; scan_page became save_page with dump_page beside it; search_bing joined, a workflow over the existing primitives)');
  const actual = {};
  for (const block of blocks) actual[block.name] = schemaDigest(block.schema);

  assert.deepEqual(actual, FROZEN_TOOL_SCHEMAS);

  for (const [name, digest] of Object.entries(READABLE_INPUTS_MOVED)) {
    assert.notEqual(FROZEN_TOOL_SCHEMAS[name], digest, name + ' must have moved from the digest the map recorded');
  }
  assert.deepEqual(
    Object.keys(FROZEN_TOOL_SCHEMAS).filter((name) => FROZEN_TOOL_SCHEMAS[name] === READABLE_INPUTS_MOVED[name]),
    [],
    'a recorded move must actually have moved'
  );

  assert.notEqual(FROZEN_TOOL_SCHEMAS[R9B_CHANGED_TOOL], PRE_R9B_PRESS_KEY_DIGEST);
  assert.ok(FROZEN_TOOL_SCHEMAS[R9E_CHANGED_TOOL]);
  assert.notEqual(FROZEN_TOOL_SCHEMAS[PLAN_DOOR_CHANGED_TOOL], PRE_PLAN_DOOR_INVOICE_CREATE_DIGEST);
});

test('the plan is billed through the same door as a delivery, so no operator path is left outside the tool', () => {
  const invoice = toolBlocks().find((block) => block.name === 'invoice_create').schema;
  assert.match(invoice, /plan: z\.enum\(\['plan\.pilot', 'plan\.firm'\]\)\.optional\(\)/,
    'the plan is one of the price-list kinds, so a plan nobody priced is refused rather than billed as zero');
  assert.match(source, /body: JSON\.stringify\(\{ action: "invoice", customer_id: customer, period, deliveries, \.\.\.\(plan \? \{ plan \} : \{\}\) \}\)/,
    'the tool forwards the plan to the one function that already prices it');
  assert.doesNotMatch(invoice, /amount_cents/,
    'the amount is still computed from the price list, never taken from the call');
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
    'page.read', 'page.capture', 'page.find', 'page.click', 'page.fill', 'page.key', 'page.scroll', 'page.pointer', 'page.stream', 'page.dump',
    'media.state', 'media.play', 'media.pause', 'media.seek',
    'watch.start', 'watch.stop', 'watch.stop_all', 'watch.list',
    'statement.download', 'statement.manifest', 'extension.update'
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
  assert.match(source, /For lazy result lists, call pointer with pointerAction wheel/);
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

  assert.match(source, /import \{ CommandFailure, sealVmProgram \} from "\.\.\/_shared\/seal-vm-program\.ts"/);
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
  assert.ok(siteHeadersFile.headers.some((entry) => entry.source === '/oauth/consent'), 'and the site serves it under the policy that permits only Supabase');
  const policy = siteHeadersFile.headers.find((entry) => entry.source === '/oauth/consent').headers.find((h) => h.key === 'Content-Security-Policy').value;
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
  assert.equal(sha256ContractSource(source), contract.sourceSha256);
});

test('every tool has a title and says what it returns', () => {
  const starts = [...source.matchAll(/server\.registerTool\("([a-z_]+)"/g)];
  assert.equal(starts.length, 42, 'the tool count changes only by reviewed decision');

  starts.forEach((match, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].index : source.length;
    const head = source.slice(match.index, end);
    assert.match(head, /\n\s*title: "[^"]+"/, match[1] + ' must carry a title');
    assert.match(head, /description: "[^"]*Returns: /, match[1] + ' must say what it returns');
  });
});

test('no output schema declares the transport envelope', () => {
  for (const block of toolBlocks()) {
    const at = block.schema.indexOf('outputSchema:');
    if (at < 0) continue;
    const declared = block.schema.slice(at, block.schema.indexOf('annotations:', at));
    for (const key of ['commandId', 'status', 'result', 'timing']) {
      assert.doesNotMatch(declared, new RegExp('\\b' + key + ':'), block.name + ' must not declare ' + key);
    }
  }
});

const SHARED_INPUT_SCHEMAS = Object.freeze([
  'tabIdSchema', 'timeoutSchema', 'burstTimeoutSchema', 'executionModeSchema',
  'navigationKeySchema', 'modifierSchema', 'workflowNameSchema', 'burstStepSchema'
]);

function objectBody(text, marker) {
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const open = text.indexOf('{', at + marker.length - 1);
  if (open < 0) return null;
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

function propertiesOf(body) {
  const properties = [];
  let depth = 0;
  let quote = null;
  let name = null;
  let valueStart = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{' || c === '[' || c === '(') { depth += 1; continue; }
    if (c === '}' || c === ']' || c === ')') { depth -= 1; continue; }
    if (c === ':' && depth === 0 && name === null) {
      name = body.slice(0, i).match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/)?.[1] ?? null;
      valueStart = i + 1;
      continue;
    }
    if (c === ',' && depth === 0 && name !== null) {
      properties.push({ name, value: body.slice(valueStart, i).trim() });
      name = null;
      valueStart = i + 1;
    }
  }
  if (name !== null) properties.push({ name, value: body.slice(valueStart).trim() });
  return properties;
}

function sharedDescribesItself(name) {
  const at = source.indexOf('const ' + name + ' =');
  if (at < 0) return false;
  const end = source.indexOf('\nconst ', at);
  return /\.describe\(/.test(source.slice(at, end < 0 ? at + 400 : end));
}

function undocumentedFields(body, path, problems) {
  for (const property of propertiesOf(body)) {
    const value = property.value;
    const shared = value.split(/[\s.(]/)[0];
    if (SHARED_INPUT_SCHEMAS.includes(shared)) {
      if (!sharedDescribesItself(shared) && !/\.describe\(/.test(value)) {
        problems.push(path + '.' + property.name + ' uses ' + shared + ' and says nothing about itself');
      }
      continue;
    }
    const nested = objectBody(value, 'z.object({');
    if (nested !== null) {
      undocumentedFields(nested, path + '.' + property.name, problems);
      continue;
    }
    if (!/\.describe\(/.test(value)) problems.push(path + '.' + property.name + ' must carry a description');
  }
}

test('every input field says what it is', () => {
  const problems = [];
  for (const block of toolBlocks()) {
    const at = block.schema.indexOf('inputSchema:');
    const body = objectBody(block.schema.slice(at), 'inputSchema:');
    if (body === null) continue;
    undocumentedFields(body, block.name, problems);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});
