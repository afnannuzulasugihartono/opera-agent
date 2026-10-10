// @last-edited: 2026-10-10 UTC+7.
// @title: scope-check — a brief declares the files it may touch; this counts what actually moved.
// @state: proves the parser reads the repo's real brief grammar and that an undeclared tests/ edit is named, not waved through.
// @dependencies: node:fs, node:node:test, node:url, strict, scripts/scope-check.

import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { parseBrief, classify } from '../scripts/scope-check.mjs';

// A plain concatenation, not a template: `${name}` here put the comment-spacing scanner
// into template mode and made every comment below it invisible to that gate — the suite
// went red at the first comment it could finally see. Concatenation keeps the scanner in
// code mode for the whole file, so this file is judged like every other.

const fixture = (name) =>
  fs.readFileSync(fileURLToPath(new URL('./fixtures/scope-check/' + name, import.meta.url)), 'utf8');

test('a brief reads into the exact set of files it declared', () => {
  const brief = parseBrief(fixture('clean.brief.md'));
  assert.deepEqual(brief.declared, [
    'extension/worker/burst.js',
    'extension/background.js',
    'tests/helpers/extension-source.mjs',
  ]);
  assert.equal(brief.unparseable, false);
});

test('a bare :84 belongs to the path printed beside it, not to itself', () => {
  // WHY this matters: briefs write `background.js:96-628`, `:84` as one edit with two
  // regions. A parser that treats `:84` as a file invents a file nobody touched.
  const brief = parseBrief(fixture('clean.brief.md'));
  assert.ok(brief.declared.includes('extension/background.js'));
  assert.ok(!brief.declared.some((file) => file.startsWith(':')));
});

test('prose backticks are not files', () => {
  // WHY: task 16's brief writes `@state` and `export` inside the Files block. Both are
  // backticked; neither is a path. Filtering on the slash keeps them out.
  const text = [
    '**Files:**',
    '- Modify: `extension/worker/action-focus.js` (satu baris **dan satu baris `@state`**)',
    '- Modify: `extension/background.js:96-628`, `:84`, **dan satu kata kunci `export`**',
    '',
  ].join('\n');
  const brief = parseBrief(text);
  assert.deepEqual(brief.declared, ['extension/worker/action-focus.js', 'extension/background.js']);
});

test('a count with no paths is flagged, never guessed at', () => {
  const brief = parseBrief(fixture('unparseable.brief.md'));
  assert.equal(brief.unparseable, true);
  assert.deepEqual(brief.declared, ['tests/helpers/extension-source.mjs']);
});

test('an undeclared file outside tests/ is a violation', () => {
  const brief = parseBrief(fixture('clean.brief.md'));
  const result = classify(brief, ['extension/worker/burst.js', 'extension/lib/log.js']);
  const log = result.rows.find((row) => row.file === 'extension/lib/log.js');
  assert.equal(log.status, 'undeclared');
  assert.equal(result.escalations.length, 0);
});

test('a re-pin side-effect is recorded, not accused', () => {
  const brief = parseBrief(fixture('side-effect.brief.md'));
  const result = classify(brief, [
    'extension/worker/tab-content.js',
    'extension/background.js',
    'tests/helpers/extension-source.mjs',
    'tests/helpers/boundary-locks.mjs',
  ]);
  const rePin = result.rows.find((row) => row.file === 'tests/helpers/boundary-locks.mjs');
  assert.equal(rePin.status, 'side-effect');
  assert.equal(result.escalations.length, 0);
});

test('the default side-effect list matches the repo re-pin habit', () => {
  // WHY a default at all: boundary-locks.mjs was touched 111 times as a hash re-pin, and
  // eight of nineteen analysed tasks touched it without declaring it. One named entry
  // turns those eight false positives into a footnote.
  const brief = parseBrief(fixture('undeclared-test.brief.md'));
  const result = classify(brief, [
    'extension/worker/capture.js',
    'extension/background.js',
    'tests/helpers/boundary-locks.mjs',
  ]);
  const rePin = result.rows.find((row) => row.file === 'tests/helpers/boundary-locks.mjs');
  assert.equal(rePin.status, 'side-effect');
});

test('an undeclared tests/ edit demands escalation', () => {
  const brief = parseBrief(fixture('undeclared-test.brief.md'));
  const result = classify(brief, [
    'extension/worker/capture.js',
    'extension/background.js',
    'tests/ax-observation.test.mjs',
  ]);
  assert.deepEqual(result.escalations, ['tests/ax-observation.test.mjs']);
  const hit = result.rows.find((row) => row.file === 'tests/ax-observation.test.mjs');
  assert.equal(hit.status, 'undeclared');
  assert.equal(hit.escalate, true);
});

test('an unparseable brief warns, it does not accuse', () => {
  // WHY: task 5 declared "Modify: 17 berkas — daftar lengkap di Step 3". The files really
  // were declared, just not in a form a parser can read. Escalating on that counts seventeen
  // honest declarations as violations — and a gate that cries wolf is a gate nobody opens.
  const brief = parseBrief(fixture('unparseable.brief.md'));
  assert.equal(brief.unparseable, true);

  const result = classify(brief, [
    'tests/helpers/extension-source.mjs',
    'tests/ax-observation.test.mjs',
  ]);

  assert.deepEqual(result.escalations, [], 'an incomplete declaration cannot prove a violation');
  assert.equal(result.reliable, false);
  const hit = result.rows.find((row) => row.file === 'tests/ax-observation.test.mjs');
  assert.equal(hit.status, 'undeclared', 'the row is still shown, just not promoted');
  assert.equal(hit.escalate, false);
});

test('a readable brief still escalates the same file', () => {
  // WHY paired with the test above: without this one, the cheapest way to silence the gate
  // would be to make every brief unparseable. The downgrade must be driven by the brief's
  // own honesty, not by the file being accused.
  const brief = parseBrief(fixture('undeclared-test.brief.md'));
  assert.equal(brief.unparseable, false);
  const result = classify(brief, [
    'extension/worker/capture.js',
    'extension/background.js',
    'tests/ax-observation.test.mjs',
  ]);
  assert.deepEqual(result.escalations, ['tests/ax-observation.test.mjs']);
});

test('a bullet that wraps keeps every path it names', () => {
  // WHY: task 7b's brief declared its carry-over work across two lines — the second line is
  // an indent, not a new bullet. Reading only line one dropped `background.js` from the
  // declaration and then accused it. The brief was honest; the parser was not.
  const text = [
    '**Files:**',
    '- Commit: perubahan Task 7 yang masih terbuka (`extension/lib/log.js`,',
    '  `extension/background.js`, `tests/helpers/extension-source.mjs`)',
    '',
    '**Interfaces:**',
    '- Consumes: `extension/lib/watch.js`',
    '',
  ].join('\n');
  const brief = parseBrief(text);
  assert.deepEqual(brief.declared, [
    'extension/lib/log.js',
    'extension/background.js',
    'tests/helpers/extension-source.mjs',
  ]);
  assert.equal(brief.unparseable, false);
});

test('prose after a blank line is not a continuation', () => {
  const text = [
    '**Files:**',
    '- Create: `extension/worker/burst.js`',
    '',
    '  Catatan: `extension/lib/protocol.js` dipakai dari luar blok ini.',
    '',
  ].join('\n');
  const brief = parseBrief(text);
  assert.deepEqual(brief.declared, ['extension/worker/burst.js']);
});

test('a directory declaration covers the files beneath it', () => {
  // WHY task 3 declared `- Modify: \`extension/lib/\` — 11 file`: briefs name a folder when
  // a task sweeps it. Matching the literal string marked all eleven honest files as
  // undeclared — the same accusation-the-parser-was-wrong bug, third instance.
  const text = [
    '**Files:**',
    '- Modify: `extension/lib/` — 11 file',
    '- Test: `tests/hygiene.test.mjs` (tambahkan satu tes)',
    '',
  ].join('\n');
  const brief = parseBrief(text);

  const result = classify(brief, [
    'extension/lib/action-pipeline.js',
    'extension/lib/protocol.js',
    'tests/hygiene.test.mjs',
  ]);

  assert.deepEqual(result.escalations, []);
  assert.deepEqual(
    result.rows.map((row) => row.status),
    ['declared', 'declared', 'declared'],
  );
  assert.equal(result.clean, true, 'a swept folder is complete when files under it moved');
});

test('a directory declaration does not reach outside its own folder', () => {
  const text = ['**Files:**', '- Modify: `extension/lib/`', ''].join('\n');
  const brief = parseBrief(text);

  const result = classify(brief, ['extension/background.js', 'extension/lib/keyboard.js']);

  const outside = result.rows.find((row) => row.file === 'extension/background.js');
  assert.equal(outside.status, 'undeclared');
  assert.deepEqual(result.escalations, [], 'outside tests/, so it is named, not escalated');
});

test('a plain path is still exact, not a prefix', () => {
  // WHY: `extension/lib/loop.js` must not declare `extension/lib/loop-engine.js`. Only a
  // trailing slash means "everything under here".
  const brief = parseBrief(['**Files:**', '- Modify: `extension/lib/loop.js`', ''].join('\n'));
  const result = classify(brief, ['extension/lib/loop.js', 'extension/lib/loop-engine.js']);
  const sibling = result.rows.find((row) => row.file === 'extension/lib/loop-engine.js');
  assert.equal(sibling.status, 'undeclared');
});

test('every declared file is accounted for, whatever else happened', () => {
  const brief = parseBrief(fixture('clean.brief.md'));
  const result = classify(brief, ['extension/worker/burst.js']);
  const burst = result.rows.find((row) => row.file === 'extension/worker/burst.js');
  assert.equal(burst.status, 'declared');
  assert.equal(result.clean, false, 'a declared file that never moved is worth naming');
});
