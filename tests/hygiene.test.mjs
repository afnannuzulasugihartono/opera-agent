// @last-edited: 2026-10-21 UTC+7.
// @title: hygiene — runtime properties, the canonical comment form, allowlist paths, logic gates.
// @state: The memoized read path, the comment form over every file in the tree, allowlist paths and four rule gates are locked.
// @dependencies: node:test, strict, promises, path, child_process, url, focus-gate, format-comments, extension-source.

// Properties that keep the runtime code correct as it grows, and that the code itself violated when first written.

// Each case here corresponds to a real defect found by audit, not a style preference.
// They are cheap and they fail loudly.

import test from 'node:test';
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FOCUS_GATE_ATTEMPTS } from '../extension/lib/focus-gate.js';
import { checkFormat } from '../scripts/format-comments.mjs';
import { extensionSource } from './helpers/extension-source.mjs';

const collectTests = async (dir) => {
  const out = [];
  for (const entry of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__') continue;
      out.push(...await collectTests(p));
    } else if (/\.(?:test\.)?(mjs|ts)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
};

await import('../extension/role-reconcile.js');
await import('../extension/hover-settle.js');

const background = await extensionSource();

test('every comment in the tree is in the canonical form the formatter writes', async () => {

  const { total, changed } = await checkFormat();
  assert.ok(total > 300, `the gate read ${total} files, so it is not reading the tree`);
  assert.deepEqual(changed, [], `${changed.length} files are not canonical:\n${changed.slice(0, 12).join('\n')}`);
});

test('no document says Do X and another says Don\'t X', async () => {
  const root = new URL('..', import.meta.url);

  const hub = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');
  assert.match(hub, /^## Always$/m, 'sanity: the hub is the file that carries the commands');
  assert.match(hub, /100 percent freedom/, 'the hub still binds the agent');

  const dir = fileURLToPath(root);
  const commands = new Map();
  const collect = (file) => {
    const body = fsSync.readFileSync(path.join(dir, file), 'utf8');
    const dos = new Set();
    const donts = new Map();
    body.split('\n').forEach((line, i) => {
      const key = line
        .replace(/^\s*[-*]?\s*/, '')
        .replace(/^(?:Do|Don't)\s+/, '')
        .replace(/\s+/g, ' ')
        .replace(/[.;:]$/, '')
        .toLowerCase();
      if (/^\s*[-*]?\s*Do\s+/.test(line)) dos.add(key);
      if (/^\s*[-*]?\s*Don't\s+/.test(line)) {
        if (!donts.has(key)) donts.set(key, i + 1);
      }
    });
    for (const [key, line] of donts) if (dos.has(key)) commands.set(`${file}:${line}`, key);
  };
  for (const file of execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.md'))) {
    collect(file);
  }
  assert.deepEqual([...commands.keys()], []);
});

const REQUIRED_SECTIONS = ['Always', 'Goals', 'Priority order'];

test('the three sections an agent reads every turn exist, in order', async () => {
  const body = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');
  const headings = [...body.matchAll(/^## (.+)$/gm)].map((m) => ({ name: m[1].trim(), at: m.index }));
  const found = REQUIRED_SECTIONS.map((name) => headings.find((h) => h.name === name));
  const missing = REQUIRED_SECTIONS.filter((name, i) => !found[i]);
  assert.deepEqual(missing, [], `AGENTS.md is missing: ${missing.join(', ')}`);
  assert.deepEqual(headings.map((h) => h.name), REQUIRED_SECTIONS, 'nothing rides beside the three');
  for (let i = 1; i < found.length; i += 1) {
    assert.ok(found[i].at > found[i - 1].at, `${found[i].name} must come after ${found[i - 1].name}`);
  }
  for (const { name, at } of found) {
    const section = body.slice(at).split('\n## ')[0];

    const bullets = (section.match(/^(?:- |\d+\. )/gm) || []).length;
    assert.ok(bullets >= 3, `${name} carries ${bullets} instruction lines; it must actually instruct`);
  }
});

test('every section the rules point at exists', async () => {
  const body = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');
  const headings = new Set([...body.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()));

  const referenced = new Set(['Always', 'Goals', 'Priority order']);
  const dangling = [...referenced].filter((name) => !headings.has(name));
  assert.deepEqual(dangling, []);
});

const DUPLICATE_OVERLAP = 0.6;

test('no rule is stated twice in two forms', async () => {
  const dir = fileURLToPath(new URL('..', import.meta.url));
  const rules = [];
  for (const file of execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.md'))) {
    const body = fsSync.readFileSync(path.join(dir, file), 'utf8');
    body.split('\n').forEach((line, i) => {
      const match = line.match(/^\s*[-*]?\s*Do(?:n't)?\s+(.+?)\.?\s*$/);
      if (!match) return;
      const tokens = new Set(match[1].toLowerCase()
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[`*_]/g, '')
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(Boolean));
      if (tokens.size >= 4) rules.push({ file, line: i + 1, tokens });
    });
  }
  assert.ok(rules.length > 0, 'the gate looked at a rule set');
  const duplicates = [];
  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      let shared = 0;
      for (const token of rules[i].tokens) if (rules[j].tokens.has(token)) shared += 1;
      const overlap = shared / (rules[i].tokens.size + rules[j].tokens.size - shared);
      if (overlap >= DUPLICATE_OVERLAP) duplicates.push(`${rules[i].file}:${rules[i].line} and ${rules[j].file}:${rules[j].line}`);
    }
  }
  assert.deepEqual(duplicates, [], duplicates.slice(0, 8).join('\n'));
});

test('the logic gate actually inspected the rule set', async () => {
  const dir = fileURLToPath(new URL('..', import.meta.url));
  const body = fsSync.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');

  const commands = (body.match(/\bDo(?:n't)?\s+\S/g) || []).length;
  assert.ok(commands >= 4, `AGENTS.md carries only ${commands} commands; the gates are reading too little`);

  const goalsAt = body.indexOf('## Goals');
  const priorityAt = body.indexOf('## Priority order');
  const goals = body.slice(goalsAt, priorityAt);
  for (const line of body.split('\n')) {
    if (/\bDo(?:n't)?\s+\S/.test(line)) assert.ok(goals.includes(line), `command outside Goals: ${line.trim().slice(0, 60)}`);
  }
});

test('every relative link in a document resolves to a file in the tree', async () => {

  const dir = fileURLToPath(new URL('..', import.meta.url));
  const tracked = execFileSync('git', ['ls-files', '*.md'], { cwd: dir, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const dead = [];
  for (const file of tracked) {
    const body = fsSync.readFileSync(path.join(dir, file), 'utf8');
    for (const [, target] of body.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      const wanted = target.split('#')[0];
      if (!wanted) continue;
      if (!fsSync.existsSync(path.resolve(dir, path.dirname(file), wanted))) dead.push(`${file} -> ${target}`);
    }
  }
  assert.deepEqual(dead, [], `documents point at files that are not there:\n${dead.join('\n')}`);
});

test('every gitleaks allowlist path still names a file in the tree', async () => {
  const root = new URL('..', import.meta.url);
  const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: fileURLToPath(root), encoding: 'utf8' })
    .split('\n')
    .filter(Boolean));
  const config = await readFile(new URL('../.gitleaks.toml', import.meta.url), 'utf8');

  const patterns = [...config.matchAll(/paths\s*=\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'''([^']+)'''/g)].map((n) => n[1]));
  const stale = [];
  for (const pattern of patterns) {

    const glob = pattern
      .replace(/^\^/, '')
      .replace(/\$$/, '')
      .replace(/\\\./g, '.')
      .replace(/\.\*/g, '*');
    if (glob.includes('*')) {
      const re = new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      if (![...tracked].some((f) => re.test(f))) stale.push(`${pattern} matches no tracked file`);
      continue;
    }
    if (!tracked.has(glob)) stale.push(`${pattern} names no tracked file`);
  }
  assert.deepEqual(stale, [], stale.join('\n'));
});

test('a read is serialized once, not once per size check', () => {

  const block = background.slice(
    background.indexOf('function boundedResult'),
    background.indexOf('function clearSerializedResult() {')
  );
  assert.ok(
    background.indexOf('function clearSerializedResult() {')
      > background.indexOf('function boundedResult'),
    'the result-sizing block must have a live end marker after boundedResult'
  );
  assert.equal((block.match(/JSON\.stringify\(/g) || []).length, 1, 'exactly one stringify in the result-sizing path');
  assert.match(background, /function serializeResult\(value\)/);
  assert.match(background, /if \(serializedResult\.value === value\) return serializedResult\.text;/);
  assert.match(block, /function oversized\(value\) \{\s*return serializeResult\(value\)\.length > MAX_RESULT_BYTES;/);
  const bounded = block.slice(block.indexOf('function boundedResult'), block.indexOf('function oversized'));
  assert.match(bounded, /const text = serializeResult\(value\)/);

  assert.match(background, /Result is not serializable\./);
});

test('the memo cannot retain a large result between commands', () => {

  assert.match(background, /let serializedResult = \{ value: null, text: '' \};/);
  const executor = background.slice(background.indexOf('async function executeCommand'));
  assert.match(executor.slice(0, 900), /clearSerializedResult\(\);/);
});

test('the focus-gate slice is a real block, not the whole file', () => {
  const start = background.indexOf('async function withForegroundFocusGate');
  const end = background.indexOf('const UV_WAIT_FLOOR_MS');
  assert.ok(start > 0, 'withForegroundFocusGate must exist');
  assert.ok(end > start, 'the next top-level constant must come after the function');
  const block = background.slice(start, end);
  assert.ok(block.split('\n').length >= 30 && block.split('\n').length <= 40,
    `expected a single function, got ${block.split('\n').length} lines`);
});

test('the focus gate loop is bounded by construction', () => {

  const gate = background.slice(
    background.indexOf('async function withForegroundFocusGate'),
    background.indexOf('const UV_WAIT_FLOOR_MS')
  );
  assert.doesNotMatch(gate, /for \([^;]*;\s*;/);
  assert.match(gate, /for \(let attempt = 1; attempt <= FOCUS_GATE_ATTEMPTS; attempt \+= 1\)/);
  assert.match(gate, /FOCUS_GATE_SETTLE_MS/);
  assert.equal(FOCUS_GATE_ATTEMPTS, 3);
});

test('the shared runtimes are frozen, so a sibling script cannot mutate them', () => {
  const roles = globalThis.OperaAgentRoleReconcile;
  const hover = globalThis.OperaAgentHoverSettle;
  assert.equal(Object.isFrozen(roles), true, 'the role runtime must be frozen');
  assert.equal(Object.isFrozen(hover), true, 'the hover runtime must be frozen');

  assert.equal(Array.isArray(roles.GENERIC_ROLES), true, 'GENERIC_ROLES must be an array, not a Set');
  assert.equal(Object.isFrozen(roles.GENERIC_ROLES), true);
  assert.throws(() => { roles.GENERIC_ROLES.push('button'); }, TypeError);
  assert.equal(roles.isGenericRole('button'), false, 'a rejected mutation must not take effect');
  assert.throws(() => { hover.DEFAULTS.timeoutMs = 99999; }, TypeError);
  assert.equal(hover.DEFAULTS.timeoutMs, 1500, 'the settle budget must be unchanged');
});

test('the role gap sample is a positive integer, not an accidental truthy value', () => {
  const { ROLE_GAP_SAMPLE_SIZE } = globalThis.OperaAgentRoleReconcile;
  assert.equal(Number.isInteger(ROLE_GAP_SAMPLE_SIZE), true);
  assert.ok(ROLE_GAP_SAMPLE_SIZE > 0);
});

test('the R9 modules expose no unused surface', async () => {

  const keyboard = await readFile(new URL('../extension/lib/keyboard.js', import.meta.url), 'utf8');
  const uses = keyboard.match(/keyNames/g) || [];
  assert.equal(uses.length, 2, 'keyNames must be referenced only by its declaration and its one caller');
  assert.match(keyboard, /export const KEY_ALLOWLIST = Object\.freeze\(keyNames\(\)\)/);

  assert.doesNotMatch(keyboard, /MODIFIER_ALLOWLIST/);

  assert.doesNotMatch(background, /export function isPlainObject/);
  const protocol = await readFile(new URL('../extension/lib/protocol.js', import.meta.url), 'utf8');
  assert.match(protocol, /^function isPlainObject\(value\)/m);
  assert.equal((protocol.match(/isPlainObject/g) || []).length, 7, 'declared once and used six times');
});

test('no module under extension/, lib/, scripts/ or supabase/functions/ exports a symbol nothing reaches', async () => {

  const runtimeRoots = ['../extension', '../lib'];
  const collect = async (dir, match) => {
    const out = [];
    for (const entry of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
      const p = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...await collect(p, match));
      else if (match.test(entry.name)) out.push(p);
    }
    return out;
  };
  const jsFiles = /\.js$/;
  const runtimeModules = (await Promise.all(runtimeRoots.map((d) => collect(d, jsFiles)))).flat();

  const edgeModules = (await Promise.all(['../supabase/functions'].map((d) => collect(d, jsFiles)))).flat();
  const scriptModules = await collect('../scripts', /\.mjs$/);
  const modules = [...runtimeModules, ...edgeModules, ...scriptModules];

  const testDir = await collectTests('../tests');
  const edgeDir = await collectTests('../supabase/functions');
  const scripts = (await readdir(new URL('../scripts', import.meta.url)))
    .filter((n) => n.endsWith('.mjs'))
    .map((n) => `../scripts/${n}`);

  const consumers = await Promise.all(
    [...new Set([...modules, ...testDir, ...edgeDir, ...scripts])]
      .map(async (p) => ({ p, text: await readFile(new URL(p, import.meta.url), 'utf8') }))
  );

  const pattern = (name) => `\\b${name.replace(/\$/g, '\\$')}\\b`;
  const dead = [];
  const noCaller = [];

  const callerText = new Map(consumers.map(({ p, text }) => [
    p,
    text.split('\n').filter((line) => !/^\s*export\b/.test(line)).join('\n'),
  ]));
  const textByPath = new Map(consumers.map(({ p, text }) => [p, text]));

  const collectExports = (p, text, visited) => {
    if (visited.has(p)) return [];
    visited.add(p);
    const names = [...text.matchAll(
      /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm
    )].map((m) => m[1]);
    for (const m of text.matchAll(/^export\s*\{([^}]*)\}(\s*from\s*['"][^'"]+['"])?/gm)) {
      const reexport = Boolean(m[2]);
      for (const item of m[1].split(',')) {
        const parts = item.split(/\s+as\s+/).map((s) => s.trim().replace(/^type\s+/, '').split(/\s+/)[0]).filter(Boolean);
        if (parts.length === 0) continue;
        const local = reexport ? parts[parts.length - 1] : parts[0];
        if (/^[A-Za-z_$][\w$]*$/.test(local)) names.push(local);
      }
    }
    for (const m of text.matchAll(/^export\s*\*\s*from\s*['"]([^'"]+)['"]/gm)) {
      const spec = m[1];
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(p), spec));
      const target = textByPath.get(resolved);
      if (target === undefined) throw new Error(`unresolvable star re-export ${p} -> ${spec} (resolved ${resolved})`);
      names.push(...collectExports(resolved, target, visited));
    }
    return [...new Set(names)];
  };
  for (const { p, text } of consumers.filter(({ p }) => modules.includes(p))) {
    const names = collectExports(p, text, new Set());
    for (const name of names) {
      const usedElsewhere = consumers.some(
        (other) => other.p !== p && new RegExp(pattern(name)).test(callerText.get(other.p))
      );

      const usesHere = (text.match(new RegExp(pattern(name), 'g')) || []).length;
      const where = `${p.split('/').slice(-2).join('/')} :: ${name}`;
      if (!usedElsewhere && usesHere <= 1) dead.push(where);
      if (!usedElsewhere && runtimeModules.includes(p)) noCaller.push(where);
    }
  }
  assert.deepEqual(dead, [], 'these exports are referenced nowhere at all');
  assert.deepEqual(noCaller, [], 'these extension/ and lib/ exports have no caller in another file');
});

test('every lib header states what is actually in the file', async () => {
  const boilerplate = 'MV3 runtime library, shared with the Node suite..';
  const dir = new URL('../extension/lib/', import.meta.url);
  const names = (await readdir(dir)).filter((n) => n.endsWith('.js')).sort();
  assert.ok(names.length >= 17, 'the lib directory must not be empty');
  const offenders = [];
  for (const name of names) {
    const text = await readFile(new URL(name, dir), 'utf8');
    if (text.includes(boilerplate)) offenders.push(name);
  }
  assert.deepEqual(offenders, [],
    `boilerplate header must be replaced with a description of the file: ${offenders.join(', ')}`);
});
