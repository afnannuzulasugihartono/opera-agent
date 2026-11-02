// @last-edited: 2026-11-02 UTC+7.
// @title: branch-name — the shape a work branch takes, and the refusals the worktree script owes a caller.
// @state: the shape, the tidy form, the branch a worktree gets, the report, and the refusals proved by running the script.
// @dependencies: node:test, node:assert/strict, node:child_process, node:fs, node:path, node:url, ../scripts/branch-name.mjs.

// WHY THIS FILE EXISTS.
// The branch namespace on this repository had forty-odd names and four conventions: `agent/sitebench/sitebench` said its topic twice, `cline/6m4r5na4` named no work, and `wip/shared-checkout-2026-10-28` was a shape written by hand.
// The script that makes worktrees is where those names come from, so the rule is tested there: a shape the script builds, a shape a report accepts, and a refusal instead of a git stack trace when a name cannot become one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { branchLines, branchProblem, normaliseBranch, reviewBranches, slugWord, workBranch, WORK_PREFIX } from '../scripts/branch-name.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = join(root, 'scripts', 'agent-worktree.mjs');

// WHY THE RUNNING IS DONE WITH A SPAWN INSTEAD OF AN IMPORT.
// A refusal is a sentence and an exit code, and neither exists until the program runs.
// The cases below are the ones that used to end in a git stack trace or in a sentence that was not true.

const run = (...args) => {
  try {
    return { status: 0, out: execFileSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (error) {
    return { status: error.status ?? 1, out: String(error.stderr ?? '') };
  }
};

test('a work branch is the worktree and an optional topic, and the trunk is the trunk', () => {
  for (const name of ['main', 'agent/cline', 'agent/cline/dead-code', 'agent/multi/mechanism-multi-sesi', 'agent/operafetch']) {
    assert.equal(branchProblem(name), null, `${name} is the shape`);
  }
});

test('a name outside the shape says which segment broke which rule', () => {
  const cases = [
    ['cline/6m4r5nzz', 'does not start with agent/'],
    ['agent/SiteBench/operafetch', 'lowercase'],
    ['agent/site_bench', 'lowercase'],
    ['agent/sitebench/sitebench', 'names its topic twice'],
    ['agent/sitebench/click/nav', 'segments'],
    ['agent/', 'lowercase'],
    ['', 'needs a name'],
  ];
  for (const [name, fragment] of cases) {
    const problem = branchProblem(name);
    assert.equal(typeof problem, 'string', `${name} must be refused`);
    assert.ok(problem.includes(fragment), `${name} must say "${fragment}", and it said: ${problem}`);
  }
});

test('the tidy form of a messy name is the shape it should have had', () => {
  const tidy = {
    'agent/sitebench/sitebench': 'agent/sitebench',
    'agent/operafetch/operafetch': 'agent/operafetch',
    'cline/6m4r5nzz': 'agent/cline/6m4r5nzz',
    'agent/Opera Fetch/Opera Fetch': 'agent/opera-fetch',
    'wip/shared-checkout-2026-10-28': 'agent/wip/shared-checkout-2026-10-28',
  };
  for (const [messy, wanted] of Object.entries(tidy)) {
    assert.equal(normaliseBranch(messy), wanted, `${messy} should be ${wanted}`);
    assert.equal(branchProblem(normaliseBranch(messy)), null, `${wanted} must itself be in the shape`);
  }
});

test('the branch a worktree gets is built from the two names, and a repeated topic collapses', () => {
  assert.equal(workBranch('sitebench', 'nav-menu'), 'agent/sitebench/nav-menu');
  assert.equal(workBranch('Site Bench'), 'agent/site-bench');
  assert.equal(workBranch('operafetch', 'operafetch'), 'agent/operafetch');
  assert.equal(workBranch('cline', '  '), 'agent/cline');
  assert.throws(() => workBranch('***'), /is not a name/);
  assert.throws(() => workBranch('cline', '***'), /is not a topic/);
  assert.equal(slugWord('Opera Agent 2'), 'opera-agent-2');
  assert.equal(WORK_PREFIX, 'agent');
});

test('the report splits the branches, and only the trunk and the shape are called ok', () => {
  const review = reviewBranches(['main', 'agent/cline', 'cline/6m4r5nzz', 'agent/sitebench/sitebench', '', 'HEAD']);
  assert.deepEqual(review.ok, ['main', 'agent/cline']);
  assert.deepEqual(review.tidy, [
    { name: 'cline/6m4r5nzz', suggestion: 'agent/cline/6m4r5nzz' },
    { name: 'agent/sitebench/sitebench', suggestion: 'agent/sitebench' },
  ]);
});

test('the branch list loses the markers instead of carrying them into a tag', () => {
  const listed = '* agent/cline/dead-code\n  agent/cline\n+ agent/probe/end-to-end\n\n';
  assert.deepEqual(branchLines(listed), ['agent/cline/dead-code', 'agent/cline', 'agent/probe/end-to-end']);
  assert.deepEqual(branchLines(''), []);
});

test('the worktree script builds its branch from this contract instead of a string of its own', () => {
  const body = readFileSync(script, 'utf8');
  assert.match(body, /from '\.\/branch-name\.mjs'/, 'the script imports the shape');
  assert.match(body, /workBranch\(wanted, topic\)/, 'the branch is the shape, not a template');
  assert.doesNotMatch(body, /topic = wanted/, 'the topic no longer defaults to the worktree name');
});

test('a name that cannot become a branch is refused in one sentence, before git is asked', () => {
  const refused = run('create', '***');
  assert.equal(refused.status, 1);
  assert.match(refused.out, /is not a name/);
  assert.doesNotMatch(refused.out, /fatal:/, 'git is never asked for an invalid name');
});

test('a base that is not in this checkout is named as the reason, and no worktree is made', () => {
  const at = `probe-${process.pid}`;
  const outside = join(root, '..', `opera-agent-${at}`);
  const refused = run('create', at, 'no-such-base');
  assert.equal(refused.status, 1);
  assert.match(refused.out, /no branch or commit named no-such-base/);
  assert.equal(existsSync(outside), false, 'a refused create leaves the disk alone');
});

test('removing a name that holds nothing says so instead of claiming an archive', () => {
  const refused = run('remove', `nothing-here-${process.pid}`);
  assert.equal(refused.status, 1);
  assert.match(refused.out, /nothing named nothing-here-/);
  assert.doesNotMatch(refused.out, /live on under archive/, 'a sentence about an archive has to be about one');
});

test('the list command runs and marks the shared checkout', () => {
  const listed = run('list');
  assert.equal(listed.status, 0);
  assert.match(listed.out, /main checkout, never drive from here/, 'the shared checkout is still marked');
});
