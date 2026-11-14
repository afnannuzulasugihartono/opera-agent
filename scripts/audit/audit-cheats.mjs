// @last-edited: 2026-11-13 UTC+7.
// @title: audit-cheats - the anti-cheat gate: nothing AI or human slips in through the holes a typechecker cannot see.
// @state: fails the build on any @ts-ignore, @ts-expect-error, @ts-nocheck, as any, require() in product code, or an unsanctioned `as unknown as`.
// @dependencies: node:fs, node:path, node:url.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const productRoots = ['shared', 'local', 'hosted', 'extension'];

// WHY PER-OCCURRENCE AND NOT PER-FILE.
// A file in this list is not a blanket pass: the gate fails when a file carries MORE matches than its declared count, so one added cast stops the build.
// A cast removed from a file leaves its sanction stale, and the gate says so; deleting the cast means lowering the count in the same commit.
// Adding a count means naming why, in this file, with the same care the original asked for.

const SANCTIONED = new Map([
  ['shared/delta-first-observation.ts', { count: 1, reason: 'the frozen delta-first VM hands back an untyped result for the caller - every field is validated above the cast by construction; the cast restores the named type once.' }],
  ['shared/reactive-vm-control-flow.ts', { count: 2, reason: 'the frozen VM validator hands back the already-validated program typed as untyped on purpose; the casts re-enter the typed world once each.' }],
  ['local/bin/opera-local-dev.ts', { count: 1, reason: 'the SupervisorWorker view of the worker is constructively known to the child_process spawn; the cast names the shape the spawn returned.' }],
  ['local/bin/opera-local.ts', { count: 1, reason: 'the Driver interface in bin/opera-local.ts takes the concrete driver created above as its transport; both answer the same verbs over different pairs.' }],
  ['local/bridge-ws.ts', { count: 1, reason: 'a ws.destroy() pair exists on net.Socket but not on WebSocket.type, so the dead-socket sweep destroys the underlying handle rather than the wrapper.' }],
  ['local/dev-shim.ts', { count: 1, reason: 'the child stdin piped in is a net.Socket with setEncoding but types it only as a Closeable; the cast names the shape the pipe actually provides.' }],
  ['local/mcp-server.ts', { count: 4, reason: 'gates.js answers the same verb set as the local Driver surface, typed narrowly for its own use; the cast widens the narrow gate-driver back to the Driver callers here expect.' }],
  ['local/sessions.ts', { count: 1, reason: 'the session store pairs verbs with opaque keys, so the stored driver is honest-but-untyped; the cast names the type the store pinned above.' }],
  ['local/transport.ts', { count: 1, reason: 'globalThis.WebSocket is only typed for the browser surface; the cast names the shape the CDP transport actually uses.' }],
  ['local/window-focus.ts', { count: 2, reason: 'child.stdout and child.stdin are typed as streams without .unref(); the two casts name the shape node gives these pipes on the platform.' }],
  ['hosted/functions/opera-agent-bridge/index.ts', { count: 1, reason: 'pg.unsafe returns Promise<any> at the boundary where the query shape is a constant; the cast names the Promise<unknown[]> the handler consumes.' }],
  ['hosted/functions/opera-agent-update/index.ts', { count: 1, reason: 'crypto.subtle.digest accepts BufferSource; the cast restores the ArrayBuffer the byte array already holds.' }],
]);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function relativeFile(dir, file) {
  return path.relative(dir, file).split(path.sep).join('/');
}

const forbidden = /(?:@ts-ignore|@ts-expect-error|@ts-nocheck|@ts-ignore-next-line|\bas\s+any(?![A-Za-z])|\brequire\s*\(|\bmodule\.exports\b)/g;
const unknownCast = /(?:as\s+unknown\s+as)/g;

const findings = [];
const counts = new Map();

const countFinding = (file) => {
  counts.set(file, (counts.get(file) ?? 0) + 1);
};

for (const root of productRoots) {
  const absolute = path.join(repo, root);
  for (const file of walk(absolute)) {
    if (!file.endsWith('.ts')) continue;
    const rel = relativeFile(absolute, file);
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      forbidden.lastIndex = 0;
      const forbiddenMatch = forbidden.exec(line);
      if (forbiddenMatch) {
        findings.push(`${root}/${rel}:${index + 1}: ${forbiddenMatch[0].trim()}\n  > ${line.trim().slice(0, 120)}`);
        countFinding(`${root}/${rel}`);
      }
      unknownCast.lastIndex = 0;
      let castMatch;
      while ((castMatch = unknownCast.exec(line))) {
        findings.push(`${root}/${rel}:${index + 1}: ${castMatch[0].trim()}\n  > ${line.trim().slice(0, 120)}`);
        countFinding(`${root}/${rel}`);
      }
    }
  }
}

const problems = [];
for (const [file, count] of counts) {
  const sanction = SANCTIONED.get(file);
  if (!sanction) {
    problems.push(`${file}: ${count} finding(s), no sanction`);
    continue;
  }
  if (count > sanction.count) {
    problems.push(`${file}: ${count} findings, sanctioned for ${sanction.count} - ${sanction.reason}`);
  }
}

const stale = [];
for (const [file, sanction] of SANCTIONED) {
  const count = counts.get(file) ?? 0;
  if (count < sanction.count) {
    stale.push(`${file}: sanctioned for ${sanction.count}, found ${count} - lower the count in the same commit that removed the casts`);
  }
}

if (problems.length > 0) {
  console.error('audit-cheats: refused - findings beyond their per-occurrence sanction:');
  for (const problem of problems) console.error(`  ${problem}`);
  for (const problem of problems) {
    const file = problem.split(':', 1)[0];
    for (const finding of findings.filter((finding) => finding.split(':', 1)[0] === file)) console.error(`  > ${finding}`);
  }
  process.exit(1);
}
for (const note of stale) console.error(`audit-cheats: stale sanction - ${note}`);

process.stderr.write('audit-cheats: clean - no unsanctioned suppressions, casts or requires in product code\n');
