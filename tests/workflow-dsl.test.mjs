// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: workflow-dsl.test — Test..
// @state: Test..
// @dependencies: node:test, strict, node:fs, extension-source.

// Why source-text pins, stated per AGENTS.md: the deliverable here is a migration DSL boundary, and the hazards are all about what the SQL must NOT do -- no legacy table modification, no generic escape hatch in the registry, no site-specific logic leaking into the extension, no per-run project secret writes.
// Those are claims about text in a migration, so they are asserted against the migration text, and the operational half (an in-process engine actually running command/condition/repeat/foreach steps) is covered by the live suites that execute the functions.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extensionSource } from './helpers/extension-source.mjs';

const core = fs.readFileSync(new URL('../supabase/migrations/20260907204146_opera_agent_1_0_0_core.sql', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../supabase/migrations/20260907204221_opera_agent_1_0_0_workflows.sql', import.meta.url), 'utf8');
const seed = fs.readFileSync(new URL('../supabase/migrations/20260907204248_opera_agent_1_0_0_seed_workflows.sql', import.meta.url), 'utf8');
const efficiency = fs.readFileSync(new URL('../supabase/migrations/20260908233759_opera_agent_efficiency_workflows.sql', import.meta.url), 'utf8');
const sql = core + '\n' + workflow + '\n' + seed + '\n' + efficiency;

test('migration defines clean Opera Agent objects without modifying legacy tables', () => {
  for (const name of ['opera_devices','opera_commands','opera_workflows','opera_workflow_versions','opera_audit']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${name}`));
  }
  assert.doesNotMatch(sql, /drop\s+table\s+.*loa_v3_/i);
  assert.doesNotMatch(sql, /alter\s+table\s+.*loa_v3_/i);
});

test('workflow registry validates allowlisted methods and supports rollback', () => {
  assert.match(sql, /opera_validate_steps/);
  assert.match(sql, /opera_register_workflow/);
  assert.match(sql, /opera_rollback_workflow/);
  assert.match(sql, /opera_workflow_versions/);
});

test('cloud workflow engine supports command, conditions, repeat and foreach', () => {
  for (const token of ["v_type='command'", "v_type='if'", "v_type='repeat'", "v_type='foreach'", "v_type='set'", "v_type='wait'", "v_type='fail'"]) {
    assert.ok(sql.includes(token), token);
  }
});

test('efficiency workflows keep generic primitives flexible', () => {
  for (const name of [
    'research.read_current_full',
    'research.read_url_full',
    'youtube.get_transcript',
    'youtube.search',
    'youtube.play_recommendation',
    'youtube.captions_on'
  ]) assert.ok(efficiency.includes(name), name);

  assert.match(efficiency, /"limit":12000/);
  assert.match(efficiency, /"maxElements":1/);
  assert.match(efficiency, /"maxIterations":30/);
  assert.match(efficiency, /"selector":"ytd-search"/);
  assert.doesNotMatch(efficiency, /"ms":600/);
});

test('site-specific logic remains outside the extension', async () => {
  assert.match(sql, /youtube\.captions_on/);
  assert.match(sql, /youtube\.play_recommendation/);
  assert.match(sql, /youtube\.get_transcript/);
  assert.match(sql, /research\.crawl_urls/);
  const background = await extensionSource();
  const content = fs.readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
  assert.doesNotMatch(background + content, /youtube\.com|ytp-|youtube\./i);
});
