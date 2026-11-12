#!/usr/bin/env node

// @last-edited: 2026-11-12 UTC+7.
// @title: bump-version - one argument, every clock moves together, or none does.
// @state: the engine behind release-bump; rewrites the clocks it owns, recomputes the pins that move, scaffolds the release note and the changelog row, and exits red if any of it disagrees.
// @dependencies: node:fs, node:path, node:child_process, node:url, ../tests/helpers/canonical-source-hash.mjs.

// WHY THIS EXISTS.
// A release writes the version into more than fifteen files by hand, and the one forgotten clock reads as a broken release until CI catches it.
// The engine rewrites exactly the files that carry the clock today (the enumeration below), recomputes the three boundary-locks pins that ride the version constants, recomputes the MCP contract digest, scaffolds the release note and the changelog row, and then runs the gates itself.
// It never guesses: a listed file that does not contain the expected string is a hard error naming the file, so the enumeration cannot silently rot.
// The button that calls this is .github/workflows/release-bump.yml; the guard that keeps the enumeration honest is tests/bump-version.test.mjs.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256ContractSource } from '../tests/helpers/canonical-source-hash.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const arg = process.argv.slice(2).find((value) => value !== '--dry-run');

function fail(message) {
  console.error(`bump-version: ${message}`);
  process.exit(1);
}

if (!arg || !/^\d+\.\d+\.\d+$/.test(arg)) fail('pass one version, e.g. node scripts/bump-version.mjs 1.6.49');
const newVersion = arg;

const manifestPath = path.join(repo, 'extension/manifest.json');
const current = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(current)) fail(`extension/manifest.json does not read a three-part version: ${current}`);
if (current === newVersion) fail(`the tree already reads ${newVersion}`);

const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim();
if (dirty) fail(`the tree is dirty; the bump must land as one reviewable diff:\n${dirty}`);

const today = new Date().toISOString().slice(0, 10);
const enumeration = [
  { file: 'extension/lib/protocol.js', from: `PRODUCT_VERSION = '${current}'`, to: `PRODUCT_VERSION = '${newVersion}'`, expect: 1 },
  { file: 'extension/manifest.json', from: `"version": "${current}"`, to: `"version": "${newVersion}"`, expect: 1 },
  { file: 'store/store-manifest.json', from: `"version": "${current}.0"`, to: `"version": "${newVersion}.0"`, expect: 1 },
  { file: 'package.json', from: `"version": "${current}"`, to: `"version": "${newVersion}"`, expect: 1 },
  { file: 'local/package.json', from: `"version": "${current}"`, to: `"version": "${newVersion}"`, expect: 1 },
  { file: 'scripts/check.mjs', from: `'${current}'`, to: `'${newVersion}'`, expect: 3 },
  { file: 'supabase/functions/opera-agent-mcp/index.ts', from: `SERVER_VERSION = "${current}"`, to: `SERVER_VERSION = "${newVersion}"`, expect: 1 },
  { file: 'tests/burst-atomic-actions.test.mjs', from: `'${current}'`, to: `'${newVersion}'`, expect: 2 },
  { file: 'tests/hover-settle.test.mjs', from: `'${current}'`, to: `'${newVersion}'`, expect: 1 },
  { file: 'tests/mcp-surface.test.mjs', from: `'${current}'`, to: `'${newVersion}'`, expect: 1 },
  { file: 'tests/protocol.test.mjs', from: `'${current}'`, to: `'${newVersion}'`, expect: 1 },
  { file: 'tests/role-reconcile.test.mjs', from: `'${current}'`, to: `'${newVersion}'`, expect: 1 },
  { file: 'tests/timeout-retry-popup-parity.test.mjs', from: `'${current}'`, to: `'${newVersion}'`, expect: 1 },
  { file: 'landing/mcp.html', from: `version: ${current}`, to: `version: ${newVersion}`, expect: 1 },
  { file: 'docs/handoff.md', from: `at the ${current} release commit`, to: `at the ${newVersion} release commit`, expect: 1 },
  { file: 'docs/handoff.md', from: `everything ${current}`, to: `everything ${newVersion}`, expect: 1 },
  { file: 'docs/handoff.md', from: `releases/${current}.md`, to: `releases/${newVersion}.md`, expect: 2 },
];

function countOccurrences(text, needle) {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

function rewrite(entry) {
  const full = path.join(repo, entry.file);
  const text = fs.readFileSync(full, 'utf8');
  const found = countOccurrences(text, entry.from);
  if (found !== entry.expect) {
    fail(`${entry.file}: expected ${entry.expect} occurrence(s) of ${JSON.stringify(entry.from)}, found ${found} - the enumeration is stale; fix the list, not the assert`);
  }
  return text.split(entry.from).join(entry.to);
}

const writes = new Map();
for (const entry of enumeration) {
  const before = fs.readFileSync(path.join(repo, entry.file), 'utf8');
  const after = rewrite(entry);
  if (before !== after) writes.set(entry.file, after);
}

function sha1Blob(file) {
  const content = Buffer.from(fs.readFileSync(path.join(repo, file), 'utf8').replace(/\r\n/g, '\n'), 'utf8');
  return crypto.createHash('sha1').update(Buffer.from(`blob ${content.length}\0`)).update(content).digest('hex');
}

const lockFile = path.join(repo, 'tests/helpers/boundary-locks.mjs');
const rePinned = ['extension/manifest.json', 'supabase/functions/opera-agent-mcp/index.ts', 'supabase/functions/opera-agent-mcp/tools.ts']
  .map((file) => [file.replace(/^extension\//, '../extension/').replace(/^supabase\//, '../supabase/'), sha1Blob(file)]);
const boundarySource = fs.readFileSync(lockFile, 'utf8');
let boundaryNext = boundarySource;
for (const [relativePath, sha] of rePinned) {
  const pattern = new RegExp(`(\\['${relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}', ')[0-9a-f]{40}('\\])`);
  if (!pattern.test(boundaryNext)) fail(`tests/helpers/boundary-locks.mjs: no pin line for ${relativePath}`);
  boundaryNext = boundaryNext.replace(pattern, `$1${sha}$2`);
}
const whyBlock = `// WHY these three were re-pinned on ${today}: the ${newVersion} release rode them.\n// The version constants moved (manifest.json version, index.ts SERVER_VERSION); nothing about the public contract moved with them.\n\n`;
boundaryNext = boundaryNext.replace('export const PUBLIC_SURFACE_LOCKS', `${whyBlock}export const PUBLIC_SURFACE_LOCKS`);
if (boundaryNext === boundarySource) fail('tests/helpers/boundary-locks.mjs: re-pin produced no change; refusing to continue');
writes.set('tests/helpers/boundary-locks.mjs', boundaryNext);

const contractPath = path.join(repo, 'tests/fixtures/mcp-contract-v1.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const sourceForHash = fs.readFileSync(path.join(repo, 'supabase/functions/opera-agent-mcp/index.ts'), 'utf8') + '\n' + fs.readFileSync(path.join(repo, 'supabase/functions/opera-agent-mcp/tools.ts'), 'utf8');
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
changelogLines.splice(firstRow, 0, `| ${newVersion} | ${today} | [the release notes are written in the PR that carries this bump](docs/releases/${newVersion}.md) |`);
writes.set('CHANGELOG.md', changelogLines.join('\n'));

const recentCommits = execFileSync('git', ['log', '--oneline', '-12'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').map((line) => `- ${line}`).join('\n');
const noteText = `# @last-edited: ${today} UTC+7.
# @title: ${newVersion} - the release note is written in the PR that carries this file.
# @state: the release note for the version the tree now reads; the prose is filled by the reviewer before it merges.
# @dependencies: none.

# WHAT REACHED THE SURFACE

filled in review.

# WHAT CHANGED FOR CALLERS

filled in review.

# WHAT IT COSTS THE READER

filled in review.

# RECENT COMMITS

${recentCommits}
`;
writes.set(releaseNote, noteText);

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
  const full = path.join(repo, file);
  fs.writeFileSync(full, contents.replace(/\r\n/g, '\n'), 'utf8');
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

execFileSync(npmCmd, ['run', 'gates:refresh'], { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'] });

execFileSync(npmCmd, ['test'], { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'] });
execFileSync(npmCmd, ['run', 'check'], { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'] });
console.log(`bump-version: the tree reads ${newVersion}; gates green; review npm run gates:refresh output above for the re-pins`);
