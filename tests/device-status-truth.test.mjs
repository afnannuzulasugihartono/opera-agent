import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectSources, stripComments } from './helpers/source-scan.mjs';

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
//
// Comments are stripped before scanning. The runbook rule and the gateway header
// comment both *describe* the disabled state in prose, and a lock that fires on a
// sentence describing the behaviour is a lock nobody trusts.

const repoRoot = new URL('../', import.meta.url);
const runbook = await readFile(new URL('docs/runbook.md', repoRoot), 'utf8');

// Every shape by which a source could assign the literal to a device status.
//
// KNOWN LIMITS, so nobody over-reads this lock.
//
// SCOPE: the roots below are the runtime trees. They are the same roots
// `scripts/check.mjs` walks, so a source added outside them would not be scanned.
// A writer in any other directory is not detected by this lock.
//
// VALUE FOLLOWING: it does NOT see a value passed through a variable
// (`const s = 'disabled'; update({ status: s })`), a parameter bound from an array
// (`set status = $1` with $1 = 'disabled'), a value assembled at runtime
// (`concat('dis','abled')`), or a row read back out of JSON. It also does not see
// a writer written as a CASE expression, a positional INSERT with no `=`, a quoted
// identifier (`set "status" = ...`), or a quoted JSON key. Those are deliberate: a
// lock that tried to follow values would have to model evaluation, and a lock that
// guessed would fail on correct code. What this DOES catch is the plain and
// overwhelmingly likely form, which is the form the audit request proposes.
const DISABLE_WRITER = [
  // Raw SQL assignment: status = 'disabled' / status='disabled' / status = "disabled".
  // A read filter (`where status = 'disabled'`) is excluded, because the repository
  // contains many of those and they are not writers.
  /(?<!where\s)(?<!,\s)status\s*=\s*['"`]disabled['"`]/i,
  // Object literal / SDK update: { status: 'disabled' } in any quote style,
  // including a prefixed parameter name such as { p_status: 'disabled' }.
  /[\w.]*status\s*:\s*['"`]disabled['"`]/i,
  // A writer parameterised on status whose default is the literal. The name may
  // carry a prefix (`p_status`, `p_device_status`), which a plain \bstatus\b cannot
  // match because `_` is a word character.
  /[\w.]*status\b[^\n;]{0,80}?\bdefault\s+['"`]disabled['"`]/i
];

// The same roots `scripts/check.mjs` discovers runtime files under, so the lock's
// coverage cannot drift away from what the repository already treats as runtime.
const RUNTIME_ROOTS = [
  { dir: 'supabase/migrations/', ext: ['.sql'] },
  { dir: 'supabase/functions/', ext: ['.ts', '.js'] },
  { dir: 'extension/', ext: ['.js'] },
  { dir: 'lib/', ext: ['.js'] },
  { dir: 'scripts/', ext: ['.mjs', '.js'] }
];

const sources = (await Promise.all(
  RUNTIME_ROOTS.map(({ dir, ext }) => collectSources(new URL(dir, repoRoot), ext))
)).flat().map(({ name, url, src }) => ({
  name, url, code: stripComments(src, url.pathname.endsWith('.sql') ? 'sql' : 'javascript')
}));

test('no runtime source assigns status = disabled to a device row', () => {
  const writers = sources
    .filter(({ code }) => DISABLE_WRITER.some((pattern) => pattern.test(code)))
    .map(({ name }) => name);
  assert.deepEqual(
    writers,
    [],
    'a source now assigns the literal disabled to a device status. That invalidates the '
    + 'runbook rule that only a human with direct database access can disable a device. '
    + 'Reconcile docs/runbook.md, and consider whether the extension Unpair action '
    + 'should now revoke server-side.'
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

test('prose describing the disabled state does not trip the lock', () => {
  // Guards the lock itself, on a self-contained string so that when the real
  // lock fires, exactly one test fails and points at the cause.
  const described = stripComments(
    "-- a human may set status = 'disabled' by hand\n"
    + "/* { status: 'disabled' } is what the operator writes in SQL */\n"
    + "const hint = { 'disabled': 'Disabled' };\n",
    'sql'
  );
  assert.doesNotMatch(described, /status\s*=\s*['"`]disabled['"`]/i);
  assert.doesNotMatch(described, /status\s*:\s*['"`]disabled['"`]/i);
  assert.ok(described.includes("'disabled': 'Disabled'"), 'a non-status key is not a writer');

  // And the raw, unstripped text WOULD have matched -- otherwise this test would
  // pass for the wrong reason.
  const raw = "-- a human may set status = 'disabled' by hand\n";
  assert.match(raw, /status\s*=\s*['"`]disabled['"`]/i, 'the pattern does match real code');
});

test('the device status constraint still admits the unreachable-by-code value', () => {
  const core = sources.find((s) => s.name === '20260907204146_opera_agent_1_0_0_core.sql');
  assert.ok(core, 'the core migration is present');
  assert.match(
    core.code,
    /check \(status in \('offline','online','disabled'\)\)/,
    'the status constraint still lists disabled, so direct SQL remains the only way to set it'
  );
});
