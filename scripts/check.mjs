import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ALLOWED_METHODS, PRODUCT_VERSION } from '../extension/lib/protocol.js';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.name, 'Opera Agent');
assert.equal(manifest.version, '1.0.1');
assert.equal(PRODUCT_VERSION, '1.0.1');
assert.equal(pkg.version, '1.0.1');
assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.permissions.includes('debugger'));
assert.ok(manifest.permissions.includes('storage'));
assert.equal(ALLOWED_METHODS.length, 23);
assert.match(manifest.update_url, /^https:\/\/.*\.supabase\.co\//);
assert.ok(typeof manifest.key === 'string' && manifest.key.length > 100);

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
  'supabase/migrations/20260908133000_opera_agent_efficiency_workflows.sql'
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
const bridge = fs.readFileSync(path.join(root, 'supabase/functions/opera-agent-bridge/index.ts'), 'utf8');
for (const marker of ['FAST_PULL_POLLS', 'FAST_PULL_INTERVAL_MS', 'IDLE_PULL_INTERVAL_MS']) assert.ok(bridge.includes(marker), marker);
const efficiency = fs.readFileSync(path.join(root, 'supabase/migrations/20260908133000_opera_agent_efficiency_workflows.sql'), 'utf8');
for (const marker of ['research.read_current_full', 'research.read_url_full', 'youtube.get_transcript', '"limit":12000', '"maxElements":1']) assert.ok(efficiency.includes(marker), marker);
const updateFunction = fs.readFileSync(path.join(root, 'supabase/functions/opera-agent-update/index.ts'), 'utf8');
for (const marker of ['opera_update_events', 'update_xml', 'passiveUpdateTelemetry']) assert.ok(updateFunction.includes(marker), marker);
console.log(`check ok: ${ALLOWED_METHODS.length} allowlisted browser primitives, version ${manifest.version}`);
