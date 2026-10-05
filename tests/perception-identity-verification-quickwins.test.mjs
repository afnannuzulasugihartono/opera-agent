// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: perception-identity-verification-quickwins.test — Test..
// @state: Test..
// @dependencies: node:fs, node:test, strict.

import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

// Research quick-wins: unknown-outcome contract, viewport truth
// flags, label normalization, and agent guidance. Source-contract style: the
// runtime behavior for these paths is exercised by the controlled browser
// regression; these assertions lock the contract in source.

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const runner = read('../supabase/functions/opera-agent-runner/index.ts');
const mcp = read('../supabase/functions/opera-agent-mcp/index.ts');
const content = read('../extension/content.js');
const background = read('../extension/background.js');

test('V2: workflow runner reports statement timeouts as unknown outcome, not failure', () => {
  assert.match(runner, /AWAIT_OUTCOME_UNKNOWN/);
  assert.match(runner, /outcome: "unknown"/);
  assert.match(runner, /statement timeout/i);
  assert.match(runner, /Verify the page state before repeating the action/);
});

test('V2: MCP tool errors label statement timeouts as unknown outcome (V2 contract)', () => {
  assert.match(mcp, /AWAIT_OUTCOME_UNKNOWN/);
  assert.match(mcp, /outcome: "unknown"/);
  assert.match(mcp, /statement timeout/i);
  assert.match(mcp, /verify the page state before repeating the action/i);
});

test('I4: serialized elements expose viewport truth flags alongside the overlap test', () => {
  assert.match(content, /function viewportFlags\(el\)/);
  assert.match(content, /fullyInViewport: actionability\.fullyInViewport/);
  assert.match(content, /viewportClipped: actionability\.viewportClipped/);
  assert.match(content, /const fully = left >= 0 && top >= 0 && right <= innerWidth && bottom <= innerHeight/);
});

test('I4: model-facing labels strip private-use glyphs and visited-link suffixes', () => {
  assert.match(content, /normalizeObservableText/);
  assert.match(content, /\\uE000-\\uF8FF/);
  assert.match(content, /visited link/);
  const uses = content.match(/normalizeObservableText\(/g) || [];
  assert.ok(uses.length >= 5, 'normalization must cover text, label, name, and placeholder fields');
});

test('G1: MCP guidance covers visual surfaces, Docs-like fallbacks, Maps viewport scope, and verification', () => {
  assert.match(mcp, /canvas, editors, games, or remote screens expose little or no DOM/);
  assert.match(mcp, /use capture_page and reason from the screenshot/);
  assert.match(mcp, /target an ancestor clickable element or capture the page/);
  assert.match(mcp, /Maps search results are viewport-scoped/);
  assert.match(mcp, /verify the page state before repeating the action/);
});

test('V3: a loop-top burst timeout preserves completed steps as an unknown outcome', () => {
  assert.match(background, /timedOut: true/);
  assert.match(background, /BURST_TIMEOUT/);
  assert.match(background, /completed steps may have taken effect/);
  // The partial return must sit at the loop-top deadline check (before the
  // step executes), keeping the successful prefix in `results`.
  assert.match(background, /if \(remainingMs < 50\) \{\s*\n\s*return \{[^}]*?timedOut: true/s);
});
