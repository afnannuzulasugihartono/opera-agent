// @last-edited: 2026-11-05 UTC+7.
// @title: release-workflow — the tag workflow publishes a release a buyer can download, and points Latest at the newest version.
// @state: the release step runs against a stub gh; it uploads four files, fails when one is missing, publishes a draft, and takes the Latest mark only when it is the newest version.
// @dependencies: node:test, node:assert, node:fs, node:os, node:path, node:child_process.

// WHY THE STEP IS RUN AND NOT READ.
// Measured on 2026-10-25: the tags v1.6.25 and v1.6.26 published releases with no assets, and GitHub pointed "Latest" at the newest one by date, so a buyer who clicked the download button got nothing.
// The workflow cannot be proved by reading it, so the step is executed against a stub gh that answers as the repository does, and the calls it makes are what the lock checks.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
const workflow = read('.github/workflows/release.yml');

const BASH = findBash();

function findBash() {
  const candidates = [
    process.env.SHELL,
    'bash',
    'C:/Program Files/Git/bin/bash.exe',
    'C:/Program Files/Git/usr/bin/bash.exe'
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'echo ok'], { encoding: 'utf8' });
    if (probe.status === 0 && String(probe.stdout).trim() === 'ok') return candidate;
  }
  return null;
}

function releaseStep() {
  const lines = workflow.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*- name:/.test(lines[i]) || !/release/i.test(lines[i])) continue;
    let runAt = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^\s*- name:/.test(lines[j])) break;
      if (/^\s*run:\s*\|\s*$/.test(lines[j])) {
        runAt = j;
        break;
      }
    }
    if (runAt === -1) continue;
    const indent = /^\s*/.exec(lines[runAt])[0].length + 2;
    const body = [];
    for (let j = runAt + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === '') {
        body.push('');
        continue;
      }
      const lineIndent = /^\s*/.exec(line)[0].length;
      if (lineIndent < indent) break;
      body.push(line.slice(indent));
    }
    return body.join('\n');
  }
  return null;
}

const STUB = `
gh() {
  echo "$*" >> "$GH_LOG"
  case "$*" in
    *"--json assets"*) echo "\${GH_ASSET_COUNT:-0}"; return 0 ;;
    *"release list"*) cat "$GH_TAGS"; return 0 ;;
    *"release view"*) return "\${GH_VIEW_STATUS:-0}" ;;
  esac
  return 0
}
`;

function runStep({ version = '1.6.27', assetCount = 4, viewStatus = 0, tags = ['v1.6.25', 'v1.6.26', 'v1.6.27'] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-workflow-'));
  const log = path.join(dir, 'gh.log');
  const tagFile = path.join(dir, 'tags.txt');
  fs.writeFileSync(log, '');
  fs.writeFileSync(tagFile, tags.join('\n') + '\n');
  for (const name of [
    `Opera-Agent-${version}-extension.zip`,
    `Opera-Agent-${version}-source.zip`,
    `Opera-Agent-${version}.crx`,
    'SHA256SUMS'
  ]) {
    fs.writeFileSync(path.join(dir, name), 'x');
  }
  const script = path.join(dir, 'step.sh');
  fs.writeFileSync(script, `${STUB}\n${releaseStep()}\n`);
  const run = spawnSync(BASH, ['--noprofile', '--norc', '-eo', 'pipefail', script], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_LOG: log,
      GH_TAGS: tagFile,
      GH_ASSET_COUNT: String(assetCount),
      GH_VIEW_STATUS: String(viewStatus),
      VERSION: version,
      TAG: `v${version}`,
      GITHUB_SHA: '0'.repeat(40)
    }
  });
  const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, calls };
}

const skip = BASH ? false : 'no bash on this machine';

test('a release with no assets fails the run, because a dead download is worse than no release', { skip }, () => {
  const run = runStep({ assetCount: 0 });
  assert.notEqual(run.status, 0, 'the run fails');
  const upload = run.calls.find((line) => line.startsWith('release upload'));
  assert.ok(upload, 'the workflow uploads the files');
  for (const asset of ['-extension.zip', '-source.zip', '.crx', 'SHA256SUMS']) {
    assert.ok(upload.includes(asset), `the upload carries ${asset}`);
  }
  assert.match(run.stderr + run.stdout, /assets/, 'and it says what was missing');
});

test('a complete release is published, and takes the Latest mark when it is the newest version', { skip }, () => {
  const run = runStep({ assetCount: 4 });
  assert.equal(run.status, 0, 'the run passes');
  assert.ok(run.calls.some((line) => line === 'release edit v1.6.27 --draft=false'), 'a draft is published');
  assert.ok(run.calls.some((line) => line === 'release edit v1.6.27 --latest'), 'the newest version is the Latest release');
});

test('an older tag does not take the Latest mark, because GitHub points Latest at the newest date', { skip }, () => {
  const run = runStep({ assetCount: 4, tags: ['v1.6.27', 'v1.6.28'] });
  assert.equal(run.status, 0, 'the run passes');
  assert.ok(run.calls.some((line) => line === 'release edit v1.6.27 --draft=false'), 'the release is still published');
  assert.ok(!run.calls.some((line) => line.includes('--latest')), 'and it leaves the Latest mark where it is');
});

test('a release that does not exist yet is created with its four files', { skip }, () => {
  const run = runStep({ assetCount: 4, viewStatus: 1 });
  assert.equal(run.status, 0, 'the run passes');
  const create = run.calls.find((line) => line.startsWith('release create'));
  assert.ok(create, 'the workflow creates the release');
  for (const asset of ['-extension.zip', '-source.zip', '.crx', 'SHA256SUMS']) {
    assert.ok(create.includes(asset), `the creation carries ${asset}`);
  }
});
