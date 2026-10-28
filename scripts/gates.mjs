// @last-edited: 2026-10-28 UTC+7.
// @title: gates — verify or deliberately re-pin the acceptance surface.
// @state: reads gates.lock, compares git-blob SHA1s, reports drift; refresh never runs from the gate.
// @dependencies: node:fs, node:path, node:crypto, node:url.

// WHY THIS IS ITS OWN PROGRAM AND NOT A BLOCK INSIDE scripts/check.mjs.
// The thing that verifies the gates must not be editable by editing the gate it verifies.
// scripts/check.mjs is itself pinned in gates.lock, so a weakened rule there is still noticed — as long as this file is not touched in the same commit, which is Layer 2's job (.github/CODEOWNERS).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lockPath = path.join(root, 'gates.lock');
const refreshing = process.argv.includes('--refresh');

function readGateEntries() {
  return fs.readFileSync(lockPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [file, sha] = line.split(/\s+/);
      return { file, sha };
    });
}

function sha1Blob(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) return null;
  const bytes = fs.readFileSync(absolute);
  const content = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return crypto.createHash('sha1')
    .update(Buffer.from(`blob ${content.length}\0`)).update(content).digest('hex');
}

const entries = readGateEntries();
const seen = new Set();
const missing = [];
const drifted = [];
const unpinned = [];

for (const { file, sha } of entries) {
  if (seen.has(file)) throw new Error(`gates.lock lists ${file} twice; one pin per criterion`);
  seen.add(file);

  const actual = sha1Blob(file);
  if (actual === null) { missing.push(file); continue; }

  if (!sha) { unpinned.push(file); continue; }
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`gates.lock has a malformed pin for ${file}`);
  if (actual !== sha) drifted.push({ file, was: sha, now: actual });
}

if (refreshing) {

  if (missing.length) {
    console.error(`gates:refresh refused. These are pinned but absent:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
  const toWrite = [
    ...unpinned.map((file) => ({ file, was: null, now: sha1Blob(file) })),
    ...drifted
  ];
  if (!toWrite.length) {
    console.log(`gates:refresh — all ${entries.length} pins already current, nothing written.`);
    process.exit(0);
  }
  const text = fs.readFileSync(lockPath, 'utf8');
  const byPath = new Map(toWrite.map((d) => [d.file, d.now]));
  const updated = text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const [file] = trimmed.split(/\s+/);
      return byPath.has(file) ? `${file} ${byPath.get(file)}` : line;
    })
    .join('\n');
  fs.writeFileSync(lockPath, updated);
  console.log(`gates:refresh — pinned ${toWrite.length} of ${entries.length}:`);
  for (const d of toWrite) console.log(`  ${d.file}\n    ${d.was ?? '(no pin yet)'} -> ${d.now}`);
  console.log('\nSay in the commit why the criterion each pin enforces did or did not change.');
  process.exit(0);
}

const problems = [
  ...unpinned.map((f) => `${f} is listed in gates.lock but carries no pin`),
  ...missing.map((f) => `${f} is pinned in gates.lock but is not in the tree`),
  ...drifted.map((d) => `${d.file}\n    pinned ${d.was}\n    actual ${d.now}`)
];

if (problems.length) {
  console.error(`gates: the acceptance surface moved without a deliberate re-pin.\n\n  ${problems.join('\n\n  ')}\n`);
  console.error('A gate changed, so the thing that judges the tree moved too. That is either\n'
    + 'a real change to what this repository accepts as correct — in which case say\n'
    + 'so in the commit and run `npm run gates:refresh` — or the check was weakened,\n'
    + 'in which case do not re-pin. .github/CODEOWNERS is what makes the difference\n'
    + 'reviewable: these paths are owner-approvable only.');
  process.exit(1);
}

