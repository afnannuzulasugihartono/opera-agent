// Last edited: 2026-10-04 17:52. Title: experimental-v2.test — Test. Now: add adaptive screenshots.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ALLOWED_METHODS } from '../extension/lib/protocol.js';

const experiment = fs.readFileSync(
  new URL('../supabase/migrations/20260909011331_opera_agent_v2.sql', import.meta.url),
  'utf8'
);
const quarantine = fs.readFileSync(
  new URL('../supabase/migrations/20260909012749_opera_agent_quarantine_unreleased_v2.sql', import.meta.url),
  'utf8'
);

test('historical v2 local-plan experiment is preserved in migration history', () => {
  assert.match(experiment, /browser\.plan/);
  for (const workflow of [
    'browser.v2_status',
    'research.v2_crawl_urls',
    'research.v2_read_current_full',
    'research.v2_read_url_full'
  ]) {
    assert.ok(experiment.includes(workflow), workflow);
  }
});

test('stable extension does not advertise browser.plan and the experiment remains quarantined', () => {
  assert.equal(ALLOWED_METHODS.length, 26);
  assert.equal(ALLOWED_METHODS.includes('browser.plan'), false);
  assert.match(quarantine, /set enabled = false/i);
  assert.match(quarantine, /where method = 'browser\.plan'/i);
  assert.match(quarantine, /experimental_v2\.quarantined/);
  assert.match(quarantine, /false\s*\)\s*;/i);
});
