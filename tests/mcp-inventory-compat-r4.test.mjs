import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_METHODS, PRODUCT_VERSION } from '../extension/lib/protocol.js';

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

test('R4 keeps the protocol inventory frozen at 26 allowlisted primitives for release 1.6.7', () => {
  assert.equal(PRODUCT_VERSION, '1.6.7');
  assert.equal(ALLOWED_METHODS.length, 26);
  assert.deepEqual([...ALLOWED_METHODS].sort(), FROZEN_METHODS);
});

test('R4 keeps the public MCP tool inventory frozen at 22 tools (U-T rebaseline: watch tools added)', async () => {
  const source = await readFile(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');
  const registered = [...source.matchAll(/server\.registerTool\("([a-z_]+)"/g)].map((match) => match[1]);
  assert.equal(registered.length, 22); // U-T rebaseline: watch tools added
  assert.deepEqual([...registered].sort(), [...FROZEN_MCP_TOOLS, 'start_watch', 'stop_watch', 'wait_events'].sort());
});

test('R4 keeps the read_page input schema frozen with no view parameter', async () => {
  const source = await readFile(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');
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
