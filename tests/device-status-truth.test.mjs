import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

// Frozen contract: the operator runbook tells the reader that a device row with
// status = 'disabled' can only have been disabled by a human with direct
// database access, because nothing in this repository writes that value. That is
// a load-bearing instruction -- it is why re-enabling a disabled device is
// owner-only -- so it must not quietly become false.
//
// This lock is deliberately INVERTED relative to the other drift locks: instead
// of pinning a value that must match, it pins the ABSENCE of a writer. If someone
// adds a write path, this test fails on purpose and tells them to reconcile the
// runbook rather than leaving the two disagreeing.

const repoRoot = new URL('../', import.meta.url);
const runbook = await readFile(new URL('docs/runbook.md', repoRoot), 'utf8');

// Any statement that assigns the literal to a device status column.
const DISABLE_WRITER = [
  /status\s*=\s*'disabled'/i,
  /set\s+[^;]*status\s*=\s*'disabled'/i,
  /'disabled'\s*:\s*/i
];

async function collectSources(dir, extensions) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) {
      out.push(...await collectSources(url, extensions));
      continue;
    }
    if (extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push({ name: entry.name, url, src: await readFile(url, 'utf8') });
    }
  }
  return out;
}

const sources = [
  ...await collectSources(new URL('supabase/migrations/', repoRoot), ['.sql']),
  ...await collectSources(new URL('supabase/functions/', repoRoot), ['.ts', '.js']),
  ...await collectSources(new URL('extension/', repoRoot), ['.js'])
];

test('no repository source assigns status = disabled to a device row', () => {
  const writers = [];
  for (const { name, url, src } of sources) {
    if (DISABLE_WRITER.some((pattern) => pattern.test(src))) writers.push(name);
  }
  assert.deepEqual(
    writers,
    [],
    'a source now writes status = \'disabled\'. That invalidates the runbook rule that only '
    + 'a human with direct database access can disable a device. Reconcile docs/runbook.md, '
    + 'and consider whether the extension Unpair action should now revoke server-side.'
  );
});

test('the runbook still states the owner-only disable rule', () => {
  assert.match(
    runbook,
    /nothing in this repository writes `disabled`/,
    'docs/runbook.md must keep stating that no repository source disables a device'
  );
  assert.match(
    runbook,
    /Re-enabling one is owner-only/,
    'docs/runbook.md must keep stating that re-enabling a disabled device is owner-only'
  );
});

test('the device status constraint still admits the unreachable-by-code value', async () => {
  const core = sources.find((s) => s.name === '20260907204146_opera_agent_1_0_0_core.sql');
  assert.ok(core, 'the core migration is present');
  assert.match(
    core.src,
    /check \(status in \('offline','online','disabled'\)\)/,
    'the status constraint still lists disabled, so direct SQL remains the only way to set it'
  );
});