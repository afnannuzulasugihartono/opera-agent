// @last-edited: 2026-10-25 UTC+7.
// @title: professional — the files a repository is expected to carry, and the lines they must hold.
// @state: six gates: the standard files exist, the README's numbers are measured, CI runs on every pull request, the tree is LF, a live document names no file that is not there, and the handoff keeps its stated line cap.
// @dependencies: node:test, node:assert/strict, node:fs, node:path, node:child_process.

// WHY THIS FILE EXISTS.
// A repository is read by people who were not there when it was built: one opening it for the first time, one reporting a defect, one checking whether a release is safe to run, and one reviewing a pull request.
// Each of them needs a file that answers their question, and each answer has to be true today.
// The standard files are therefore checked for presence, and what they say is checked against the tree rather than trusted.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const repo = (p) => new URL(p, root);
const read = (name) => fs.readFileSync(repo(name), 'utf8');
const exists = (name) => fs.existsSync(repo(name));

test('the repository carries the files a reader and a reviewer need', () => {
  const required = {
    'README.md': 'what this is, and how to run it',
    'CONTRIBUTING.md': 'what a change has to look like, and how a reviewer reads it',
    'CHANGELOG.md': 'what each release contained',
    'SECURITY.md': 'the private route for a vulnerability, where GitHub renders it',
    'LICENSE': 'the terms the code is under',
    '.gitignore': 'what never enters the tree',
    '.gitattributes': 'how the tree is stored, line ending by line ending',
    '.editorconfig': 'what every editor agrees on',
    '.github/pull_request_template.md': 'what a reviewer needs before reading the diff',
    '.github/ISSUE_TEMPLATE/bug_report.md': 'where a defect report goes',
    '.github/CODEOWNERS': 'who has to look at a change before it lands',
    'gates.lock': 'the acceptance surface, pinned',
  };
  const missing = Object.entries(required)
    .filter(([file]) => !exists(file))
    .map(([
      file,
      purpose
    ]) => `${file} (${purpose})`);
  assert.deepEqual(missing, [], `a repository without these cannot be read or reviewed:\n${missing.join('\n')}`);
});

test('the standard files are not empty and do not point at nothing', () => {
  for (const file of ['README.md', 'CONTRIBUTING.md', 'SECURITY.md']) {
    const body = read(file);
    assert.ok(body.split('\n').filter((line) => line.trim()).length >= 20,
      `${file} must carry a real document, not a heading`);
  }
  const changelog = read('CHANGELOG.md');
  assert.ok(changelog.split('\n').filter((line) => line.trim()).length >= 12,
    'CHANGELOG.md must carry the release table, not a heading');
  for (const file of ['CONTRIBUTING.md', 'CHANGELOG.md', 'SECURITY.md']) {
    const body = read(file);
    assert.ok(body.includes('AGENTS.md') || body.includes('docs/'),
      `${file} must point at the documents that hold the detail`);
  }
});

test('the release notes the changelog lists are the ones in the tree', () => {
  const listed = [...read('CHANGELOG.md').matchAll(/\(docs\/releases\/([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(listed.length >= 3, 'the changelog must list the releases that shipped');
  for (const note of listed) {
    assert.ok(exists(`docs/releases/${note}`), `the changelog names ${note}, which is not in the tree`);
  }
});

test('CI runs on every pull request, not only the ones that target main', () => {
  const workflow = read('.github/workflows/ci.yml');
  const trigger = /on:\n([\s\S]*?)\npermissions:/.exec(workflow)?.[1] ?? '';
  assert.ok(/pull_request:/.test(trigger), 'CI must run on pull requests');
  const pullRequestBlock = /pull_request:(\n\s+[^\n]+)*/.exec(trigger)?.[0] ?? '';
  assert.ok(!/branches:/.test(pullRequestBlock),
    'CI must run on every pull request: a gate that only runs against main runs for none of a stacked series');
  for (const job of ['unit', 'secret-scan', 'browser']) {
    assert.ok(new RegExp(`^  ${job}:`, 'm').test(workflow), `the ${job} job must exist`);
  }
});

test('the tree is stored with LF line endings, and says so', () => {
  const attributes = read('.gitattributes');
  assert.match(attributes, /\*\s+text=auto eol=lf/,
    'the attributes must pin text to LF, or a Windows checkout moves the bytes a pin protects');
  const tracked = execFileSync('git', [
    'ls-files',
    '--eol'
  ], {
    cwd: repo('.'),
    encoding: 'utf8'
  })
    .split('\n').filter(Boolean);
  const crlf = tracked.filter((line) => /\bi\/crlf|\bw\/crlf/.test(line));
  assert.deepEqual(crlf, [],
    `these files are stored with CRLF while the rest of the tree is LF:\n${crlf.join('\n')}`);
});

test('a live document names no file that is not in the tree', () => {
  const tracked = execFileSync('git', ['ls-files'], {
    cwd: repo('.'),
    encoding: 'utf8'
  })
    .split('\n').filter(Boolean);
  const set = new Set(tracked);

  // Dated records describe a point in time; the live documents must be true now.

  const live = tracked.filter((file) => {
    if (file === 'README.md' || file === 'AGENTS.md') return true;
    if (!file.startsWith('docs/')) return false;
    return !file.startsWith('docs/releases/') && !file.startsWith('docs/superpowers/');
  });
  const dead = [];
  for (const file of live) {
    const body = read(file);
    const dir = path.posix.dirname(file);
    for (const match of body.matchAll(/`((?:extension|lib|local|tests|supabase|docs|scripts|landing|store)\/[A-Za-z0-9_./-]+\.(?:js|mjs|ts|py|sql|html|css|json|md|yml|yaml|toml|cmd|example))`/g)) {
      const named = match[1].replace(/[.,;:'")`]+$/, '');
      if (!set.has(named)) dead.push(`${file} names ${named}`);
    }
    for (const match of body.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^(?:[a-z]+:|\/)/i.test(target)) continue;

      // A link may point at a directory, which git does not list.

      const resolved = path.posix.normalize(path.posix.join(dir, target));
      if (set.has(resolved)) continue;
      if (fs.existsSync(repo(resolved))) continue;
      dead.push(`${file} links to ${target}`);
    }
  }
  assert.deepEqual(dead, [],
    `a document that points at a file that is not there cannot be trusted:\n${dead.join('\n')}`);
});

// WHY THE HANDOFF'S OWN CAP IS A GATE.
// The file states a cap, and it had drifted past it because nothing measured the number: a reader trusts a document that names its own limit, and a limit it breaks costs the rest of it credibility.
// So the number the file states is the number this test holds, and raising the cap means editing both in one change.

test('the handoff keeps the line cap it states', () => {
  const body = read('docs/handoff.md');
  const stated = /Cap (\d+) lines/.exec(body)?.[1];
  assert.ok(stated, 'the handoff must state its cap, so the gate has a number to hold');
  const lines = body.split('\n');
  const content = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  assert.ok(content <= Number(stated), `docs/handoff.md is ${content} lines; its cap says ${stated}`);
});
