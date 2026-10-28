// @last-edited: 2026-10-28 UTC+7.
// @title: agent-worktree — one worktree per agent, so any coding agent can share this repo.
// @state: create, list, remove; the delete path archives a merged branch before it drops it.
// @dependencies: node:child_process.

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

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

const name = process.argv[2];
const arg = process.argv[3];

const commands = {
  create(wanted, base = 'main', topic = wanted) {
    if (!wanted || wanted.startsWith('-')) throw new Error('usage: agent-worktree.mjs create <name> [base-branch] [topic]');
    const branch = `agent/${wanted}/${topic}`;
    const path = join(repo, '..', `opera-agent-${wanted}`);
    if (existsSync(path)) throw new Error(`${path} already exists; pick another name, or remove it first`);
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
      const branch = entry.branch?.replace('refs/heads/', '') ?? '(detached)';
      const isThis = entry.worktree === repo;
      console.log(`${branch.padEnd(44)} ${entry.worktree}${isThis ? '  <- main checkout, never drive from here' : ''}`);
    }
  },

  remove(wanted) {
    if (!wanted) throw new Error('usage: agent-worktree.mjs remove <name>');
    const path = join(repo, '..', `opera-agent-${wanted}`);
    const branch = `agent/${wanted}`;

    const merged = git('branch', '--merged', 'main').split('\n').map((line) => line.trim().replace('* ', ''));

    // WHY EVERY BRANCH IS TAGGED, MERGED OR NOT.
    // A merged branch is reachable from main, so its tag is a convenience; an unmerged one is reachable from nothing, so its tag is the only thing standing between the branch and a session's reasoning being lost.
    // Tagging both costs one command and makes the delete safe either way.

    if (existsSync(path)) git('worktree', 'remove', path, '--force');
    for (const line of git('branch', '--list', `${branch}/*`).split('\n').map((entry) => entry.trim()).filter(Boolean)) {
      const state = merged.includes(line) ? 'merged' : 'unmerged';
      const tag = `archive/${line}-${new Date().toISOString().slice(0, 10)}`;
      git('tag', '-a', tag, '-m', `${line} (${state})`);
      git('branch', '-D', line);
      console.log(`archived ${line} as ${tag} (${state}), then deleted the branch`);
    }
    console.log(`${wanted} is gone; its branch lives on under archive/`);
  }
};

if (!commands[name]) {
  console.log('usage: node scripts/agent-worktree.mjs <create|list|remove> [name] [base] [topic]');
  console.log('  create <name> [base] [topic]  a worktree at ../opera-agent-<name> on agent/<name>/<topic>');
  console.log('  list                          every worktree, and which branch it holds');
  console.log('  remove <name>                 archive the merged branch, drop the worktree');
  process.exit(1);
}

commands[name](arg, process.argv[4], process.argv[5]);
