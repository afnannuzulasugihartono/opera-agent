// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: scope — Scope preflight: bound the read set before reading it.
// @state: scope preflight that bounds the read set (owner-ordered).
// @dependencies: node:fs, node:path, node:child_process, node:url.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Scope preflight: bound the read set before reading it.
//
// A task does not need the repository, it needs a handful of files. This ranks
// runtime sources by task terms, caps the result, and prints the token cost of
// the recommendation against the cost of reading everything — so an agent sees
// the trade it is making instead of discovering it in the middle of a turn.
//
// Usage: node scripts/scope.mjs "burst navigate" [--json] [--limit N]

const root = fileURLToPath(new URL('..', import.meta.url));
const RUNTIME_DIRS = ['extension', 'lib', 'supabase/functions'];
const RUNTIME_EXT = /\.(js|ts)$/;
const LARGE_FILE_LINES = 500;
const CHARS_PER_TOKEN = 4;

function readFlag(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}

function runtimeFiles() {
  const listed = execFileSync('git', ['ls-files', ...RUNTIME_DIRS.map((d) => `${d}/**/*.js`), ...RUNTIME_DIRS.map((d) => `${d}/**/*.ts`)], {
    cwd: root,
    encoding: 'utf8',
  });
  return listed.split('\n').filter((f) => f && RUNTIME_EXT.test(f));
}

function terms(task) {
  return task
    .toLowerCase()
    .split(/[^a-z0-9_.]+/)
    .filter((t) => t.length > 2 && !['the', 'and', 'for', 'with', 'that', 'this'].includes(t));
}

function measure(relativePath) {
  const text = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const lines = text.split('\n').length;
  return { lines, tokens: Math.round(text.length / CHARS_PER_TOKEN) };
}

function score(text, words) {
  const haystack = text.toLowerCase();
  let total = 0;
  for (const word of words) {
    if (word.includes('.')) {
      if (haystack.includes(word)) total += 3;
      for (const part of word.split('.')) {
        if (part.length <= 2) continue;
        let at = haystack.indexOf(part);
        while (at !== -1) {
          total += 1;
          at = haystack.indexOf(part, at + part.length);
        }
      }
      continue;
    }
    let at = haystack.indexOf(word);
    while (at !== -1) {
      total += 1;
      at = haystack.indexOf(word, at + word.length);
    }
  }
  return total;
}

function run(argv) {
  const json = argv.includes('--json');
  const limitIndex = argv.indexOf('--limit');
  const limit = Number(readFlag(argv, '--limit', 12));
  if (!Number.isSafeInteger(limit) || limit < 0) {
    process.stderr.write('scope: --limit must be a non-negative safe integer.\n');
    process.exit(1);
  }

  // Only the token right after --limit is the limit value. Comparing by value
  // instead ate a task term that happened to equal it.
  const task = argv
    .filter((item, index) => !item.startsWith('--') && !(limitIndex >= 0 && index === limitIndex + 1))
    .join(' ');
  const words = terms(task);

  const all = runtimeFiles();
  const whole = all.map((f) => measure(f));
  const runtimeTokens = whole.reduce((sum, m) => sum + m.tokens, 0);

  // The haystack is not the runtime source (that is small by design); it is
  // every tracked file, docs and tests included. An agent that "reads the
  // repo" pays this.
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  let wholeRepoTokens = 0;
  for (const f of tracked) {
    try {
      wholeRepoTokens += measure(f).tokens;
    } catch {
      // A path that vanished between ls-files and stat is not counted; the
      // estimate stays a lower bound rather than throwing mid-task.
    }
  }

  const ranked = all
    .map((file) => {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      const { lines, tokens } = measure(file);
      return { path: file, lines, tokens, matches: score(text, words), readWhole: lines <= LARGE_FILE_LINES };
    })
    .filter((f) => f.matches > 0)
    .sort((a, b) => b.matches - a.matches || a.tokens - b.tokens)
    .slice(0, limit)
    .map((f) => ({
      ...f,
      hint: f.lines > LARGE_FILE_LINES ? `grep -n '<term>' ${f.path} — then read with offset/limit` : ''
    }));

  const totalTokens = ranked.reduce((sum, f) => sum + f.tokens, 0);
  const result = {
    task,
    terms: words,
    limit,
    files: ranked,
    totalTokens,
    wholeRepoFiles: tracked.length,
    runtimeFiles: all.length,
    wholeRepoTokens,
    runtimeTokens,
    savedRatio: wholeRepoTokens ? Math.round((1 - totalTokens / wholeRepoTokens) * 100) : 0
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const lines = [
    `scope: ${task || '(no task given)'}`,
    `read set: ${ranked.length} of ${all.length} runtime files — ${totalTokens} tokens`,
    `whole repo: ${tracked.length} tracked files, ${wholeRepoTokens} tokens (${result.savedRatio}% of it saved)`
  ];
  for (const f of ranked) {
    lines.push(`  ${f.matches.toString().padStart(4)}  ${String(f.lines).padStart(5)}L  ${String(f.tokens).padStart(6)}tok  ${f.path}${f.hint ? `  <- ${f.hint}` : ''}`);
  }
  if (!ranked.length) lines.push('  (no matches — narrow the task or read the area AGENTS.md)');
  process.stdout.write(`${lines.join('\n')}\n`);
}

run(process.argv.slice(2));