// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: scope-preflight.test — Test..
// @context: Test.
// @state: Test..
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: node:test, strict, node:child_process, node:url.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Scope preflight (2026-10-04, owner-ordered).
//
// The problem this exists for: the repository is roughly 0.94M tokens against a
// 1M window, and docs+tests are two thirds of it. Reading broadly drains the
// window before any code is touched, which is where hallucination starts. An
// agent that reads everything is the failure mode; this makes the cheap,
// bounded alternative the mechanical one.
//
// Verified behavior, not source shape: the script is run as a child process and
// its JSON is asserted.

const script = fileURLToPath(new URL('../scripts/scope.mjs', import.meta.url));

function scope(task, extra = []) {
  const out = execFileSync(process.execPath, [script, task, '--json', ...extra], {
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

test('a task returns a bounded, ranked set of runtime files', () => {
  const result = scope('burst navigate');
  assert.ok(result.files.length > 0, 'a real task must match something');
  assert.ok(
    result.files.length <= (result.limit || 12),
    `output must respect the limit, got ${result.files.length}`
  );
  // Ranked by relevance, so the strongest match leads.
  assert.ok(result.files[0].path.startsWith('extension/') || result.files[0].path.startsWith('lib/'));
});

test('the whole repository is never the recommended read set', () => {
  const result = scope('burst navigate');
  // Runtime source is deliberately small — ~57 files. The haystack that
  // actually drains the window is the whole tracked repository, docs and
  // tests included, so the saving is measured against that.
  assert.ok(result.wholeRepoTokens > 500_000, `haystack should be ~0.9M tokens, got ${result.wholeRepoTokens}`);
  assert.ok(
    result.totalTokens < result.wholeRepoTokens / 10,
    `scoped set ${result.totalTokens} tokens must stay under 10% of ${result.wholeRepoTokens}`
  );
  // Measured: runtime source alone is ~60K tokens, ~6% of the repository. The
  // 94% that is docs, tests and records is the part an agent must never sweep in.
  assert.ok(
    result.runtimeTokens < result.wholeRepoTokens / 5,
    'runtime source is a small share of the repository by design'
  );
});

test('large files are flagged so they are never read whole', () => {
  const result = scope('burst navigate');
  for (const file of result.files) {
    if (file.lines > 500) assert.equal(file.readWhole, false, `${file.path} must not be marked read-whole`);
  }
  // background.js is 1809 lines; if a task matches it, the flag must appear.
  const big = result.files.find((f) => f.lines > 500);
  if (big) assert.ok(big.hint.length > 0, 'a large file must carry a read-slice hint');
});

test('docs and tests are never auto-included', () => {
  const result = scope('burst navigate');
  for (const file of result.files) {
    assert.ok(
      !file.path.startsWith('docs/') && !file.path.startsWith('tests/'),
      `guidance surface leaked into the read set: ${file.path}`
    );
  }
});

test('an unmatched task returns an empty set rather than everything', () => {
  const result = scope('zzzqqqxxnothingmatcheszzz');
  assert.deepEqual(result.files, [], 'no matches must mean no files, never a dump');
});