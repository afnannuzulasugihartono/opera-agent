// @last-edited: 2026-10-10 UTC+7.
// @title: burst-atomic-actions.test — Test..
// @state: Test..
// @dependencies: node:fs, node:test, strict, protocol, extension-source.

import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { BURST_STEP_KEYS, validateBurst } from '../extension/lib/protocol.js';
import { extensionSource } from './helpers/extension-source.mjs';

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
  const src = fs.readFileSync(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');
  assert.match(src, /refFromStep: z\.number\(\)\.int\(\)\.nonnegative\(\)\.optional\(\)/);
  assert.match(src, /refIndex: z\.number\(\)\.int\(\)\.nonnegative\(\)\.optional\(\)/);
});

test('mcp instructions teach the atomic find+click burst pattern', () => {
  const src = fs.readFileSync(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');
  assert.match(src, /one run_browser_burst/i, 'instructions must recommend one-burst find+click+wait');
});

test('mcp exposes run_workflow tool bound to the audited start/get RPCs', () => {
  const src = fs.readFileSync(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');
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

test('version bumped to 1.6.22 for the modular worker release', () => {
  assert.equal(BURST_STEP_KEYS && true, true);
  const protocol = fs.readFileSync(new URL('../extension/lib/protocol.js', import.meta.url), 'utf8');
  assert.match(protocol, /PRODUCT_VERSION = '1.6.22'/);
  const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, '1.6.22');
});
