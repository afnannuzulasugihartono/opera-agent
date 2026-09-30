// R9 public-surface freeze (2026-09-30).
//
// This test pins each tool's inputSchema block individually. The whole-file
// digest in mcp-contract-v1.json cannot distinguish an instructions edit from a
// schema edit, so this is the layer that makes a public-surface change legible:
// a schema change must fail here first, where the failure names the tool, and
// it must be accompanied by the matching instructions change in the same commit.
//
// R9-G (instructions only) moved the digests below. R9-B then authorized the
// keyboard surface: press_key and the burst key step gained optional
// `modifiers` and `text`, which is what finally makes the R9-B runtime
// capability reachable from a public tool.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const source = await readFile(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');

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
  press_key: '7f46f878a52172bb',
  scroll_page: '964567b192825f66',
  move_pointer: 'b8adb741ad19103a',
  click_at: 'c50c98d5f209134b',
  drag_pointer: '52474fc5dc262439',
  wheel_at: '5b9c6fed7bbce95a'
});

// The only tool whose schema the R9-B keyboard commit changed. Everything else
// must stay byte-identical, so an unrelated schema edit cannot ride along.
const R9B_CHANGED_TOOL = 'press_key';
// The press_key digest before R9-B, kept so the record of the change is visible
// and a silent revert cannot be mistaken for "nothing ever changed".
const PRE_R9B_PRESS_KEY_DIGEST = '41a4003cadb60196';

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

test('the frozen schema map matches the live file, and records the one authorized change', () => {
  const blocks = toolBlocks();
  assert.equal(blocks.length, 22, 'the public tool count must not change');
  const actual = {};
  for (const block of blocks) actual[block.name] = schemaDigest(block.schema);
  // Every recorded digest must match the file, so a stale entry cannot mask a
  // later edit and an unauthorized edit cannot pass unnoticed.
  assert.deepEqual(actual, FROZEN_TOOL_SCHEMAS);
  // And the one tool that was authorized to change must be recorded as changed.
  assert.notEqual(FROZEN_TOOL_SCHEMAS[R9B_CHANGED_TOOL], PRE_R9B_PRESS_KEY_DIGEST);
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
  assert.match(instructions, /select all with key "a" and modifiers \["control"\]/);
  assert.match(instructions, /paste with key "v" and modifiers \["control"\]/);
  // The menu/dialog habit from R9-G must survive.
  assert.match(instructions, /The same rule applies to MENUS and DIALOGS/);
  assert.match(source, /chain one find\/click per level inside a single burst/);
});

test('the sensitive-field guard is still advertised for keyboard input', () => {
  const pressKey = toolBlocks().find((block) => block.name === 'press_key').schema;
  const tool = source.slice(source.indexOf('server.registerTool("press_key"'));
  assert.match(tool.slice(0, 1200), /refused on password, OTP, and payment fields/);
  assert.match(pressKey, /executionMode: executionModeSchema/);
});

