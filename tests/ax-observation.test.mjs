// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: ax-observation.test — Test..
// @state: Test..
// @dependencies: node:fs, node:test, strict, ax-summary.

import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAxSummary, AX_SUMMARY_LIMITS } from '../extension/lib/ax-summary.js';

// The observation path gains (A) an always-on pure-DOM accessibility layer in
// content.js (shadow-piercing collection + computed accessible names) and (B) a
// poverty-triggered CDP accessibility-tree snapshot attached to page.read results
// as a read-only axSummary. The pure filter below is exercised against
// probe-recorded CDP Accessibility.getFullAXTree node shapes (full probe evidence
// is the probe record inside this file).

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const content = read('../extension/content.js');
const background = read('../extension/background.js');
const mcp = read('../supabase/functions/opera-agent-mcp/index.ts');

function axNode(partial = {}) {
  return {
    nodeId: partial.nodeId ?? '1',
    backendDOMNodeId: partial.backendDOMNodeId ?? 1,
    ignored: partial.ignored ?? false,
    parentId: partial.parentId ?? undefined,
    role: { type: 'role', value: partial.role ?? 'generic' },
    name: { type: 'computedString', value: partial.name ?? '' },
    ...(partial.value ? { value: { type: 'computedString', value: partial.value } } : {}),
    ...(partial.properties ? { properties: partial.properties } : {})
  };
}

// Probe-derived tree: canvas application + visually-hidden mirror text +
// icon-only toolbar + an editable field whose VALUE must never surface.

function probeTree() {
  return [
    axNode({ nodeId: '1', role: 'RootWebArea', name: 'AX probe' }),
    axNode({ nodeId: '2', role: 'none', ignored: true, name: '' }),
    axNode({ nodeId: '6', role: 'button', name: 'Save document' }),
    axNode({ nodeId: '7', role: 'toolbar', name: 'Drawing tools' }),
    axNode({ nodeId: '8', role: 'button', name: 'Select tool', parentId: '7' }),
    axNode({ nodeId: '9', role: 'generic', name: '' }),
    axNode({ nodeId: '14', role: 'application', name: 'Figma board' }),

    // Visually-hidden (clip trick) mirror text: the canvas-app reading path.
    axNode({ nodeId: '16', role: 'StaticText', name: 'Canvas layer Cat uploaded', parentId: '9' }),

    // Editable field: role, name, and VALUE all present in CDP output.
    axNode({ nodeId: '10', role: 'textbox', name: 'Search box', value: 'typed secret text' }),

    // StaticText descendants of the editable node repeat the VALUE as text.
    axNode({ nodeId: '17', role: 'StaticText', name: 'typed secret text', parentId: '10' }),
    axNode({ nodeId: '12', role: 'textbox', name: 'Password', value: '••••••••' }),
    axNode({ nodeId: '18', role: 'StaticText', name: '••••••••', parentId: '12' }),

    // InlineTextBox pseudo-nodes have no backendDOMNodeId and duplicate text.
    axNode({ nodeId: '-1000000002', role: 'InlineTextBox', name: 'Canvas ', backendDOMNodeId: undefined }),
    axNode({ nodeId: '15', role: 'StaticText', name: 'X', parentId: '6' })
  ];
}

test('buildAxSummary keeps named nodes including hidden-mirror StaticText', () => {
  const summary = buildAxSummary(probeTree());
  assert.equal(summary.source, 'cdp-ax');
  const names = summary.items.map((item) => item.name);
  assert.ok(names.includes('Save document'), names);
  assert.ok(names.includes('Drawing tools'), names);
  assert.ok(names.includes('Select tool'), names);
  assert.ok(names.includes('Figma board'), names);
  assert.ok(names.includes('Canvas layer Cat uploaded'), names);
  assert.ok(!names.includes('AX probe'), 'RootWebArea (page title) must be skipped');
});

test('buildAxSummary never surfaces editable values in any form', () => {
  const summary = buildAxSummary(probeTree());
  const serialized = JSON.stringify(summary);
  assert.ok(!serialized.includes('typed secret text'), serialized);
  assert.ok(!serialized.includes('Search box'), 'editable fields are excluded entirely');
  assert.ok(!serialized.includes('Password'), 'password fields are excluded entirely');
  assert.ok(!serialized.includes('•'), 'masked password content must not appear');
});

test('buildAxSummary drops ignored nodes and InlineTextBox pseudo-nodes', () => {
  const summary = buildAxSummary(probeTree());
  const roles = summary.items.map((item) => item.role);
  assert.ok(!roles.includes('InlineTextBox'), roles);
  assert.ok(!summary.items.some((item) => item.name === ''), 'empty names are dropped');
});

test('buildAxSummary items carry exactly role and name, never internals', () => {
  const summary = buildAxSummary(probeTree());
  for (const item of summary.items) {
    assert.deepEqual(Object.keys(item).sort(), ['name', 'role']);
    assert.equal(typeof item.role, 'string');
    assert.equal(typeof item.name, 'string');
    assert.ok(item.name.length > 0);
  }
});

test('buildAxSummary dedupes repeated entries and caps the list', () => {
  const repeated = Array.from({ length: 80 }, (_, index) =>
    axNode({ nodeId: `n${index}`, role: 'StaticText', name: `Item ${index % 5}` })
  );
  const summary = buildAxSummary(repeated);
  assert.ok(summary.items.length <= AX_SUMMARY_LIMITS.maxEntries, summary.items.length);
  const seen = new Set(summary.items.map((item) => `${item.role}|${item.name}`));
  assert.equal(seen.size, summary.items.length, 'no duplicate role+name pairs');
  assert.ok(seen.size <= 5, seen);
});

test('buildAxSummary truncates long names and returns empty-safe results', () => {
  const longTree = [axNode({ nodeId: 'a', role: 'StaticText', name: 'x'.repeat(5000) })];
  const summary = buildAxSummary(longTree);
  assert.ok(summary.items[0].name.length <= AX_SUMMARY_LIMITS.maxNameChars, summary.items[0].name.length);
  const empty = buildAxSummary([]);
  assert.deepEqual(empty.items, []);
  const allIgnored = buildAxSummary([axNode({ ignored: true, name: 'nope' })]);
  assert.deepEqual(allIgnored.items, []);
});

test('content.js exposes the pure-DOM accessibility layer (Layer A)', () => {
  // Shadow-piercing bounded collection replaces flat querySelectorAll scans.
  assert.match(content, /function collectInteractiveNodes\(/);
  assert.match(content, /shadowRoot/);
  assert.match(content, /MAX_SHADOW_ROOTS/);
  for (const anchor of ['semanticRegionObservation', 'pageFind']) {
    assert.ok(
      content.slice(content.indexOf(`function ${anchor}`), content.indexOf(`function ${anchor}`) + 3000).includes('collectInteractiveNodes()'),
      `${anchor} must collect through open shadow roots`
    );
  }
  // Computed accessible names: descendant img alt / svg title add signal.
  assert.match(content, /function computeAccessibleName\(/);
  assert.match(content, /accessibleName/);
  assert.match(content, /compactElementProjection[\s\S]*?accessibleName: item\.accessibleName/);
  // find matches the accessible name alongside label/text/placeholder.
  assert.match(content, /s\.label, s\.text, s\.placeholder, s\.accessibleName/);
  // Shadow elements stay actionable: elementFromPoint returns the shadow host.
  assert.match(content, /function composedHostChain\(/);
  assert.match(content, /hitTestReachable/);
});

test('background.js attaches a poverty-triggered, fail-open CDP axSummary (Layer B)', () => {
  assert.match(background, /import \{ buildAxSummary[^}]*\} from '\.\/lib\/ax-summary\.js'/);
  assert.match(background, /AX_SUMMARY_TEXT_POVERTY_CHARS/);
  assert.match(background, /Accessibility\.enable/);
  assert.match(background, /Accessibility\.getFullAXTree/);
  assert.match(background, /withDebugger\(tabId, context, /);
  // The trigger must be text poverty only, and collection failures must not
  // break the observation: fail-open to no axSummary.
  assert.match(background, /totalTextChars/);
  // Re-frozen 2026-10-01 (Phase 2 Task 6): silent catches now log, so fail-open
  // is a logged catch returning null rather than an empty catch block.
  assert.match(background, /catch \(error\) \{\s*log\.debug\('AX_SUMMARY_COLLECTION_FAILED',[\s\S]*?return null;/);
});

test('MCP guidance documents the accessibility surface without new tools', () => {
  assert.match(mcp, /accessibleName/);
  assert.match(mcp, /axSummary/);
  assert.doesNotMatch(mcp, /registerTool\("(?:read_ax|ax_summary|accessibility)/);
  // The public tool inventory stays frozen at the rebaseline (29 with listen tools).
  const tools = [...mcp.matchAll(/server\.registerTool\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.equal(tools.length, 29);
});
