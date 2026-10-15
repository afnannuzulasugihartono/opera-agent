// @last-edited: 2026-10-13 UTC+7.
// @title: check — Script.
// @state: version 1.6.27 sweep for frame-rate state loops and track sensing.
// @dependencies: node:fs, node:path, node:crypto, node:url, strict, node:child_process, protocol, extension-source.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { ALLOWED_METHODS, PRODUCT_VERSION } from '../extension/lib/protocol.js';
import { extensionSource } from '../tests/helpers/extension-source.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const gateVerdict = spawnSync(process.execPath, [path.join(root, 'scripts/gates.mjs')], {
  encoding: 'utf8', stdio: 'pipe'
});
if (gateVerdict.status !== 0) {
  console.error(gateVerdict.stderr || gateVerdict.stdout || 'gates: verification failed');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.name, 'Opera Agent');
assert.equal(manifest.version, '1.6.27');
assert.equal(PRODUCT_VERSION, '1.6.27');
assert.equal(pkg.version, '1.6.27');
assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.permissions.includes('debugger'));
assert.ok(manifest.permissions.includes('storage'));
assert.equal(ALLOWED_METHODS.length, 29);
assert.match(manifest.update_url, /^https:\/\/.*\.supabase\.co\//);
assert.ok(typeof manifest.key === 'string' && manifest.key.length > 100);
const identityDigest = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16);
const extensionId = [...identityDigest].map((byte) => `${String.fromCharCode(97 + (byte >> 4))}${String.fromCharCode(97 + (byte & 15))}`).join('');

assert.equal(extensionId, 'ofgemipoobcnbjkfanmofjbdonjapmgl');

function collectRuntimeFiles(relativeDir, extensions) {
  const absoluteDir = path.join(root, relativeDir);
  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) return collectRuntimeFiles(relativePath, extensions);
    return extensions.has(path.extname(entry.name)) ? [relativePath] : [];
  });
}

const files = [
  ...collectRuntimeFiles('extension', new Set(['.js'])),
  ...collectRuntimeFiles('lib', new Set(['.js'])),
  ...collectRuntimeFiles('supabase/functions', new Set(['.js', '.ts'])),
  ...collectRuntimeFiles('supabase/migrations', new Set(['.sql'])),
].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  assert.doesNotMatch(text, /\beval\s*\(/, `${file} must not use eval`);
  assert.doesNotMatch(text, /new\s+Function\s*\(/, `${file} must not use Function constructor`);

  if (file.endsWith('.js') && !file.startsWith('supabase' + path.sep)) {
    try {
      execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
    } catch (error) {
      assert.fail(`${file} must parse as standalone JavaScript: ${String(error.stderr || error.message).slice(0, 300)}`);
    }
  }
}
const background = await extensionSource();

// `completeWithRetry` used to be pinned here. It is gone because it is dead: the
// device no longer POSTs completions, so the retry ladder had no caller left and
// only pretended to be a safety net. What must be pinned instead is that a
// completion still has somewhere to go, and that it goes out on the socket.

for (const marker of ['pendingCompletion', 'flushPendingCompletion', 'createSocketClient', 'completionFrame']) {
  assert.ok(background.includes(marker), marker);
}
assert.doesNotMatch(background, /action: 'complete'/, 'the device must not report over HTTP again');
assert.doesNotMatch(background, /action: 'pull'/, 'the device must not ask for work over HTTP');
const content = fs.readFileSync(path.join(root, 'extension/content.js'), 'utf8');
for (const marker of ['password','one-time-code','cvv','cvc','type === \'file\'']) assert.ok(content.toLowerCase().includes(marker.toLowerCase()), marker);
const ensureContent = background.slice(background.indexOf('async function ensureContent'), background.indexOf('async function contentCall'));
assert.match(ensureContent, /method: 'content\.ping'/);
assert.doesNotMatch(ensureContent, /method: 'page\.read'/);
assert.match(content, /args\.includeElements !== false/);
assert.match(content, /case 'content\.ping'/);
const bridge = fs.readFileSync(path.join(root, 'supabase/functions/opera-agent-bridge/index.ts'), 'utf8');

assert.match(bridge, /rpc\("opera_claim_next_wait", \{/);
assert.doesNotMatch(bridge, /rpc\("opera_claim_next",/);
for (const marker of ['FAST_PULL_POLLS', 'FAST_PULL_INTERVAL_MS', 'IDLE_PULL_INTERVAL_MS']) {
  assert.ok(!bridge.includes(marker), `${marker} must not return to the bridge`);
}
const runner = fs.readFileSync(path.join(root, 'supabase/functions/opera-agent-runner/index.ts'), 'utf8');
for (const marker of ['opera_await', 'normalizeAwaitTiming', 'SAFE_RETRY_DELAY_MS', 'transientFailure', 'MAX_PARALLEL_ITEMS', 'createWorkflowMetrics', 'recordCommandMetrics', 'intentionalWaitMs']) assert.ok(runner.includes(marker), marker);
assert.doesNotMatch(runner, /\.from\("opera_commands"\)/);
assert.doesNotMatch(runner, /COMMAND_POLL_(?:MIN|MAX)_MS/);
const mcp = fs.readFileSync(path.join(root, 'supabase/functions/opera-agent-mcp/index.ts'), 'utf8');

const mcpVersion = /const SERVER_VERSION = "([0-9]+\.[0-9]+\.[0-9]+)"/.exec(mcp);
assert.ok(mcpVersion, 'the MCP server must declare a three-part version it can be compared on');
assert.equal(mcpVersion[1], manifest.version, 'the version the MCP server reports must be the released one');
assert.match(mcp, /\{ name: "opera-agent", version: SERVER_VERSION \}/, 'the declared version must be the one handed to the MCP server');

const secretLiteral = /const SECRET_VALUE = \/\(\?:-----BEGIN/;
for (const file of files) {
  if (file.replace(/\\/g, '/') === 'lib/secret-pattern.js') continue;
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  assert.doesNotMatch(text, secretLiteral, `${file} must import SECRET_VALUE from lib/secret-pattern.js, not declare it`);
}

const storeManifest = JSON.parse(fs.readFileSync(path.join(root, 'store/store-manifest.json'), 'utf8'));
assert.equal(storeManifest.version, `${manifest.version}.0`, 'the store form carries the released version plus the store-required fourth part');
assert.equal(storeManifest.key, undefined, 'the store form must not carry the signing key');
assert.equal(storeManifest.update_url, undefined, 'the store form must not carry the update url');
for (const field of ['permissions', 'host_permissions', 'content_scripts', 'background', 'action',
  'options_page', 'externally_connectable', 'content_security_policy']) {
  assert.deepEqual(storeManifest[field], manifest[field], `store/store-manifest.json ${field} drifted from extension/manifest.json`);
}
assert.match(mcp, /method === "page\.capture" \? "opera_await_capture" : "opera_await_adaptive"/);

assert.doesNotMatch(mcp, /: "opera_await"/);
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
console.log(`check ok: ${ALLOWED_METHODS.length} allowlisted browser primitives, ${files.length} runtime safety files, version ${manifest.version}`);
