import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bridge = fs.readFileSync(new URL('../supabase/functions/opera-agent-bridge/index.ts', import.meta.url), 'utf8');
const runner = fs.readFileSync(new URL('../supabase/functions/opera-agent-runner/index.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260908133000_opera_agent_efficiency_workflows.sql', import.meta.url), 'utf8');
const parallelMigration = fs.readFileSync(new URL('../supabase/migrations/20260908233500_opera_agent_parallel_crawl_workflow.sql', import.meta.url), 'utf8');
const transcriptMigration = fs.readFileSync(new URL('../supabase/migrations/20260908234500_opera_agent_youtube_transcript_fast_path.sql', import.meta.url), 'utf8');

test('bridge uses a short fast-start polling window then returns to conservative idle polling', () => {
  assert.match(bridge, /FAST_PULL_POLLS\s*=\s*6/);
  assert.match(bridge, /FAST_PULL_INTERVAL_MS\s*=\s*50/);
  assert.match(bridge, /IDLE_PULL_INTERVAL_MS\s*=\s*250/);
  assert.match(bridge, /emptyPolls\s*<\s*FAST_PULL_POLLS/);
  assert.match(bridge, /waitMs,\s*0,\s*25000,\s*12000/);
});

test('runner awaits command completion inside Postgres and keeps safe transient retries', () => {
  assert.match(runner, /rpc\("opera_await"/);
  assert.match(runner, /normalizeAwaitTiming/);
  assert.match(runner, /SAFE_RETRY_DELAY_MS\s*=\s*75/);
  assert.match(runner, /page\.wait_for/);
  assert.match(runner, /transientFailure/);
  assert.doesNotMatch(runner, /\.from\("opera_commands"\)/);
  assert.doesNotMatch(runner, /COMMAND_POLL_(?:MIN|MAX)_MS/);
});

test('full-text workflows use bounded adaptive continuation rather than fixed 6k reads', () => {
  assert.match(migration, /research\.read_current_full/);
  assert.match(migration, /research\.read_url_full/);
  assert.match(migration, /"limit":12000/);
  assert.match(migration, /"nextOffset"/);
  assert.match(migration, /"hasMore"/);
  assert.match(migration, /"failOnLimit":false/);
});

test('default crawl stays low-overhead while parallel crawl is explicit and bounded', () => {
  const defaultSection = migration.slice(migration.indexOf("'research.crawl_urls'"), migration.indexOf("'youtube.search'"));
  assert.match(defaultSection, /"id":"open"/);
  assert.match(defaultSection, /"id":"navigate"/);
  assert.match(defaultSection, /"method":"tabs\.navigate"/);
  assert.match(defaultSection, /"id":"close"/);
  assert.doesNotMatch(defaultSection, /"parallel":true/);

  assert.match(parallelMigration, /research\.crawl_urls_parallel/);
  assert.match(parallelMigration, /"parallel":true/);
  assert.match(parallelMigration, /"maxConcurrency":4/);
  assert.match(runner, /MAX_PARALLEL_ITEMS\s*=\s*4/);
  assert.match(runner, /structuredClone\(ctx\)/);
});

test('YouTube recommendation skips ad polling entirely when no ad is present', () => {
  const section = migration.slice(migration.indexOf("'youtube.play_recommendation'"), migration.indexOf("'youtube.get_transcript'"));
  assert.match(section, /"id":"adinitial"/);
  assert.match(section, /"steps\.adinitial\.result\.item"/);
  assert.match(section, /"ms":250/);
  assert.doesNotMatch(section, /"ms":600/);
});

test('YouTube transcript workflow reuses an open panel and prefers synthetic input before trusted fallback', () => {
  assert.match(transcriptMigration, /youtube\.get_transcript/);
  assert.match(transcriptMigration, /panelWasOpen/);
  assert.match(transcriptMigration, /openMethod/);
  assert.match(transcriptMigration, /"id":"openSynthetic"/);
  assert.match(transcriptMigration, /"trusted":false/);
  assert.match(transcriptMigration, /"id":"openTrusted"/);
  assert.match(transcriptMigration, /"trusted":true/);
  assert.match(transcriptMigration, /"limit":12000/);
});

test('historical migrations and legacy fallback objects are not rewritten by efficiency work', () => {
  for (const sql of [migration, parallelMigration, transcriptMigration]) {
    assert.doesNotMatch(sql, /alter\s+table\s+.*loa_v3_/i);
    assert.doesNotMatch(sql, /drop\s+table/i);
    assert.doesNotMatch(sql, /update\s+public\.opera_workflow_versions/i);
  }
});
