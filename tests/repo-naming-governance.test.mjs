import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// AGENTS.md "Naming conventions (binding)" enforcement. A failure here is a
// real naming violation: fix the name, or extend an explicit allowlist in the
// same commit with a recorded reason. Do not weaken these assertions.

const ALLOWED_ROOT_ENTRIES = new Set([
  '.agents', '.github', 'docs', 'extension', 'lib',
  'oauth-consent', 'release-trigger', 'scripts', 'supabase', 'tests',
  '.gitignore', '.env.example', '.gitleaks.toml',
  'AGENTS.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE', 'README.md',
  'ROADMAP.md', 'SECURITY.md', 'SUPPORT.md', 'opencode.json', 'package.json',
]);

const JUNK_TOKEN =
  /(^|[-_.])(tmp|temp|draft|wip|untitled|backup|copy|old|final[0-9]*)([-_.]|$)/i;
const ENTRYPOINT_EXEMPT_PREFIXES = ['scripts/', '.agents/'];
const BRANCH_PATTERN =
  /^(main|release\/\d+\.\d+\.\d+|(feat|fix|chore|docs|test|perf|refactor)\/[a-z0-9-]+)$/;

function trackedFiles() {
  return execSync('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function currentBranch() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    return branch === 'HEAD' ? null : branch;
  } catch {
    return null;
  }
}

test('repository root contains only allowlisted entries, and every allowlisted entry exists', () => {
  // Judge TRACKED entries, not raw disk listings: machine-local agent-tool
  // state (.kilo/, graphify-out/) and OS noise must not fail governance on a
  // developer machine while the repository itself stays clean. Untracked
  // droppings are the concern of .gitignore (enforced below).
  const root = trackedFiles()
    .map((file) => file.split('/')[0])
    .filter((name) => name !== '.git');
  const disk = readdirSync(new URL('..', import.meta.url)).filter((name) => name !== '.git');
  const unexpected = [...new Set(root)].filter((name) => !ALLOWED_ROOT_ENTRIES.has(name));
  assert.deepEqual(
    unexpected,
    [],
    `unexpected tracked root entries (move them into their proper directory, or extend the allowlist with a recorded reason): ${unexpected.join(', ')}`
  );
  const missing = [...ALLOWED_ROOT_ENTRIES].filter((name) => !disk.includes(name));
  assert.deepEqual(missing, [], `allowlisted root entries that no longer exist: ${missing.join(', ')}`);
  const untrackedButUngnored = disk.filter(
    (name) => !ALLOWED_ROOT_ENTRIES.has(name) && !name.startsWith('.') && execSync(`git check-ignore -q "${name}" || echo untracked`, { encoding: 'utf8' }).trim() === 'untracked'
  );
  assert.deepEqual(
    untrackedButUngnored,
    [],
    `root entries are neither tracked, allowlisted, nor gitignored: ${untrackedButUngnored.join(', ')} (add them to .gitignore or remove them)`
  );
});

test('tracked filenames never carry process-lifecycle tokens', () => {
  const offenders = trackedFiles().filter((file) => JUNK_TOKEN.test(file.split('/').pop()));
  assert.deepEqual(
    offenders,
    [],
    `filenames describe content, not workflow state; rename: ${offenders.join(', ')}`
  );
});

test('markdown documents use lowercase kebab-case names', () => {
  const conventional = /^(README|AGENTS|SECURITY|CONTRIBUTING|CHANGELOG|ROADMAP|CODE_OF_CONDUCT|LICENSE|SUPPORT|HANDOFF|CONTEXT)\.md$|^SKILL\.md$/;
  const exemptPrefixes = ['.agents/'];
  const offenders = trackedFiles().filter((file) => {
    if (!file.endsWith('.md')) return false;
    if (conventional.test(file.split('/').pop())) return false;
    if (exemptPrefixes.some((prefix) => file.startsWith(prefix))) return false;
    return !/^[a-z0-9][a-z0-9.-]*\.md$/.test(file.split('/').pop());
  });
  assert.deepEqual(offenders, [], `non-kebab-case markdown names: ${offenders.join(', ')}`);
});

test('entrypoint scripts live under scripts/', () => {
  const offenders = trackedFiles().filter(
    (file) =>
      /\.(cmd|bat|ps1|sh)$/i.test(file) &&
      !ENTRYPOINT_EXEMPT_PREFIXES.some((prefix) => file.startsWith(prefix))
  );
  assert.deepEqual(offenders, [], `entrypoints outside scripts/: ${offenders.join(', ')}`);
});

test('the working branch follows the binding branch naming pattern', () => {
  const branch = process.env.CIRCLE_BRANCH || currentBranch();
  if (!branch) return; // detached checkout (tag/archive inspection): nothing to enforce
  assert.match(
    branch,
    BRANCH_PATTERN,
    `branch "${branch}" violates the binding naming rules in AGENTS.md; use main, release/<semver>, or feat|fix|chore|docs|test|perf|refactor/<kebab-description>`
  );
});
