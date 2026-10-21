// @last-edited: 2026-10-13 UTC+7.
// @title: burst-atomic-actions.test — Test..
// @state: Test..
// @dependencies: node:fs, node:test, strict, protocol, extension-source.

import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { BURST_STEP_KEYS, validateBurst, expandGridSteps } from '../extension/lib/protocol.js';
import { extensionSource } from './helpers/extension-source.mjs';
import { mcpSurfaceSourceSync } from './helpers/mcp-surface-source.mjs';

test('burst click/fill steps accept refFromStep passthrough keys', () => {
  assert.ok(BURST_STEP_KEYS.click.includes('refFromStep'), 'click must allow refFromStep');
  assert.ok(BURST_STEP_KEYS.click.includes('refIndex'), 'click must allow refIndex');
  assert.ok(BURST_STEP_KEYS.fill.includes('refFromStep'), 'fill must allow refFromStep');
  assert.ok(BURST_STEP_KEYS.fill.includes('refIndex'), 'fill must allow refIndex');
});

test('validateBurst accepts a find -> click passthrough plan referencing an earlier step', () => {
  const plan = {
    tabId: 7,
    steps: [
      { action: 'find', text: 'Skip', exact: true, limit: 20 },
      { action: 'click', refFromStep: 0, refIndex: 0 }
    ]
  };
  const result = validateBurst(plan);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('validateBurst rejects refFromStep pointing forward or at itself', () => {
  const badPlans = [

    { tabId: 7, steps: [{ action: 'find', text: 'Skip' }, { action: 'click', refFromStep: 1, refIndex: 0 }] },

    { tabId: 7, steps: [{ action: 'click', refFromStep: 0, refIndex: 0 }] }
  ];
  for (const plan of badPlans) {
    const result = validateBurst(plan);
    assert.equal(result.ok, false, `must be rejected: ${JSON.stringify(result)}`);
    assert.match(String(result.error), /refFromStep/);
  }
});

test('background burst runner resolves refFromStep from the referenced step result', async () => {
  const src = await extensionSource();
  assert.match(src, /refFromStep/, 'background must read refFromStep');
  assert.match(src, /resolvedFrom:\s*`step:\$\{/i, 'click result must report resolvedFrom step:N');
  assert.match(src, /refFromStep must reference an earlier burst step/, 'forward references must fail with a clear message');
});

test('mcp run_browser_burst exposes refFromStep passthrough', () => {
  const src = mcpSurfaceSourceSync();
  assert.match(src, /refFromStep: z\.number\(\)\.int\(\)\.nonnegative\(\)\.optional\(\)/);
  assert.match(src, /refIndex: z\.number\(\)\.int\(\)\.nonnegative\(\)\.optional\(\)/);
});

test('mcp instructions teach the atomic find+click burst pattern', () => {
  const src = mcpSurfaceSourceSync();
  assert.match(src, /one run_browser_burst/i, 'instructions must recommend one-burst find+click+wait');
});

test('mcp exposes run_workflow tool bound to the audited start/get RPCs', () => {
  const src = mcpSurfaceSourceSync();
  assert.match(src, /registerTool\("run_workflow"/);
  assert.match(src, /opera_start_workflow/);
  assert.match(src, /opera_get_workflow_run/);
});

test('skip_ads workflow migration registers a re-querying loop workflow', () => {
  const migrations = fs.readdirSync(new URL('../supabase/migrations', import.meta.url));
  const name = migrations.find((file) => file.includes('opera_agent_youtube_skip_ads_workflow'));
  assert.ok(name, 'a youtube skip_ads workflow migration must exist');
  const sql = fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
  assert.match(sql, /opera_register_workflow\(\s*'youtube\.skip_ads'/);
  assert.match(sql, /ytp-ad-skip-button-modern/, 'must target the modern skip control');
  assert.match(sql, /"type":"repeat"/, 'must re-query in a bounded loop instead of reusing stale refs');
  assert.match(sql, /ad-showing/, 'must poll the ad-state post-condition');
});

test('version bumped to 1.6.27 for the local loop release', () => {
  assert.equal(BURST_STEP_KEYS && true, true);
  const protocol = fs.readFileSync(new URL('../extension/lib/protocol.js', import.meta.url), 'utf8');
  assert.match(protocol, /PRODUCT_VERSION = '1.6.27'/);
  const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, '1.6.27');
});

test('validateBurst accepts grid and file macro steps with tight params', () => {
  const grid = validateBurst({ steps: [{ action: 'grid', rows: 3, cols: 4 }] });
  assert.equal(grid.ok, true, JSON.stringify(grid));
  assert.equal(validateBurst({ steps: [{ action: 'grid', rows: 0, cols: 4 }] }).ok, false);
  assert.equal(validateBurst({ steps: [{ action: 'grid', rows: 3, cols: 21 }] }).ok, false);
  assert.equal(validateBurst({ steps: [{ action: 'grid', rows: 3 }] }).ok, false);
  const file = validateBurst({ steps: [{ action: 'file', filename: 'fig.png', data: 'data:image/png;base64,AA' }] });
  assert.equal(file.ok, true, JSON.stringify(file));
  assert.equal(validateBurst({ steps: [{ action: 'file', filename: 'fig.png' }] }).ok, false);
  assert.equal(validateBurst({ steps: [{ action: 'file', filename: 'fig.png', data: 'x'.repeat(3000000) }] }).ok, false);
});

test('expandGridSteps unrolls a grid into arrow keys plus Enter', () => {
  const steps = expandGridSteps([{ action: 'grid', rows: 2, cols: 3 }]);
  assert.deepEqual(steps.map((s) => s.key), ['ArrowRight', 'ArrowRight', 'ArrowDown', 'Enter']);
  assert.ok(steps.every((s) => s.action === 'key'));
  assert.deepEqual(expandGridSteps([{ action: 'grid', rows: 1, cols: 1 }]), [{ action: 'key', key: 'Enter' }]);
  const passthrough = [{ action: 'click', ref: 'r1' }];
  assert.equal(expandGridSteps(passthrough)[0], passthrough[0], 'non-grid steps pass through untouched');
  const mixed = expandGridSteps([{ action: 'grid', rows: 1, cols: 2 }, { action: 'find', text: 'x' }, { action: 'click', refFromStep: 1 }]);
  assert.equal(mixed[3].refFromStep, 2, 'a ref keeps pointing at its find step after expansion');
});

test('burst file steps reach the content file setter', () => {
  const burst = fs.readFileSync(new URL('../extension/worker/burst.js', import.meta.url), 'utf8');
  const content = fs.readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
  assert.match(burst, /page\.set_files/);
  assert.match(burst, /expandGridSteps\(params\.steps\)/);
  assert.match(content, /case 'page\.set_files'/);
  assert.match(content, /new DataTransfer\(\)/);
});

// The picker opens focused on 1x1, Down enters the grid, Right crosses columns and Down crosses rows, Enter picks.
// Measured against the live Docs grid on 2026-10-14: one ArrowDown left the label at 1 x 1, ArrowRight moved it to 2 x 1, so the sequence below is the observed one, written out rather than compared against a helper that nothing but this test imports.

test('burst grid expansion walks the measured picker sequence exactly', () => {
  for (const [rows, cols] of [[1, 1], [2, 1], [2, 3], [5, 4]]) {
    const expanded = expandGridSteps([{ action: 'grid', rows, cols }]).map((s) => s.key);
    const expected = [
      ...Array.from({ length: cols - 1 }, () => 'ArrowRight'),
      ...Array.from({ length: rows - 1 }, () => 'ArrowDown'),
      'Enter'
    ];
    assert.deepEqual(expanded, expected, `${cols}x${rows} must match the measured walk`);
  }
});
