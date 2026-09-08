import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ALLOWED_METHODS } from '../extension/lib/protocol.js';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
assert.equal(manifest.name, 'Opera Agent');
assert.equal(manifest.version, '1.0.0');
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
  'supabase/migrations/20260907204146_opera_agent_1_0_0_core.sql',
  'supabase/migrations/20260907204221_opera_agent_1_0_0_workflows.sql',
  'supabase/migrations/20260907204248_opera_agent_1_0_0_seed_workflows.sql',
  'supabase/migrations/20260908021000_opera_agent_releases.sql',
  'supabase/migrations/20260908025018_opera_agent_lock_internal_workflow_functions.sql',
  'supabase/migrations/20260908025218_opera_agent_command_method_index.sql'
];
for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  assert.doesNotMatch(text, /\beval\s*\(/, `${file} must not use eval`);
  assert.doesNotMatch(text, /new\s+Function\s*\(/, `${file} must not use Function constructor`);
}
const content = fs.readFileSync(path.join(root, 'extension/content.js'), 'utf8');
for (const marker of ['password','one-time-code','cvv','cvc','type === \'file\'']) assert.ok(content.toLowerCase().includes(marker.toLowerCase()), marker);
console.log(`check ok: ${ALLOWED_METHODS.length} allowlisted browser primitives`);
