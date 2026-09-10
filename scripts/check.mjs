import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { ALLOWED_METHODS, PRODUCT_VERSION } from '../extension/lib/protocol.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.name, 'Opera Agent');
assert.equal(manifest.version, '1.4.0');
assert.equal(PRODUCT_VERSION, '1.4.0');
assert.equal(pkg.version, '1.4.0');
assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.permissions.includes('debugger'));
assert.ok(manifest.permissions.includes('storage'));
assert.equal(ALLOWED_METHODS.length, 26);
assert.match(manifest.update_url, /^https:\/\/.*\.supabase\.co\//);
assert.ok(typeof manifest.key === 'string' && manifest.key.length > 100);
const identityDigest = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16);
const extensionId = [...identityDigest].map((byte) => `${String.fromCharCode(97 + (byte >> 4))}${String.fromCharCode(97 + (byte & 15))}`).join('');
assert.equal(extensionId, 'ohbbpamcljckmjhcpkcmefdobkoeaick');

const files = [
  'extension/background.js', 'extension/content.js', 'extension/popup.js',
  'supabase/functions/opera-agent-bridge/index.ts',
  'supabase/functions/opera-agent-update/index.ts',
  'supabase/functions/opera-agent-runner/index.ts',
  'supabase/migrations/20260907204146_opera_agent_1_0_0_core.sql',
  'supabase/migrations/20260907204221_opera_agent_1_0_0_workflows.sql',
  'supabase/migrations/20260907204248_opera_agent_1_0_0_seed_workflows.sql',
  'supabase/migrations/20260908021000_opera_agent_releases.sql',
  'supabase/migrations/20260908025018_opera_agent_lock_internal_workflow_functions.sql',
  'supabase/migrations/20260908025218_opera_agent_command_method_index.sql',
  'supabase/migrations/20260908031800_opera_agent_async_workflow_runner.sql',
  'supabase/migrations/20260908040000_opera_agent_two_phase_command_api.sql',
  'supabase/migrations/20260908073800_opera_agent_update_telemetry.sql',
  'supabase/migrations/20260908233759_opera_agent_efficiency_workflows.sql',
  'supabase/migrations/20260908233810_opera_agent_parallel_crawl_workflow.sql',
  'supabase/migrations/20260909000412_opera_agent_youtube_transcript_fast_path.sql',
  'supabase/migrations/20260909001248_opera_agent_youtube_transcript_render_ready.sql',
  'supabase/migrations/20260909021225_extension_1_1_text_only_workflows.sql',
  'supabase/migrations/20260910114405_opera_agent_adaptive_screenshot.sql'
];
for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  assert.doesNotMatch(text, /\beval\s*\(/, `${file} must not use eval`);
  assert.doesNotMatch(text, /new\s+Function\s*\(/, `${file} must not use Function constructor`);
}
const background = fs.readFileSync(path.join(root, 'extension/background.js'), 'utf8');
for (const marker of ['pendingCompletion','completeWithRetry','flushPendingCompletion']) assert.ok(background.includes(marker), marker);
const content = fs.readFileSync(path.join(root, 'extension/content.js'), 'utf8');
for (const marker of ['password','one-time-code','cvv','cvc','type === \'file\'']) assert.ok(content.toLowerCase().includes(marker.toLowerCase()), marker);
const ensureContent = background.slice(background.indexOf('async function ensureContent'), background.indexOf('async function contentCall'));
assert.match(ensureContent, /method: 'content\.ping'/);
assert.doesNotMatch(ensureContent, /method: 'page\.read'/);
assert.match(content, /args\.includeElements !== false/);
assert.match(content, /case 'content\.ping'/);
const bridge = fs.readFileSync(path.join(root, 'supabase/functions/opera-agent-bridge/index.ts'), 'utf8');
for (const marker of ['FAST_PULL_POLLS', 'FAST_PULL_INTERVAL_MS', 'IDLE_PULL_INTERVAL_MS']) assert.ok(bridge.includes(marker), marker);
const runner = fs.readFileSync(path.join(root, 'supabase/functions/opera-agent-runner/index.ts'), 'utf8');
for (const marker of ['opera_await', 'normalizeAwaitTiming', 'SAFE_RETRY_DELAY_MS', 'transientFailure', 'MAX_PARALLEL_ITEMS', 'createWorkflowMetrics', 'recordCommandMetrics', 'intentionalWaitMs']) assert.ok(runner.includes(marker), marker);
assert.doesNotMatch(runner, /\.from\("opera_commands"\)/);
assert.doesNotMatch(runner, /COMMAND_POLL_(?:MIN|MAX)_MS/);
const mcp = fs.readFileSync(path.join(root, 'supabase/functions/opera-agent-mcp/index.ts'), 'utf8');
assert.match(mcp, /method === "page\.capture" \? "opera_await_capture" : "opera_await"/);
const efficiency = fs.readFileSync(path.join(root, 'supabase/migrations/20260908233759_opera_agent_efficiency_workflows.sql'), 'utf8');
for (const marker of ['research.read_current_full', 'research.read_url_full', 'youtube.get_transcript', '"limit":12000', '"maxElements":1']) assert.ok(efficiency.includes(marker), marker);
const parallel = fs.readFileSync(path.join(root, 'supabase/migrations/20260908233810_opera_agent_parallel_crawl_workflow.sql'), 'utf8');
for (const marker of ['research.crawl_urls_parallel', '"parallel":true', '"maxConcurrency":4']) assert.ok(parallel.includes(marker), marker);
const transcript = fs.readFileSync(path.join(root, 'supabase/migrations/20260909000412_opera_agent_youtube_transcript_fast_path.sql'), 'utf8');
for (const marker of ['panelWasOpen', 'openSynthetic', 'openTrusted', 'openMethod', '"limit":12000']) assert.ok(transcript.includes(marker), marker);
const transcriptRender = fs.readFileSync(path.join(root, 'supabase/migrations/20260909001248_opera_agent_youtube_transcript_render_ready.sql'), 'utf8');
for (const marker of ['ytd-transcript-segment-renderer', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED', 'activatedForRender', 'activateForRender', 'restoreActive', '"limit":12000']) assert.ok(transcriptRender.includes(marker), marker);
const updateFunction = fs.readFileSync(path.join(root, 'supabase/functions/opera-agent-update/index.ts'), 'utf8');
for (const marker of ['opera_update_events', 'update_xml', 'passiveUpdateTelemetry', 'requestedExtensionId', 'opera-agent-${release.extension_id}-${release.version}.crx']) assert.ok(updateFunction.includes(marker), marker);
const perIdentityUpdateMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260909045456_opera_agent_per_identity_update_channels.sql'), 'utf8');
for (const marker of ['drop constraint if exists opera_releases_pkey', 'add primary key (extension_id, version)', 'opera_releases_one_active_per_identity_idx']) assert.ok(perIdentityUpdateMigration.includes(marker), marker);
const genericPointerMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260909063406_opera_agent_generic_pointer.sql'), 'utf8');
assert.match(genericPointerMigration, /page\.pointer/);
for (const marker of ['trustedPointer', 'page.pointer_target', 'Pointer blocked on sensitive target']) assert.ok(`${background}\n${content}`.includes(marker), marker);
for (const marker of ['capturePage', 'Page.captureScreenshot', 'page.capture_policy', 'captureFramePrivacyProbe', 'allFrames: true', 'MAX_SCREENSHOT_BYTES', 'previousHash', 'privateTabIds', 'screenshotLooksBlank', 'BLANK_SCREENSHOT']) assert.ok(`${background}\n${content}`.includes(marker), marker);
const burstMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260910024820_opera_agent_bounded_browser_burst.sql'), 'utf8');
assert.match(burstMigration, /browser\.burst/);
for (const marker of ['BURST_MAX_STEPS', 'BURST_MAX_TIMEOUT_MS', 'runBurst', 'MAX_BURST_RESULT_BYTES']) assert.ok(`${fs.readFileSync(path.join(root, 'extension/lib/protocol.js'), 'utf8')}\n${background}`.includes(marker), marker);
console.log(`check ok: ${ALLOWED_METHODS.length} allowlisted browser primitives, version ${manifest.version}`);
