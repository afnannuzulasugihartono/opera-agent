#!/usr/bin/env node

// @last-edited: 2026-11-12 UTC+7.
// @title: bump-version - one argument, every clock moves together, or none does.
// @state: the engine behind release-bump; applies the enumeration, recomputes the pins, scaffolds the release note and changelog row, stages everything, and runs the gates before it exits.
// @dependencies: node:fs, node:path, node:child_process, node:url, ../tests/helpers/canonical-source-hash.mjs, ./bump-version-lib.mjs.

// WHY THIS EXISTS.
// A release writes the version into more than fifteen files by hand, and the one forgotten clock reads as a broken release until CI catches it.
// The engine applies exactly the entries the library names, recomputes the pins from the rewritten contents, scaffolds what a human must still read, and fails loudly naming the file that disagrees.
// The button that calls this is .github/workflows/release-bump.yml; the guards that keep the table honest are tests/bump-version.test.mjs and the gates themselves.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256ContractSource } from '../tests/helpers/canonical-source-hash.mjs';
import { buildEnumeration, applyEntries, buildWhyBlock, buildChangelogRow, buildReleaseNote } from './bump-version-lib.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const arg = process.argv.slice(2).find((value) => value !== '--dry-run');

function fail(message) {
  console.error(`bump-version: ${message}`);
  process.exit(1);
}

try {

if (!arg || !/^\d+\.\d+\.\d+$/.test(arg)) fail('pass one version, e.g. node scripts/bump-version.mjs X.Y.Z');
  const newVersion = arg;

  const manifestPath = path.join(repo, 'extension/manifest.json');
  const current = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version;
  if (!/^\d+\.\d+\.\d+$/.test(current)) fail(`extension/manifest.json does not read a three-part version: ${current}`);
  if (current === newVersion) fail(`the tree already reads ${newVersion}`);

  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim();
  if (dirty) fail(`the tree is dirty; the bump must land as one reviewable diff:\n${dirty}`);

  const today = new Date().toISOString().slice(0, 10);
  const enumeration = buildEnumeration(current, newVersion);
  const byFile = new Map();
  for (const entry of enumeration) {
    byFile.set(entry.file, [...(byFile.get(entry.file) ?? []), entry]);
  }

  const writes = new Map();
  for (const [file, entries] of byFile) {
    const before = fs.readFileSync(path.join(repo, file), 'utf8');
    const after = applyEntries(before, entries);
    if (before !== after) writes.set(file, after);
  }

  const contentOf = (file) => (writes.has(file) ? writes.get(file) : fs.readFileSync(path.join(repo, file), 'utf8'));

  function sha1BlobText(text) {
    const content = Buffer.from(String(text).replace(/\r\n/g, '\n'), 'utf8');
    return crypto.createHash('sha1').update(Buffer.from(`blob ${content.length}\0`)).update(content).digest('hex');
  }

  const lockFile = path.join(repo, 'tests/helpers/boundary-locks.mjs');
  const rePinned = ['extension/manifest.json', 'supabase/functions/opera-agent-mcp/index.ts', 'supabase/functions/opera-agent-mcp/tools.ts']
    .map((file) => [file.replace(/^extension\//, '../extension/').replace(/^supabase\//, '../supabase/'), sha1BlobText(contentOf(file))]);
  const boundarySource = fs.readFileSync(lockFile, 'utf8');
  let boundaryNext = boundarySource;
  for (const [relativePath, sha] of rePinned) {
    const pattern = new RegExp(`(\\['${relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}', ')[0-9a-f]{40}('\\])`);
    if (!pattern.test(boundaryNext)) fail(`tests/helpers/boundary-locks.mjs: no pin line for ${relativePath}`);
    boundaryNext = boundaryNext.replace(pattern, `$1${sha}$2`);
  }
  boundaryNext = boundaryNext.replace('export const PUBLIC_SURFACE_LOCKS', `${buildWhyBlock(today, newVersion)}export const PUBLIC_SURFACE_LOCKS`);
  if (boundaryNext === boundarySource) fail('tests/helpers/boundary-locks.mjs: re-pin produced no change; refusing to continue');
  writes.set('tests/helpers/boundary-locks.mjs', boundaryNext);

  const contractPath = path.join(repo, 'tests/fixtures/mcp-contract-v1.json');
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const sourceForHash = contentOf('supabase/functions/opera-agent-mcp/index.ts') + '\n' + contentOf('supabase/functions/opera-agent-mcp/tools.ts');
  const contractNext = { ...contract, sourceSha256: sha256ContractSource(sourceForHash) };
  if (contractNext.sourceSha256 !== contract.sourceSha256) {
    writes.set('tests/fixtures/mcp-contract-v1.json', `${JSON.stringify(contractNext, null, 2)}\n`);
  }

  const changelogPath = path.join(repo, 'CHANGELOG.md');
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  if (changelog.includes(`releases/${newVersion}.md`)) fail(`CHANGELOG.md already lists ${newVersion}`);
  const releaseNote = `docs/releases/${newVersion}.md`;
  if (fs.existsSync(path.join(repo, releaseNote))) fail(`${releaseNote} already exists`);
  const changelogLines = changelog.split('\n');
  const firstRow = changelogLines.findIndex((line) => line.startsWith('| ') && /^\| \d+\.\d+\.\d+ /.test(line));
  if (firstRow === -1) fail('CHANGELOG.md: no release row to anchor the insert');
  changelogLines.splice(firstRow, 0, buildChangelogRow(newVersion, today));
  writes.set('CHANGELOG.md', changelogLines.join('\n'));

  const recentCommits = execFileSync('git', ['log', '--oneline', '-12'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').map((line) => `- ${line}`).join('\n');
  writes.set(releaseNote, buildReleaseNote(newVersion, today, recentCommits));

  const packageLockPath = path.join(repo, 'package-lock.json');
  if (fs.existsSync(packageLockPath)) {
    const lock = fs.readFileSync(packageLockPath, 'utf8');
    if (lock.includes(`"version": "${current}"`)) {
      writes.set('package-lock.json', lock.split(`"version": "${current}"`).join(`"version": "${newVersion}"`));
    }
  }

  if (dryRun) {
    for (const [file, contents] of writes) {
      const before = fs.existsSync(path.join(repo, file)) ? fs.readFileSync(path.join(repo, file), 'utf8') : '';
      console.log(`would write ${file} (${contents.length - before.length >= 0 ? '+' : ''}${contents.length - before.length} bytes)`);
    }
    console.log('\ndry run: nothing written');
    process.exit(0);
  }

  for (const [file, contents] of writes) {
    fs.writeFileSync(path.join(repo, file), contents.replace(/\r\n/g, '\n'), 'utf8');
  }

  execFileSync('git', ['add', '-A'], { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'] });

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmSpawn = process.platform === 'win32' ? { shell: true } : {};

  execFileSync(npmCmd, ['run', 'gates:refresh'], { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'], ...npmSpawn });
  execFileSync(npmCmd, ['test'], { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'], ...npmSpawn });
  execFileSync(npmCmd, ['run', 'check'], { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'], ...npmSpawn });
  console.log(`bump-version: the tree reads ${newVersion}; gates green; review npm run gates:refresh output above for the re-pins`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`bump-version: ${message}`);
  process.exit(1);
}
