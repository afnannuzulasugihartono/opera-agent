// @last-edited: 2026-11-02 UTC+7.
// @title: agent-worktree — one worktree per agent, so any coding agent can share this repo.
// @state: create, list, remove; the branch is the shape branch-name.mjs defines, and the delete path says what it archived instead of promising what it did.
// @dependencies: node:child_process, node:fs, node:path, node:url, branch-name.

// WHY THIS EXISTS AND WHY IT IS NOT A TOOL PLUGIN.
// The agents that work on this repo are not all the same: Kilo, Cline, OpenCode, and whatever comes next.
// A worktree is the one isolation mechanism every one of them already understands, because it is git itself, so the workflow is a script and a rule in AGENTS.md rather than a setting inside any one tool.
// An agent that edits the shared checkout collides with every other agent on the same file; an agent in its own worktree cannot.

// WHY EVERY BRANCH IS TAGGED, MERGED OR NOT.
// A merged branch is reachable from main, so its tag is a convenience; an unmerged one is reachable from nothing, so its tag is the only thing standing between the delete and a session's reasoning being lost.
// Tagging both costs one command and makes the delete safe either way.

// WHY THE BRANCH IS ARCHIVED BEFORE IT IS DELETED.
// A branch that is merged and then deleted takes its reflog with it, and the commit that carried a session's reasoning becomes reachable from nothing.
// The tag keeps it addressable forever, so a delete is a housekeeping act and never a loss.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { dirname, join, resolve } from 'node:path';

import { branchLines, branchProblem, slugWord, workBranch, WORK_PREFIX } from './branch-name.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

// WHY A REFUSAL IS ONE SENTENCE.
// A git command that fails prints a stack trace and the whole command line, and the one line that says what went wrong is buried in it.
// Taking git's own fatal line and saying it alone makes the script's refusal the same size as the mistake.

const refusal = (error) => {
  const lines = String(error.stderr ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => line.startsWith('fatal:') || line.startsWith('error:')) ?? lines[0] ?? error.message;
};

const name = process.argv[2];
const arg = process.argv[3];

const commands = {
  create(wanted, base = 'main', topic = '') {
    if (!wanted || wanted.startsWith('-')) throw new Error('usage: agent-worktree.mjs create <name> [base-branch] [topic]');
    const branch = workBranch(wanted, topic);
    const at = branch.split('/')[1];
    const path = join(repo, '..', `opera-agent-${at}`);
    if (existsSync(path)) throw new Error(`${path} already exists; pick another name, or remove it first`);
    try {
      git('rev-parse', '--verify', '--quiet', `${base}^{commit}`);
    } catch {
      throw new Error(`no branch or commit named ${base} in this checkout`);
    }
    git('worktree', 'add', path, '-b', branch, base);
    console.log(`worktree ${path} on ${branch}`);

    // WHY THE ENV FILES TRAVEL WITH THE WORKTREE.
    // A fresh worktree has no node_modules and no env, and the first thing an agent does in it is run the gates, which need both.
    // The env files are the machine's own, so they are copied rather than generated, and they stay out of git.
    for (const file of readdirSync(repo)) {
      if (/^\.env(\..+)?$/.test(file)) copyFileSync(join(repo, file), join(path, file));
    }
    // WHY THE INSTALL IS npm install AND NOT npm ci.
    // This repo ships no package lock: it has no runtime dependencies to pin, and the lock the tree does carry is gates.lock, which pins hashes and says nothing about packages.
    // npm ci refuses a project with no lock, so a fresh worktree would fail on the one command that makes it usable.
    // npm runs through a shell on Windows because an agent types npm and that is npm.cmd, which Node refuses to spawn bare since the 2024 security fix.

    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    execFileSync(npm, ['install'], { cwd: path, stdio: 'inherit', shell: process.platform === 'win32' });
    console.log(`${path} is ready: dependencies installed, env copied, gates runnable`);
  },

  list() {
    const worktrees = git('worktree', 'list', '--porcelain')
      .split('\n\n')
      .filter(Boolean)
      .map((entry) => Object.fromEntries(entry.split('\n').map((line) => [line.split(' ')[0], line.split(' ').slice(1).join(' ')])));
    for (const entry of worktrees) {
      const checked = entry.branch ? entry.branch.replace('refs/heads/', '') : null;
      const branch = checked ?? '(detached)';
      const isThis = entry.worktree === repo;
      const problem = checked ? branchProblem(checked) : null;
      const notes = [isThis ? 'main checkout, never drive from here' : '', problem ?? ''].filter(Boolean);
      console.log(`${branch.padEnd(44)} ${entry.worktree}${notes.length ? `  <- ${notes.join('; ')}` : ''}`);
    }
  },

  // WHY THE BRANCH IS LOOKED UP INSTEAD OF ASSUMED.
  // The old path deleted the worktree, then archived `agent/<name>/*` and printed that the branch lived on under archive/ whatever it found.
  // When the name it was given held nothing, it archived nothing and still said so, and a caller reading the sentence believed a branch had been kept that was never there.
  // The branches this script can have made are `agent/<name>` and `agent/<name>/<topic>`, so both are read, and zero is reported as zero.

  remove(wanted) {
    if (!wanted) throw new Error('usage: agent-worktree.mjs remove <name>');
    const at = slugWord(wanted);
    if (!at) throw new Error(`"${wanted}" is not a name: use letters and digits, joined by hyphens`);
    const path = join(repo, '..', `opera-agent-${at}`);
    const hadWorktree = existsSync(path);
    const branches = branchLines(git('branch', '--list', `${WORK_PREFIX}/${at}`, `${WORK_PREFIX}/${at}/*`));

    if (!hadWorktree && branches.length === 0) {
      throw new Error(`nothing named ${wanted}: no worktree at ${path} and no branch under ${WORK_PREFIX}/${at}`);
    }

    const merged = git('branch', '--merged', 'main').split('\n').map((line) => line.trim().replace('* ', ''));

    if (hadWorktree) git('worktree', 'remove', path, '--force');
    for (const line of branches) {
      const state = merged.includes(line) ? 'merged' : 'unmerged';
      const tag = `archive/${line}-${new Date().toISOString().slice(0, 10)}`;
      git('tag', '-a', tag, '-m', `${line} (${state})`);
      git('branch', '-D', line);
      console.log(`archived ${line} as ${tag} (${state}), then deleted the branch`);
    }

    console.log(hadWorktree ? `worktree ${path} removed` : `no worktree at ${path}`);
    if (branches.length === 0) {
      console.log(`no branch was left to archive: nothing was there on ${WORK_PREFIX}/${at}`);
      return;
    }
    console.log(`${branches.length} of its branches live on under archive/`);
  }
};

if (!commands[name]) {
  console.log('usage: node scripts/agent-worktree.mjs <create|list|remove> [name] [base] [topic]');
  console.log('  create <name> [base] [topic]  a worktree at ../opera-agent-<name> on agent/<name>, or agent/<name>/<topic> when a topic is given');
  console.log('  list                          every worktree, the branch it holds, and whether that branch fits the shape');
  console.log('  remove <name>                 archive the branches under agent/<name>, drop the worktree');
  process.exit(1);
}

try {
  commands[name](arg, process.argv[4], process.argv[5]);
} catch (error) {
  console.error(`agent-worktree: ${refusal(error)}`);
  process.exit(1);
}
