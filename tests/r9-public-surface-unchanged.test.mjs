// R9 public-surface freeze (2026-09-30).
//
// The R9 keyboard work deliberately shipped as a runtime-only change so the
// public MCP contract stayed byte-for-byte frozen. That claim is only worth
// anything if it is VERIFIED, and the existing whole-file digest cannot prove
// it: any edit at all changes that hash, including an instructions-only edit.
//
// This test pins each tool's inputSchema block individually, so an
// instructions-only change is provably not a schema change, and a schema change
// cannot be slipped in under cover of a documentation commit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const source = await readFile(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');

// Frozen per-tool inputSchema digests, captured before the R9 instructions-only
// edit. Any change to any public input schema must fail here first, where the
// failure is specific, instead of surfacing as an opaque whole-file hash.
const FROZEN_TOOL_SCHEMAS = Object.freeze({
  browser_status: 'e2e1c444ec75f62f',
  run_browser_burst: 'a195bbb8a3566db7',
  run_workflow: '352a3d543e9786b0',
  start_watch: '411495a345c1446c',
  wait_events: '94d5f8173df971fa',
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
  press_key: '41a4003cadb60196',
  scroll_page: '964567b192825f66',
  move_pointer: 'b8adb741ad19103a',
  click_at: 'c50c98d5f209134b',
  drag_pointer: '52474fc5dc262439',
  wheel_at: '5b9c6fed7bbce95a'
});

function toolBlocks() {
  const starts = [...source.matchAll(/server\.registerTool\("([a-z_]+)"/g)];
  return starts.map((match, index) => {
    const from = source.indexOf('inputSchema:', match.index);
    const end = index + 1 < starts.length ? starts[index + 1].index : source.length;
    return { name: match[1], schema: source.slice(from, end) };
  });
}

test('every public MCP input schema is byte-for-byte unchanged by the R9 instructions commit', () => {
  const blocks = toolBlocks();
  assert.equal(blocks.length, 22);
  const actual = {};
  for (const block of blocks) {
    actual[block.name] = createHash('sha256')
      .update(block.schema.replace(/\r\n/g, '\n'))
      .digest('hex')
      .slice(0, 16);
  }
  assert.deepEqual(actual, FROZEN_TOOL_SCHEMAS);
});

test('the keyboard surface is still the 12 unmodified keys, so no chord can be promised yet', () => {
  // The runtime supports modifier chords and bounded text (R9-B), but the
  // public schema deliberately does not expose them. If this ever changes, the
  // instructions must change with it, and both changes need review.
  const pressKey = toolBlocks().find((block) => block.name === 'press_key').schema;
  assert.match(pressKey, /key: navigationKeySchema/);
  assert.doesNotMatch(pressKey, /modifiers/);
  assert.doesNotMatch(pressKey, /text:/);

  const navigationKeys = source.match(/const navigationKeySchema = z\.enum\(\[(.*?)\]\)/s)[1];
  const declared = navigationKeys.split(',').map((entry) => entry.trim().replace(/^"|"$/g, ''));
  assert.deepEqual(declared, [
    'Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown', 'Space'
  ]);

  const burstKeyStep = source.match(/z\.object\(\{ action: z\.literal\("key"\)[^}]*\}\)\.strict\(\)/)?.[0] ?? '';
  assert.ok(burstKeyStep, 'the burst key step must exist');
  assert.doesNotMatch(burstKeyStep, /modifiers/);
  assert.doesNotMatch(burstKeyStep, /text/);
});

test('the instructions now teach menu and dialog refFromStep batching', () => {
  assert.match(source, /The same rule applies to MENUS and DIALOGS, which re-render their own DOM every time they open/);
  assert.match(source, /click it by refFromStep inside one burst/);
  assert.match(source, /chain one find\/click per level inside a single burst/);
  // The pre-existing dynamic-UI guidance must survive the extension.
  assert.match(source, /For dynamic or fast-changing UIs \(video players, ad overlays, countdown controls\)/);
});

test('the instructions do not advertise chords the frozen schema would reject', () => {
  // Accuracy matters more than ambition here: promising Ctrl+A or text entry
  // while press_key still validates against a 12-key enum would make the model
  // emit calls the schema rejects.
  const instructions = source.match(/instructions: "([\s\S]*?)",\n/)[1];
  assert.doesNotMatch(instructions, /Ctrl\+A|Ctrl\+V|modifiers:\s*\[/);
  assert.match(instructions, /control chords such as select-all and paste are not available on this surface yet/);
});
