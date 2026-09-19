import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// AGENTS.md "Naming conventions (binding)" enforcement. A failure here is a
// real naming violation: fix the name, or extend an explicit allowlist in the
// same commit with a recorded reason. Do not weaken these assertions.

const ALLOWED_ROOT_ENTRIES = new Set([
  '.agents', '.circleci', '.github', '.specify', 'docs', 'extension', 'lib',
  'oauth-consent', 'release-trigger', 'scripts', 'specs', 'supabase', 'tests',
  'tools', '.gitignore', 'AGENTS.md', 'CHANGELOG.md', 'CONTRIBUTING.md',
  'README.md', 'ROADMAP.md', 'SECURITY.md', 'package.json'
]);

const JUNK_TOKEN =
  /(^|[-_.])(tmp|temp|draft|wip|untitled|backup|copy|old|final[0-9]*)([-_.]|$)/i;
const JUNK_TOKEN_EXEMPT_PREFIXES = ['docs/releases/'];
const ENTRYPOINT_EXEMPT_PREFIXES = ['scripts/', '.specify/', '.agents/'];
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
  const root = readdirSync(new URL('..', import.meta.url)).filter((name) => name !== '.git');
  const unexpected = root.filter((name) => !ALLOWED_ROOT_ENTRIES.has(name));
  assert.deepEqual(
    unexpected,
    [],
    `unexpected root entries (move them into their proper directory, or extend the allowlist with a recorded reason): ${unexpected.join(', ')}`
  );
  const missing = [...ALLOWED_ROOT_ENTRIES].filter((name) => !root.includes(name));
  assert.deepEqual(missing, [], `allowlisted root entries that no longer exist: ${missing.join(', ')}`);
});

test('tracked filenames never carry process-lifecycle tokens', () => {
  const offenders = trackedFiles().filter(
    (file) =>
      !JUNK_TOKEN_EXEMPT_PREFIXES.some((prefix) => file.startsWith(prefix)) &&
      JUNK_TOKEN.test(file.split('/').pop())
  );
  assert.deepEqual(
    offenders,
    [],
    `filenames describe content, not workflow state; rename: ${offenders.join(', ')}`
  );
});

test('markdown documents use lowercase kebab-case names', () => {
  const conventional = /^(README|AGENTS|SECURITY|CONTRIBUTING|CHANGELOG|ROADMAP|CODE_OF_CONDUCT|LICENSE)\.md$|^SKILL\.md$/;
  const exemptPrefixes = ['.specify/', '.agents/', 'tools/repowise/'];
  const offenders = trackedFiles().filter((file) => {
    if (!file.endsWith('.md')) return false;
    if (conventional.test(file.split('/').pop())) return false;
    if (exemptPrefixes.some((prefix) => file.startsWith(prefix))) return false;
    return !/^[a-z0-9][a-z0-9.-]*\.md$/.test(file.split('/').pop());
  });
  assert.deepEqual(offenders, [], `non-kebab-case markdown names: ${offenders.join(', ')}`);
});

test('entrypoint scripts live under scripts/ (or vendored .specify/.agents layouts)', () => {
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
