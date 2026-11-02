// @last-edited: 2026-11-02 UTC+7.
// @title: branch-name — the one shape a work branch takes, and the report that names the branches that do not.
// @state: `agent/<worktree>` or `agent/<worktree>/<topic>`, every segment lowercase kebab; the CLI reports every branch on the clone against it.
// @dependencies: node:child_process, node:path, node:url.

// WHY THIS FILE EXISTS.
// Forty-odd branches live on this repository, and the shapes among them disagree: `agent/sitebench/sitebench` says the topic twice, `cline/6m4r5na4` says nothing about who is working, and `wip/shared-checkout-2026-10-28` is a fourth convention of its own.
// A rule written in a document is a promise; a rule the worktree script reads is the shape every new branch gets, and a report is how the ones already there are seen.

// WHY THE SHAPE IS THE PREFIX AND UP TO TWO SEGMENTS.
// The prefix says the branch is an agent's work rather than a release or the trunk, so a log line places it without being told.
// The first segment is the worktree, which is one machine and one checkout; the second is the topic, which is one line of work inside it.
// One agent on one topic needs one segment, which is why the topic is optional and why a topic that repeats the worktree is dropped: `agent/operafetch/operafetch` carries the same word twice and names one thing.

// WHY LOWERCASE KEBAB AND NOTHING ELSE.
// A branch name travels through git on Windows and Linux, through a URL in a pull request, and through every shell an agent types in.
// A space has to be quoted in each of them, an uppercase letter is folded by some file systems and not others, and an underscore is the separator the code itself uses for words (docs/naming.md).
// A hyphen in a branch names a word boundary that no identifier has to escape, so the branch never argues with the code it carries.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const WORK_PREFIX = 'agent';

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// WHY A CAMEL CASE WORD IS SPLIT BEFORE IT IS FOLDED.
// `OperaFetch` is two words written the way code writes them, so the branch says `opera-fetch` instead of `operafetch`.
// The fold happens on the words, not on the letters, so a name keeps the boundaries its author chose.

export function slugWord(text) {
  return String(text ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// WHY THE PROBLEM IS A SENTENCE AND NOT A BOOLEAN.
// A refusal that says only `false` sends the reader back to the document; a refusal that names the segment and the rule is the document, at the moment it is needed.

export function branchProblem(name) {
  const branch = String(name ?? '').trim();
  if (!branch) return 'a branch needs a name';
  if (branch === 'main') return null;
  if (branch.startsWith('archive/')) return null;
  if (!branch.startsWith(`${WORK_PREFIX}/`)) {
    return `${branch} does not start with ${WORK_PREFIX}/, so nothing says it is an agent's work`;
  }

  const segments = branch.slice(WORK_PREFIX.length + 1).split('/');
  if (segments.length > 2) {
    return `${branch} carries ${segments.length} segments; the shape is ${WORK_PREFIX}/<worktree> or ${WORK_PREFIX}/<worktree>/<topic>`;
  }
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) {
      return `${branch} carries "${segment}"; every segment is lowercase letters, digits and single hyphens`;
    }
  }
  if (segments.length === 2 && segments[0] === segments[1]) {
    return `${branch} names its topic twice; ${WORK_PREFIX}/${segments[0]} is the branch`;
  }
  return null;
}

// WHY A TIDY FORM IS OFFERED AND NEVER APPLIED.
// A branch that already exists may be checked out on another machine and named in an open pull request, so renaming it is a decision its owner makes.
// Printing the name it should have had is the whole intervention: the rename is then one command, and the move is visible in the history.

export function normaliseBranch(name) {
  const branch = String(name ?? '').trim();
  if (branch === 'main' || branch.startsWith('archive/')) return branch;
  const rest = branch.startsWith(`${WORK_PREFIX}/`) ? branch.slice(WORK_PREFIX.length + 1) : branch;
  const parts = rest.split('/').map(slugWord).filter(Boolean);
  if (parts.length === 0) return `${WORK_PREFIX}/unnamed`;
  const [worktree, ...tail] = parts;
  const topic = tail.filter((part) => part !== worktree).join('-');
  return topic ? `${WORK_PREFIX}/${worktree}/${topic}` : `${WORK_PREFIX}/${worktree}`;
}

// WHY THE WORKTREE SCRIPT CALLS THIS INSTEAD OF BUILDING A STRING.
// The script used to default the topic to the name, so every branch made without a topic repeated itself, and a name with a space reached git and died as `fatal: ... is not a valid branch name`.
// One function is the shape, so the branch a worktree gets and the branch a report accepts cannot disagree.

export function workBranch(who, topic = '') {
  const worktree = slugWord(who);
  if (!worktree) throw new Error(`"${who}" is not a name: use letters and digits, joined by hyphens`);
  const line = slugWord(topic);
  if (String(topic ?? '').trim() && !line) {
    throw new Error(`"${topic}" is not a topic: use letters and digits, joined by hyphens`);
  }
  if (!line || line === worktree) return `${WORK_PREFIX}/${worktree}`;
  return `${WORK_PREFIX}/${worktree}/${line}`;
}

// WHY THE REPORT SPLITS THE BRANCHES AND DOES NOT JUDGE THEM ALONE.
// A list of every branch with a verdict is how a messy namespace becomes a short list of renames; a count alone would be a number nobody can act on.

export function reviewBranches(names) {
  const ok = [];
  const tidy = [];
  for (const entry of names) {
    const name = String(entry ?? '').trim();
    if (!name || name === 'HEAD' || name.endsWith('/HEAD')) continue;
    if (branchProblem(name) === null) ok.push(name);
    else tidy.push({ name, suggestion: normaliseBranch(name) });
  }
  return { ok, tidy };
}

function branchNames() {
  const labels = (() => {
    try {
      return execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin'],
        { encoding: 'utf8' }).split('\n').map((line) => line.trim()).filter(Boolean);
    } catch {
      return [];
    }
  })();

  // WHY THE REMOTE PREFIX IS STRIPPED HERE AND NOT IN THE RULE.
  // A branch is one name wherever it is checked out, and `origin/` is where this clone found it rather than part of its name.
  // The label travels beside the name so a report can say whether the clone has it locally, on the remote, or both.
  const seen = new Map();
  for (const label of labels) {
    const name = label.replace(/^origin\//, '');
    const where = seen.get(name);
    if (where === 'local') continue;
    seen.set(name, label === name ? 'local' : 'origin');
  }
  return [...seen].map(([name, where]) => ({ name, where }));
}

function report() {
  const branches = branchNames();
  const { ok, tidy } = reviewBranches(branches.map(({ name }) => name));
  const width = Math.max(0, ...tidy.map(({ name }) => name.length));
  const where = new Map(branches.map((entry) => [entry.name, entry.where]));

  console.log(`work branches on this clone, against ${WORK_PREFIX}/<worktree> or ${WORK_PREFIX}/<worktree>/<topic>`);
  console.log('');
  for (const name of ok) console.log(`  ok    ${name}  (${where.get(name)})`);
  for (const { name, suggestion } of tidy) {
    console.log(`  tidy  ${name.padEnd(width)} -> ${suggestion}  (${where.get(name)})`);
  }
  console.log('');

  const total = ok.length + tidy.length;
  if (tidy.length === 0) {
    console.log(`${total} branches, all of them in the shape`);
    return 0;
  }
  console.log(`${tidy.length} of ${total} branches do not fit the shape.`);
  console.log('Rename the ones you own with `git branch -m <old> <new>`, push the new name and delete the old one; the rest wait for archive/.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(report());
}
