// @last-edited: 2026-10-21 UTC+7.
// @title: efficiency.test — the round trips the device spends, counted in the source.
// @state: the workflows that parallelise, the pull endpoint that is gone, and the page helper that degrades instead of throwing.
// @dependencies: node:test, strict, node:fs, extension-source.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extensionSource } from './helpers/extension-source.mjs';

const bridge = fs.readFileSync(new URL('../supabase/functions/opera-agent-bridge/index.ts', import.meta.url), 'utf8');
const runner = fs.readFileSync(new URL('../supabase/functions/opera-agent-runner/index.ts', import.meta.url), 'utf8');
const background = await extensionSource();
const content = fs.readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260908233759_opera_agent_efficiency_workflows.sql', import.meta.url), 'utf8');
const parallelMigration = fs.readFileSync(new URL('../supabase/migrations/20260908233810_opera_agent_parallel_crawl_workflow.sql', import.meta.url), 'utf8');
const transcriptMigration = fs.readFileSync(new URL('../supabase/migrations/20260909000412_opera_agent_youtube_transcript_fast_path.sql', import.meta.url), 'utf8');
const transcriptRenderMigration = fs.readFileSync(new URL('../supabase/migrations/20260909001248_opera_agent_youtube_transcript_render_ready.sql', import.meta.url), 'utf8');
const textOnlyMigration = fs.readFileSync(new URL('../supabase/migrations/20260909021225_extension_1_1_text_only_workflows.sql', import.meta.url), 'utf8');

// The pull endpoint is gone: no client asked through it anymore — the device learns work over its socket — so the deployed contract it was is deleted rather than kept warm.
// What must not come back is the device asking for work, which was two round trips per action.

test('a missing page helper costs one feature, never the whole content script', () => {
  const content = fs.readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');

  assert.doesNotMatch(content, /throw new Error\('Role reconcile runtime/,
    'a missing helper still takes down every capability on the page');
  assert.doesNotMatch(content, /throw new Error\('Hover settle runtime/,
    'a missing helper still takes down every capability on the page');
  assert.match(content, /semanticRuntime/,
    'the missing helper is not reported anywhere');
});

// WHY this lock exists.
// Two popup buttons used to send a message to the worker inside try/finally with no catch, so clicking either one while the worker was restarting produced "Unchecked runtime.lastError: Could not establish connection" on the extension errors page.
// Observed live.
// Every message a piece of UI sends has to land somewhere the user can read it.

test('every popup message lands in a catch the user can read', () => {
  const popup = fs.readFileSync(new URL('../extension/popup.js', import.meta.url), 'utf8');

  const handlers = [...popup.matchAll(/\$\('(\w+)'\)\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n\}\);/g)];
  assert.ok(handlers.length >= 4, 'no popup click handlers found to check');

  for (const [, id, body] of handlers) {
    if (!body.includes('call(')) continue;
    assert.match(body, /catch\s*\(/,
      `$(' + id + ') sends a message with no catch, so a worker restart surfaces as an unchecked lastError`);
  }
});

test('the device asks nothing, so there is no pull endpoint left', () => {

  assert.match(bridge, /rpc\("opera_claim_next_wait", \{/);
  assert.doesNotMatch(bridge, /rpc\("opera_claim_next",/);
  assert.doesNotMatch(bridge, /async function pull\(/,
    'the pull endpoint is back, and with it the asking device');
  assert.equal((bridge.match(/rpc\("opera_claim_next_wait", \{/g) || []).length, 1,
    'more than one place claims, so the one-claim-function rule is gone');
  assert.match(bridge, /p_wait_ms: clamp\(detail\.waitMs, 0, 25000, 0\)/,
    'the claim no longer forwards the wait to Postgres');

  assert.doesNotMatch(background, /waitMs:\s*5000/,
    'the device still carries a five second poll wait');
  assert.match(background, /createSocketClient/);
  assert.match(background, /socketClient\.start\(\)/);

  const claim = bridge.slice(bridge.indexOf('async function claimForDevice('));
  const claimFn = claim.slice(0, claim.indexOf('\n}\n'));
  assert.equal((claimFn.match(/rpc\(/g) || []).length, 1, 'the claim must make exactly one RPC call');
  assert.doesNotMatch(claimFn, /while\s*\(true\)|do\s*\{/);
  assert.doesNotMatch(bridge, /FAST_PULL_|IDLE_PULL_/);
});

// The heartbeat used to be the poll loop's status writer as well as its keepalive.
// Left alone, it kept doing that job after the socket took over: every thirty seconds it stamped lastConnectedAt over the socket's own state, and a heartbeat that failed set the status to reconnecting while the socket was sitting there healthy.
// Observed live against the deployed bridge, where a perfectly connected device reported itself reconnecting.
// The heartbeat now keeps the device row fresh and says nothing about the connection.

test('the heartbeat keeps the device row fresh without claiming the connection status', () => {
  const body = background.slice(background.indexOf('async function heartbeat('));
  const fn = body.slice(0, body.indexOf('\n}'));

  assert.match(fn, /action: 'heartbeat'/, 'the heartbeat must still be sent');
  assert.doesNotMatch(fn, /setState\(/,
    'the heartbeat still writes connection state, so it fights the socket for it');
});

test('only the socket stamps lastConnectedAt, because only the socket knows when it connected', () => {
  const device = ['../extension/worker/execute-pull.js', '../extension/lib/socket-client.js']
    .map((p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''))
    .join('\n');

  const writes = [...device.matchAll(/lastConnectedAt:(?!\s*null)/g)];
  assert.equal(writes.length, 1,
    `lastConnectedAt is written in ${writes.length} places; one writer owns it or two of them disagree`);

  const owner = device.slice(Math.max(0, writes[0].index - 700), writes[0].index);
  assert.match(owner, /connectionPatch/, 'lastConnectedAt is not written by the socket state mapping');
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

  const call = background.slice(background.indexOf('async function contentCall'), background.indexOf('async function executeInTab'));
  const firstSend = call.indexOf('chrome.tabs.sendMessage');
  const ensure = call.indexOf('ensureContent(');
  assert.ok(firstSend >= 0 && ensure > firstSend, 'the command must go out before any ensure step');

  assert.match(call, /await ensureContent\(tabId\)/);

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
