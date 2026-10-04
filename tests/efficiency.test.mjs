// Last edited: 2026-10-04 17:52. Title: efficiency.test — Test. Now: consolidate the latency cluster into one file.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bridge = fs.readFileSync(new URL('../supabase/functions/opera-agent-bridge/index.ts', import.meta.url), 'utf8');
const runner = fs.readFileSync(new URL('../supabase/functions/opera-agent-runner/index.ts', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const content = fs.readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260908233759_opera_agent_efficiency_workflows.sql', import.meta.url), 'utf8');
const parallelMigration = fs.readFileSync(new URL('../supabase/migrations/20260908233810_opera_agent_parallel_crawl_workflow.sql', import.meta.url), 'utf8');
const transcriptMigration = fs.readFileSync(new URL('../supabase/migrations/20260909000412_opera_agent_youtube_transcript_fast_path.sql', import.meta.url), 'utf8');
const transcriptRenderMigration = fs.readFileSync(new URL('../supabase/migrations/20260909001248_opera_agent_youtube_transcript_render_ready.sql', import.meta.url), 'utf8');
const textOnlyMigration = fs.readFileSync(new URL('../supabase/migrations/20260909021225_extension_1_1_text_only_workflows.sql', import.meta.url), 'utf8');

test('bridge delegates the pull wait to Postgres and issues one claim call per request', () => {
  // Replaces the previous fast-start/idle client-side cadence lock. That
  // behavior was removed deliberately on 2026-10-02: the bridge used to sleep
  // between `opera_claim_next` calls, which cost one HTTP round trip per poll
  // (14 per 12s window) and left a queue wait of p50 830ms / p95 1910ms. The
  // cadence constants are gone because the cadence is no longer the bridge's
  // to choose. This lock asserts the replacement contract, and the measured
  // figures live in tests/latency-surface.test.mjs section C.
  assert.match(bridge, /rpc\("opera_claim_next_wait", \{/);
  assert.doesNotMatch(bridge, /rpc\("opera_claim_next",/);
  assert.match(bridge, /p_wait_ms:\s*waitMs/);
  // The long-poll window is still clamped to the same range the extension
  // relies on: it sends waitMs 5000 and a 10000ms fetch timeout.
  assert.match(bridge, /waitMs,\s*0,\s*25000,\s*12000/);
  // The extension keeps its server wait well inside its fetch timeout, with
  // room for a cold start: pullOnce lives in the service worker and cannot be
  // imported in node, so the pairing itself is pinned by source text here.
  assert.match(background, /waitMs:\s*5000/);
  assert.match(background, /\}, 10000\);/);
  // One claim call per pull, no client-side retry or pacing.
  const pull = bridge.slice(bridge.indexOf('async function pull('), bridge.indexOf('async function complete('));
  assert.equal((pull.match(/rpc\(/g) || []).length, 1, 'pull must make exactly one RPC call');
  assert.doesNotMatch(pull, /while\s*\(true\)|do\s*\{/);
  assert.doesNotMatch(bridge, /FAST_PULL_|IDLE_PULL_/);
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

test('runner records bounded metadata-only workflow performance metrics', () => {
  for (const marker of ['workflowQueueMs', 'workflowExecutionMs', 'commandCount', 'commandQueueMs', 'commandExecutionMs', 'returnedBytes', 'returnedBytesTruncated', 'fixedWaitCount', 'intentionalWaitMs', 'commandsTruncated']) {
    assert.match(runner, new RegExp(marker));
  }
  assert.match(runner, /metrics\.commands\.length < 200/);
  assert.match(runner, /METRIC_SAMPLE_CHARS\s*=\s*16384/);
  assert.match(runner, /METRIC_SAMPLE_NODES\s*=\s*200/);
  assert.doesNotMatch(runner, /JSON\.stringify\(value/);
  assert.doesNotMatch(runner, /metrics\.(?:pageText|content|formValue|password)/i);
});

test('content readiness uses an internal zero-payload ping instead of a semantic read', () => {
  const ensureContent = background.slice(background.indexOf('async function ensureContent'), background.indexOf('async function contentCall'));
  assert.match(ensureContent, /method: 'content\.ping'/);
  assert.doesNotMatch(ensureContent, /method: 'page\.read'/);
  assert.match(content, /case 'content\.ping'/);
});

test('contentCall sends first and only re-establishes the bridge on transport failure', () => {
  // Source-text pin with a stated reason: contentCall needs chrome.* and cannot
  // run in node, so the wiring order is pinned here while the latency effect is
  // measured by the browser harness (page.read/page.query medians before/after).
  // Optimistic send: the normal case costs one sendMessage instead of
  // tabs.get + ping + send. A page-bridge refusal (ok:false) is an answer, not
  // a transport failure, and must never trigger re-injection.
  const call = background.slice(background.indexOf('async function contentCall'), background.indexOf('async function executeInTab'));
  const firstSend = call.indexOf('chrome.tabs.sendMessage');
  const ensure = call.indexOf('ensureContent(');
  assert.ok(firstSend >= 0 && ensure > firstSend, 'the command must go out before any ensure step');
  // The fallback path still goes through ensureContent, which keeps the
  // http/https guard message and the inject step byte-for-byte untested here
  // but covered by the unchanged readiness test above.
  assert.match(call, /await ensureContent\(tabId\)/);
  // Refusal short-circuits: ok:false throws without touching ensureContent.
  const refusal = call.indexOf('response.ok === false');
  assert.ok(refusal >= 0 && refusal < ensure, 'a refusal must throw before the fallback');
});

test('page.read supports a backward-compatible text-only response', () => {
  assert.match(content, /args\.includeElements !== false/);
  assert.match(content, /semanticIdentity\.observe\(regional\.items/);
  assert.match(content, /page\.elements = observation\.items/);
  assert.match(content, /page\.semanticViews = semanticViews\.observe/);
  assert.equal((content.match(/case 'page\.read'/g) || []).length, 1);
});

test('tab activation and navigation have generic no-op fast paths', () => {
  assert.match(background, /let reused = !!tab\.active/);
  assert.match(background, /safeUrl\(current\.url\) === url/);
  assert.match(background, /reused: true/);
});

test('full-text workflows use bounded adaptive continuation rather than fixed 6k reads', () => {
  assert.match(migration, /research\.read_current_full/);
  assert.match(migration, /research\.read_url_full/);
  assert.match(migration, /"limit":12000/);
  assert.match(migration, /"nextOffset"/);
  assert.match(migration, /"hasMore"/);
  assert.match(migration, /"failOnLimit":false/);
});

test('text-oriented workflows are versioned to request no element payload', () => {
  for (const name of ['research.read_current_full', 'research.read_url_full', 'youtube.get_transcript']) {
    assert.match(textOnlyMigration, new RegExp(name.replaceAll('.', '\\.')));
  }
  assert.match(textOnlyMigration, /'"maxElements": 1'/);
  assert.match(textOnlyMigration, /'"maxElements": 1, "includeElements": false'/);
  assert.match(textOnlyMigration, /"includeElements": false/);
  assert.match(textOnlyMigration, /opera_register_workflow/);
  assert.match(textOnlyMigration, /Unable to register workflow/);
  assert.doesNotMatch(textOnlyMigration, /update\s+public\.opera_workflow_versions/i);
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

test('R6 YouTube recommendation prefers local SPA click with bounded navigation fallback', () => {
  const migrationDir = new URL('../supabase/migrations/', import.meta.url);
  const latest = fs.readdirSync(migrationDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .reverse()
    .map((name) => fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
    .find((sql) => sql.includes("'youtube.play_recommendation'"));

  assert.ok(latest, 'youtube.play_recommendation workflow migration must exist');
  const section = latest.slice(latest.indexOf("'youtube.play_recommendation'"));
  const workflowMatch = section.match(/\$wf\$([\s\S]*?)\$wf\$::jsonb/);
  assert.ok(workflowMatch, 'latest youtube.play_recommendation definition must contain JSON workflow data');
  const workflow = JSON.parse(workflowMatch[1]);

  const matchingSteps = (id) => {
    const found = [];
    const walk = (steps) => {
      for (const step of steps || []) {
        if (step?.id === id) found.push(step);
        if (Array.isArray(step?.then)) walk(step.then);
        if (Array.isArray(step?.else)) walk(step.else);
        if (Array.isArray(step?.steps)) walk(step.steps);
      }
    };
    walk(workflow.steps);
    return found;
  };

  const [local] = matchingSteps('openrecLocal');
  const [waitLocal] = matchingSteps('waitwatchLocal');
  const fallbacks = matchingSteps('openrecFallback');

  assert.equal(local?.method, 'page.click');
  assert.deepEqual(local?.params?.ref, { $ref: 'steps.rec.result.item.ref' });
  assert.equal(local?.params?.trusted, true);
  assert.equal(waitLocal?.method, 'page.wait_for');
  assert.equal(waitLocal?.params?.timeoutMs, 2500);
  assert.ok(fallbacks.length >= 1);
  for (const fallback of fallbacks) {
    assert.equal(fallback.method, 'tabs.navigate');
    assert.deepEqual(fallback.params?.url, { $ref: 'steps.rec.result.item.href' });
    assert.equal(fallback.params?.wait, false);
  }
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

test('YouTube transcript waits for actual rows and restores active-tab state after render fallback', () => {
  assert.match(transcriptRenderMigration, /ytd-transcript-segment-renderer/);
  assert.match(transcriptRenderMigration, /ENGAGEMENT_PANEL_VISIBILITY_EXPANDED/);
  assert.match(transcriptRenderMigration, /activatedForRender/);
  assert.match(transcriptRenderMigration, /"id":"activateForRender"/);
  assert.match(transcriptRenderMigration, /"focusWindow":false/);
  assert.match(transcriptRenderMigration, /"id":"restoreActive"/);
  assert.match(transcriptRenderMigration, /"limit":12000/);
});

test('historical migrations and legacy fallback objects are not rewritten by efficiency work', () => {
  for (const sql of [migration, parallelMigration, transcriptMigration, transcriptRenderMigration, textOnlyMigration]) {
    assert.doesNotMatch(sql, /alter\s+table\s+.*loa_v3_/i);
    assert.doesNotMatch(sql, /drop\s+table/i);
    assert.doesNotMatch(sql, /update\s+public\.opera_workflow_versions/i);
  }
});
