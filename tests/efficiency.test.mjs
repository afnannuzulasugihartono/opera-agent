import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bridge = fs.readFileSync(new URL('../supabase/functions/opera-agent-bridge/index.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260908133000_opera_agent_efficiency_workflows.sql', import.meta.url), 'utf8');

test('bridge uses a short fast-start polling window then returns to conservative idle polling', () => {
  assert.match(bridge, /FAST_PULL_POLLS\s*=\s*6/);
  assert.match(bridge, /FAST_PULL_INTERVAL_MS\s*=\s*50/);
  assert.match(bridge, /IDLE_PULL_INTERVAL_MS\s*=\s*250/);
  assert.match(bridge, /emptyPolls\s*<\s*FAST_PULL_POLLS/);
  assert.match(bridge, /waitMs,\s*0,\s*25000,\s*12000/);
});

test('full-text workflows use bounded adaptive continuation rather than fixed 6k reads', () => {
  assert.match(migration, /research\.read_current_full/);
  assert.match(migration, /research\.read_url_full/);
  assert.match(migration, /"limit":12000/);
  assert.match(migration, /"nextOffset"/);
  assert.match(migration, /"hasMore"/);
  assert.match(migration, /"failOnLimit":false/);
});

test('YouTube recommendation skips ad polling entirely when no ad is present', () => {
  const section = migration.slice(migration.indexOf("'youtube.play_recommendation'"), migration.indexOf("'youtube.get_transcript'"));
  assert.match(section, /"id":"adinitial"/);
  assert.match(section, /"steps\.adinitial\.result\.item"/);
  assert.match(section, /"ms":250/);
  assert.doesNotMatch(section, /"ms":600/);
});

test('historical migrations are not rewritten by the efficiency migration', () => {
  assert.doesNotMatch(migration, /alter\s+table\s+.*loa_v3_/i);
  assert.doesNotMatch(migration, /drop\s+table/i);
  assert.doesNotMatch(migration, /update\s+public\.opera_workflow_versions/i);
});
