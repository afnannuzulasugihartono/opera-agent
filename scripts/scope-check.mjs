// @last-edited: 2026-10-10 UTC+7.
// @title: scope-check — a brief declares the files it may touch; this counts what actually moved.
// @state: reads the Files block of an SDD brief and reports which committed paths were never declared.
// @dependencies: node:path, node:child_process, node:url.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Re-pins are the one side-effect this repo provably makes over and over: every edit to
// background.js moves its pinned hash, and boundary-locks.mjs records that hash. Across
// nineteen analysed tasks it was touched eleven times, eight of them undeclared. Naming it
// turns those eight false positives into a footnote instead of an accusation.

export const DEFAULT_SIDE_EFFECTS = ['tests/helpers/boundary-locks.mjs'];

const SECTION = /^\*\*(.+?):\*\*\s*$/;
const BACKTICKS = /`([^`]+)`/g;
const LINE_RANGE = /:\d+(?:-\d+)?\s*$/;
const COUNT_WITHOUT_PATH = /\b\d+\s+(?:berkas|files?)\b/i;

const HEADER = /^#{1,3}\s/;

/**
 * Read the Files and Side-effects blocks of a brief.
 *
 * A path counts only when it carries a slash. Briefs backtick prose inside those blocks —
 * `@state`, `export`, `background.js` — and treating any backtick as a path invents files
 * nobody touched. A bare `:84` continues the path printed beside it, because briefs write
 * one edit as `background.js:96-628`, `:84` rather than repeating the name. A bullet may
 * wrap onto an indented continuation line, so the whole bullet is read before it is judged.
 */

export function parseBrief(text) {
  const declared = [];
  const sideEffects = [];
  const seen = new Set();
  let section = null;
  let unparseable = false;
  let bullet = null;

  const push = (file, bucket) => {
    if (!file || seen.has(file)) return;
    seen.add(file);
    bucket.push(file);
  };

  const consume = (bucket, line) => {
    let found = null;
    let last = null;

    for (const [, span] of line.matchAll(BACKTICKS)) {
      const value = span.trim();
      if (value.startsWith(':')) {
        // A region of the path already named on this line: `:78-79` beside `background.js`.
        if (last) found = last;
        continue;
      }
      const file = value.replace(LINE_RANGE, '');
      if (!file.includes('/')) continue; // prose, not a path
      last = file;
      found = file;
      push(file, bucket);
    }

    if (!found && COUNT_WITHOUT_PATH.test(line)) unparseable = true;
  };

  // The bucket is read when the bullet closes, not when it opens, so a wrapped bullet is
  // judged by the section it started in rather than whatever section ran into its tail.
  const flush = () => {
    if (bullet === null) return;
    const bucket = section === 'side-effect' ? sideEffects : section === 'file' ? declared : null;

    // Interfaces and every other block also use `- path` bullets. Only Files and
    // Side-effects say what may be touched; reading the rest invents permissions.
    if (bucket !== null) consume(bucket, bullet);
    bullet = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const header = raw.match(SECTION);
    if (header) {
      flush();
      section = header[1].toLowerCase().replace(/s$/, '');
      continue;
    }
    if (HEADER.test(raw)) {
      flush();
      section = null;
      continue;
    }
    if (raw.trim() === '') {
      flush();
      continue;
    }
    if (raw.startsWith('- ')) {
      flush();
      bullet = raw;
      continue;
    }

    // A bullet may wrap, and its continuation is an indent. Prose under a blank line is
    // not an indent of anything — the flush above already closed the bullet, so this
    // line simply has nothing to attach to.
    if (bullet !== null && /^\s+\S/.test(raw)) {
      bullet += ` ${raw.trim()}`;
      continue;
    }
    flush();
  }
  flush();

  return { declared, sideEffects, unparseable };
}

/**
 * Compare what moved against what the brief allowed.
 *
 * status is 'declared', 'side-effect', or 'undeclared'. Only an undeclared path under
 * tests/ escalates: that is the single class the repository's own history proved harmful —
 * both genuine violations in nineteen tasks were test edits, and a test edit is the one
 * change that can make every other gate turn green.
 *
 * escalation also requires a readable declaration. A brief that writes "Modify: 17 berkas —
 * daftar lengkap di Step 3" declared those files; it just declared them in prose. Promoting
 * that to a violation counted seventeen honest declarations as crimes in the backtest, so an
 * unreadable brief reports `reliable: false` and stops short of accusing.
 */

export function classify(brief, actualFiles, sideEffects = DEFAULT_SIDE_EFFECTS) {
  const declared = new Set(brief.declared);
  const allowedSideEffects = new Set([...sideEffects, ...brief.sideEffects]);
  const moved = new Set(actualFiles);
  const reliable = brief.unparseable !== true;
  const rows = [];
  const escalations = [];

  // A trailing slash means "everything under here". Briefs write `extension/lib/` when a
  // task sweeps the folder, and matching that literally marked eleven honest files as
  // undeclared. A plain path stays exact: declaring loop.js says nothing about loop-engine.js.
  const declares = (entries, file) => {
    if (entries.has(file)) return true;
    for (const entry of entries) {
      if (entry.endsWith('/') && file.startsWith(entry)) return true;
    }
    return false;
  };

  for (const file of actualFiles) {
    let status = 'undeclared';
    if (declares(declared, file)) status = 'declared';
    else if (declares(allowedSideEffects, file)) status = 'side-effect';

    const escalate = reliable && status === 'undeclared' && file.startsWith('tests/');
    if (escalate) escalations.push(file);
    rows.push({ file, status, escalate });
  }

  // A swept folder is accounted for when anything under it moved — the folder path itself
  // will never appear in a diff, so requiring the literal name would fail every sweep.
  const satisfied = (entry) => {
    if (moved.has(entry)) return true;
    if (entry.endsWith('/')) {
      for (const file of moved) if (file.startsWith(entry)) return true;
    }
    return false;
  };

  const undeclared = rows.filter((row) => row.status === 'undeclared');
  const complete = [...declared].every(satisfied);
  return {
    rows,
    escalations,
    undeclared,
    complete,
    reliable,
    clean: reliable && undeclared.length === 0 && complete,
  };
}

export function changedFiles(root, base, head) {
  const out = execFileSync('git', ['diff', '--name-only', `${base}..${head}`], {
    cwd: root,
    encoding: 'utf8',
  });
  return out.split(/\r?\n/).filter(Boolean);
}

export const STATUS_MARK = {
  declared: '✓',
  'side-effect': '~',
  undeclared: '✗',
};

export function format(result) {
  const lines = result.rows.map((row) => {
    const note = row.escalate ? '  ← TIDAK DIDEKLARASI' : '';
    return `  ${STATUS_MARK[row.status]}  ${row.file}${note}`;
  });
  lines.push('');
  if (!result.reliable) {
    // The verdict leads here because it cannot be given: the declaration is incomplete, so
    // no row below proves a violation. Showing the accusations first would still read as one.
    lines.push('⚠ DEKLARASI TIDAK BISA DIBACA MESIN — hasil di atas bersifat sementara.');
    lines.push(`   ${result.undeclared.length} file terlihat di luar deklarasi, tapi tidak bisa dituduh: brief menyebut jumlahnya tanpa menyebut isinya.`);
    lines.push('   Minta brief menuliskan path satu per satu, baru hasil ini bisa dipercaya.');
  } else if (result.escalations.length > 0) {
    lines.push(`${result.escalations.length} file menyentuh tests/ tanpa deklarasi. WAJIB ESKALASI sebelum dianggap selesai.`);
  } else if (result.undeclared.length > 0) {
    lines.push(`${result.undeclared.length} file di luar deklarasi; tidak ada yang di dalam tests/.`);
  } else {
    lines.push(`Bersih. ${result.rows.length} file, ${result.rows.length} terdeklarasi, 0 penyimpangan.`);
  }
  return lines.join('\n');
}

function flag(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const briefPath = args.find((arg) => !arg.startsWith('--'));
  const base = flag(args, '--base');
  const head = flag(args, '--head') ?? 'HEAD';

  if (!briefPath) {
    console.error('usage: node scripts/scope-check.mjs <brief> --base <sha> [--head <sha>]');
    process.exit(2);
  }

  const root = fileURLToPath(new URL('..', import.meta.url));
  const brief = parseBrief(fs.readFileSync(path.resolve(root, briefPath), 'utf8'));
  const actual = base ? changedFiles(root, base, head) : [];
  const result = classify(brief, actual);

  console.log(`Brief : ${briefPath}`);
  console.log(`Range : ${base ?? '(tanpa --base)'}..${head}`);
  console.log('');
  console.log(format(result));
  process.exit(result.escalations.length > 0 ? 1 : 0);
}
