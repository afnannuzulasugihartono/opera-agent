// @last-edited: 2026-10-05 00:47 UTC+7.
// @title: hygiene — runtime properties, comment spacing, allowlist paths, logic gates.
// @state: The memoized read path, the comment-spacing rule over untracked files too, live allowlist paths and the .md logic gates are locked.
// @dependencies: node:test, strict, promises, path, child_process, url, focus-gate, comment-spacing.

// Properties that keep the runtime code correct as it grows, and that the code
// itself violated when first written.
//
// Each case here corresponds to a real defect found by audit, not a style
// preference. They are cheap and they fail loudly.

import test from 'node:test';
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FOCUS_GATE_ATTEMPTS } from '../extension/lib/focus-gate.js';
import { spacingViolations } from './helpers/comment-spacing.mjs';

// Recursively collect the code files under a directory. The dead-export guard
// below needs every runtime module and every test as a consumer, and it must
// discover new files rather than carry a list that goes stale.

const collectTests = async (dir) => {
  const out = [];
  for (const entry of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__') continue;
      out.push(...await collectTests(p));
    } else if (/\.(?:test\.)?mjs$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
};

await import('../extension/role-reconcile.js');
await import('../extension/hover-settle.js');

const background = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');

test('every comment block has a blank line before and after it', async () => {
  const root = new URL('..', import.meta.url);
  // WHY the filesystem and not git ls-files: a file written minutes ago is not
  // tracked yet, and that is exactly when the rule is easiest to break. CI proved
  // it -- lib/goal-plan.js shipped with two unspaced blocks because the lock never
  // saw an untracked file.
  const skip = new Set(['.git', 'node_modules', '.kilo', 'dist', 'build']);
  const walk = async (dir, prefix = '') => {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) out.push(...await walk(new URL(`${entry.name}/`, dir), relative));
      else out.push(relative);
    }
    return out;
  };
  const files = (await walk(root))
    // Migrations are applied artifacts and must never be rewritten; JSON has no
    // comments, and the lockfiles beside them are generated.
    .filter((f) => !f.startsWith('supabase/migrations/'))
    .filter((f) => f !== 'LICENSE')
    .filter((f) => !/\.(?:json|lock)$/.test(f));
  const violations = [];
  for (const file of files) {
    const text = await readFile(new URL(file, root), 'utf8');
    violations.push(...spacingViolations(file, text, path.extname(file).toLowerCase()));
  }
  assert.deepEqual(violations, [], violations.slice(0, 12).join('\n'));
});

test('no document says Do X and another says Don\'t X', async () => {
  const root = new URL('..', import.meta.url);
  const docs = (await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8'))
    .split('\n').length;
  assert.ok(docs > 100, 'sanity: the hub is the file that carries the commands');

  // WHY this shape: a rule stated as "Do X" in one file and "Don't X" in another
  // is a contradiction an agent cannot resolve by reading harder, and the two
  // files each look correct in review. Precedence settles it by hand; this fails
  // it in a second.
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

test('every gitleaks allowlist path still names a file in the tree', async () => {
  const root = new URL('..', import.meta.url);
  const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: fileURLToPath(root), encoding: 'utf8' })
    .split('\n')
    .filter(Boolean));
  const config = await readFile(new URL('../.gitleaks.toml', import.meta.url), 'utf8');
  // Only the path lists, never the regexes: a regex is content, not a location.
  const patterns = [...config.matchAll(/paths\s*=\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'''([^']+)'''/g)].map((n) => n[1]));
  const stale = [];
  for (const pattern of patterns) {
    // An allowlist entry is a regex over paths. Strip the anchors and treat the
    // remainder as a glob, so a history-only entry can widen to a shape that still
    // exists (docs/*.md) instead of naming a file that was renamed away.
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
  // page.read measures the result against the ceiling and the dispatcher then
  // measures it again. Without a memo, every read paid a second full
  // JSON.stringify on the hottest observation path in the product. The memo
  // covers RESULT sizing only; the file has other legitimate uses (request
  // body, cache key, burst size, error candidates), so the assertion is scoped
  // to the three functions involved.
  const block = background.slice(
    background.indexOf('function boundedResult'),
    background.indexOf('// ---- U-T Event-Triggered Workflows')
  );
  assert.equal((block.match(/JSON\.stringify\(/g) || []).length, 1, 'exactly one stringify in the result-sizing path');
  assert.match(background, /function serializeResult\(value\)/);
  assert.match(background, /if \(serializedResult\.value === value\) return serializedResult\.text;/);
  assert.match(block, /function oversized\(value\) \{\s*return serializeResult\(value\)\.length > MAX_RESULT_BYTES;/);
  const bounded = block.slice(block.indexOf('function boundedResult'), block.indexOf('function oversized'));
  assert.match(bounded, /const text = serializeResult\(value\)/);
  // Unserializable input still fails loudly rather than being silently accepted.
  assert.match(background, /Result is not serializable\./);
});

test('the memo cannot retain a large result between commands', () => {
  // The memo is keyed on identity, so it holds at most one result, but a stale
  // reference would pin a large object for the worker's lifetime. It is
  // cleared per command.
  assert.match(background, /let serializedResult = \{ value: null, text: '' \};/);
  const executor = background.slice(background.indexOf('async function executeCommand'));
  assert.match(executor.slice(0, 900), /serializedResult = \{ value: null, text: '' \};/);
});

test('the focus gate loop is bounded by construction', () => {
  // It was a conditionless for(;;), which reads as unbounded even though the
  // policy module always refuses on the final attempt.
  const gate = background.slice(
    background.indexOf('async function withForegroundFocusGate'),
    background.indexOf('// U-V Action Pipeline')
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
  // Object.freeze does NOT make a Set immutable, so the role list is published
  // as a frozen array. Assert it is an array, not a Set: handing out the Set
  // would leave it writable through .add().
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
  // keyNames() existed only to seed KEY_ALLOWLIST; a public helper nothing
  // calls is dead weight on a file a sibling script loads on every page.
  const keyboard = await readFile(new URL('../extension/lib/keyboard.js', import.meta.url), 'utf8');
  const uses = keyboard.match(/keyNames/g) || [];
  assert.equal(uses.length, 2, 'keyNames must be referenced only by its declaration and its one caller');
  assert.match(keyboard, /export const KEY_ALLOWLIST = Object\.freeze\(keyNames\(\)\)/);
  // MODIFIER_ALLOWLIST was exported and referenced nowhere at all, not even
  // inside its own file.
  assert.doesNotMatch(keyboard, /MODIFIER_ALLOWLIST/);
  // isPlainObject is a pure internal predicate; exporting it was dead surface.
  assert.doesNotMatch(background, /export function isPlainObject/);
  const protocol = await readFile(new URL('../extension/lib/protocol.js', import.meta.url), 'utf8');
  assert.match(protocol, /^function isPlainObject\(value\)/m);
  assert.equal((protocol.match(/isPlainObject/g) || []).length, 7, 'declared once and used six times');
});

test('no module under extension/ or lib/ exports a symbol nothing else reaches', async () => {
  // A general guard, so the next dead export fails here instead of
  // accumulating. A symbol is "reached" if it appears in any other runtime
  // file, any test, any script, or any edge function.
  //
  // Replaced a hand-picked list on 2026-10-03. Two reasons, both found by
  // running it against a tree it had never seen: the old version named seven
  // module files and twelve consumer files by hand, so a symbol consumed only
  // by an unlisted test read as dead, and any new module was unchecked
  // entirely. Its regex also read only `export const|function|class`, which
  // silently skipped `export async function` -- where three of the five dead
  // exports were hiding. AGENTS.md requires auto-discovery here for the same
  // reason `npm run check` must not carry a hand-written safety list.
  const roots = ['../extension', '../lib'];
  const collect = async (dir) => {
    const out = [];
    for (const entry of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
      const p = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...await collect(p));
      else if (entry.name.endsWith('.js')) out.push(p);
    }
    return out;
  };
  const modules = (await Promise.all(roots.map(collect))).flat();

  // Consumers: every runtime module, every fast-suite test, every script, and
  // every edge function entry point.
  const testDir = await collectTests('../tests');
  const edgeDir = await collectTests('../supabase/functions');
  const scripts = (await readdir(new URL('../scripts', import.meta.url)))
    .filter((n) => n.endsWith('.mjs'))
    .map((n) => `../scripts/${n}`);
  const consumers = await Promise.all(
    [...modules, ...testDir, ...edgeDir, ...scripts]
      .map(async (p) => ({ p, text: await readFile(new URL(p, import.meta.url), 'utf8') }))
  );

  const dead = [];
  for (const { p, text } of consumers.filter(({ p }) => p.startsWith('../extension/') || p.startsWith('../lib/'))) {
    const names = [...text.matchAll(
      /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm
    )].map((m) => m[1]);
    for (const name of names) {
      const usedElsewhere = consumers.some(
        (other) => other.p !== p && new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(other.text)
      );
      if (!usedElsewhere) dead.push(`${p.split('/').pop()} :: ${name}`);
    }
  }
  assert.deepEqual(dead, [], 'these exports are referenced nowhere else');
});
