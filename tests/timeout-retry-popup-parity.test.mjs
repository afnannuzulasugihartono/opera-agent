// @last-edited: 2026-10-10 UTC+7.
// @title: timeout-retry-popup-parity.test — Test..
// @state: Test..
// @dependencies: node:test, strict, popup-events, protocol, extension-source.

import test from 'node:test';
import assert from 'node:assert/strict';
import { recordPopup, popupsSince, resolvePopupOpener } from '../extension/lib/popup-events.js';
import { PRODUCT_VERSION } from '../extension/lib/protocol.js';
import { extensionSource } from './helpers/extension-source.mjs';

test('popup event log records opener-tab creations', () => {
  const log = new Map();
  recordPopup(log, { openerTabId: 7, id: 42, pendingUrl: 'https://oauth.example.com/auth' }, 1_000);
  recordPopup(log, { openerTabId: 7, id: 43, url: 'https://a.example.com' }, 2_000);
  const since = popupsSince(log, 7, 0);
  assert.deepEqual(since.map((e) => e.tabId), [42, 43]);
  assert.equal(since[0].url, 'https://oauth.example.com/auth');
});

test('popup event log is bounded per opener', () => {
  const log = new Map();
  for (let i = 0; i < 12; i += 1) recordPopup(log, { openerTabId: 3, id: i, url: `u${i}` }, i * 10);
  const list = popupsSince(log, 3, 0);
  assert.equal(list.length, 8);
  assert.equal(list[0].url, 'u4');
});

test('popupsSince filters by timestamp', () => {
  const log = new Map();
  recordPopup(log, { openerTabId: 5, id: 1, url: 'old' }, 1_000);
  recordPopup(log, { openerTabId: 5, id: 2, url: 'new' }, 5_000);
  assert.deepEqual(popupsSince(log, 5, 2_000).map((e) => e.url), ['new']);
  assert.deepEqual(popupsSince(log, 5, 6_000), []);
});

test('popup attribution claims background-tab popups for the acted-on tab', () => {
  assert.equal(resolvePopupOpener(42, { openerTabId: 7 }), 42, 'in-flight action tab wins over Chromium misattribution');
  assert.equal(resolvePopupOpener(null, { openerTabId: 7 }), 7, 'no in-flight action falls back to real openerTabId');
  assert.equal(resolvePopupOpener(null, { openerTabId: undefined }), null, 'unrelated tabs are not recorded');
});

import fs from 'node:fs';
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('command timeout carries outcome:"unknown" instead of a plain failure', async () => {
  const src = await extensionSource();
  assert.match(src, /COMMAND_TIMEOUT/, 'timeout rejection must be coded COMMAND_TIMEOUT');
  assert.match(src, /outcome: 'unknown'/, 'timeout must report outcome unknown (parity with BURST_TIMEOUT family)');
  assert.match(src, /Verify page state before repeating/, 'timeout message must demand verify-before-repeating');
});

test('expect verification polls until verified inside a bounded window', () => {
  const src = read('extension/content.js');
  assert.match(src, /waitForExpectVerification/, 'expect polling loop must exist');
  assert.match(src, /EXPECT_VERIFY_WINDOW_MS/, 'window must be a named bounded constant');
  assert.match(src, /!\s*verification\.verified &&/, 'loop must exit early on verified');
});

test('page.fill gains retry/expect parity with page.click', async () => {
  const src = read('extension/content.js');
  const fillStart = src.indexOf('async function fill(');
  assert.ok(fillStart >= 0, 'synthetic fill must exist');
  const fillBlock = src.slice(fillStart, src.indexOf('\n  function fillInfo'));
  assert.match(fillBlock, /args\.retry\?\.attempts/, 'fill must honor retry.attempts');
  assert.match(fillBlock, /postActionEvidence\(/, 'fill must verify through postActionEvidence');
  const bg = await extensionSource();
  assert.match(bg, /fillOptions/, 'page.fill dispatch must read expect/attempts options');
  assert.match(bg, /method === 'page\.click' \|\| method === 'page\.fill'/, 'resolved verified telemetry must cover fill');
  assert.match(bg, /withActionPopupTracking\(tabId, \(\) => runActionPipeline\(tabId, 'page\.click'/, 'page.click dispatch must claim tabs opened while the action is in flight');
  assert.match(bg, /withActionPopupTracking\(tabId, \(\) => runActionPipeline\(tabId, 'page\.fill'/, 'page.fill dispatch must claim tabs opened while the action is in flight');
});

test('trustedFill evaluates post-action expectations', async () => {
  const bg = await extensionSource();
  const fillStart = bg.indexOf('async function trustedFill');
  const fillBlock = bg.slice(fillStart, bg.indexOf('\nasync function trustedPointer'));
  assert.match(fillBlock, /page\.post_action/, 'trusted fill must run the post-action check');
  assert.match(fillBlock, /expect: options\.expect/, 'trusted fill must pass the expect spec');
});

test('MCP maps AWAIT_TIMEOUT to the unknown-outcome envelope', () => {
  const src = read('supabase/functions/opera-agent-mcp/index.ts');
  assert.match(src, /AWAIT_TIMEOUT/, 'await deadline signal must be recognized');
  const branch = src.slice(src.indexOf('if (code === "AWAIT_TIMEOUT"'));
  assert.ok(branch.length > 0, 'AWAIT_TIMEOUT branch must exist');
  assert.match(branch, /AWAIT_OUTCOME_UNKNOWN/, 'AWAIT_TIMEOUT must map to the unknown-outcome envelope');
  assert.match(branch, /outcome: "unknown"/, 'unknown outcome must be reported');
});

test('MCP instructions cover OAuth popups and openedTabs follow-through', () => {
  const src = read('supabase/functions/opera-agent-mcp/index.ts');
  const instructions = src.slice(src.indexOf('instructions: "'));
  assert.match(instructions, /openedTabs/, 'guidance must name the openedTabs action result');
  assert.match(instructions, /OAuth|SSO/, 'guidance must cover OAuth/login flows');
  assert.match(instructions, /expect/, 'guidance must mention expect-based verification');
});

test('U-R line ships as release 1.6.27', () => {
  assert.equal(PRODUCT_VERSION, '1.6.27');
});
