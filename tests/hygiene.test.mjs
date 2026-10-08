// @last-edited: 2026-10-06 14:45 UTC+7.
// @title: hygiene — runtime properties, comment spacing, allowlist paths, logic gates.
// @state: The memoized read path, the comment-spacing rule over untracked files, allowlist paths and four rule gates are locked.
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

// WHY .ts rides along: the edge functions import shared lib/ modules by relative
// path, so a guard that reads only .mjs calls production imports dead. Measured:
// eight symbols it flagged are imported by opera-agent-vm and
// opera-agent-transactions-8d, and deleting any one of them breaks a deploy.

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

const background = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');

test('every comment block is spaced from the code it does not document', async () => {
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
  // WHY the hub and not a size: the hub was shortened to three sections on purpose,
  // so a line count would fire on the simplification it was written to survive. What
  // has to hold is that the file still binds — an empty hub passes a line count.
  const hub = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');
  assert.match(hub, /^## Always$/m, 'sanity: the hub is the file that carries the commands');
  assert.match(hub, /100 percent freedom/, 'the hub still binds the agent');

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

// The three sections an agent is guaranteed to read, in the order it reads them.
// Asserted rather than described: a rename that breaks the per-turn trigger would
// leave the trigger pointing at a section that no longer exists, and that is
// invisible in review.
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
    // Every section has to carry instructions: Always and Goals in bullets,
    // Priority order in its numbered list. The count is the proof it instructs.
    const bullets = (section.match(/^(?:- |\d+\. )/gm) || []).length;
    assert.ok(bullets >= 3, `${name} carries ${bullets} instruction lines; it must actually instruct`);
  }
});

test('every section the rules point at exists', async () => {
  const body = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');
  const headings = new Set([...body.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()));
  // The Always block names the sections it rides with. A renamed section leaves
  // those names pointing at nothing, which reads as a typo.
  const referenced = new Set(['Always', 'Goals', 'Priority order']);
  const dangling = [...referenced].filter((name) => !headings.has(name));
  assert.deepEqual(dangling, []);
});

// WHY this threshold and not a tighter one: the bar sits just under the observed
// overlap of rules that merely share vocabulary, which is how a lock trains
// people to ignore it. Volume is not asserted: the rule set is intentionally
// small now, and the pairwise check below is what inspects it.
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
  // WHY a word-boundary match and not `^Do`: the goals are one bullet each, so the
  // command sits mid-sentence after the bold name ("Do the deploy work that is
  // yours"). A line-anchored regex reads that file as carrying no commands at all,
  // which is how a gate that inspects nothing comes to pass for a clean tree.
  const commands = (body.match(/\bDo(?:n't)?\s+\S/g) || []).length;
  assert.ok(commands >= 4, `AGENTS.md carries only ${commands} commands; the gates are reading too little`);
  // WHY the location and not just the count: the simplification keeps the command
  // dialect inside Goals only, so Always and Priority order stay plain binding
  // prose. A Do creeping back elsewhere means the old manual is regrowing.
  const goalsAt = body.indexOf('## Goals');
  const priorityAt = body.indexOf('## Priority order');
  const goals = body.slice(goalsAt, priorityAt);
  for (const line of body.split('\n')) {
    if (/\bDo(?:n't)?\s+\S/.test(line)) assert.ok(goals.includes(line), `command outside Goals: ${line.trim().slice(0, 60)}`);
  }
});

test('every relative link in a document resolves to a file in the tree', async () => {
  // WHY this gate: moving a document is a mechanical act that leaves its own links
  // behind, and a link to a file one directory up still reads correctly in the
  // source. Every such link in the tree was dead when the security policy moved
  // from the root into docs/, and only a reader following it would have found out.
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
    background.indexOf('// ---- Event-Triggered Workflows: watch registry')
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

test('no module under extension/, lib/, scripts/ or supabase/functions/ exports a symbol nothing reaches', async () => {
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
  //
  // WHY supabase/functions joined the scan: the roots were extension/ and lib/,
  // so the six _shared modules every edge function imports were never
  // inspected, and validateProof sat there with exactly one occurrence of its
  // own name in the whole tree -- the declaration. The guard had already been
  // generalised once to stop a dead export accumulating; leaving a whole
  // directory outside it hid the case that mattered.
  //
  // WHY a use inside the exporting file counts as reached, and only where it
  // weakens nothing: an error class is constructed and caught in the module that
  // declares it, so ProofError, LedgerTokenError and VmHostTokenError are live
  // without a second file ever naming them, and an external-only rule here would
  // delete three classes that run on every call. For extension/ and lib/ the
  // stricter promise is kept and asserted on its own line: a symbol there still
  // needs a caller in another file.
  //
  // WHY scripts/ is judged, and what "the entry point" means there: a script is a
  // program, so it is entered by its shebang or by the shell, not imported -- five
  // of the six .mjs files there export nothing at all, which is exactly what that
  // looks like. The sixth stamped `export` on the one function its own guarded main
  // already calls by bare name, and no test, module or script imported it, so the
  // keyword promised a reusable API no file used. The gate judges the file, not the
  // directory name, so it finds that without knowing which file is the script; the
  // repair is to drop the keyword, not to invent a consumer.
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
  // The _shared modules are .js, so the same collector is the whole edge scan:
  // nothing under supabase/functions is a .ts that declares an exportable symbol.
  const edgeModules = (await Promise.all(['../supabase/functions'].map((d) => collect(d, jsFiles)))).flat();
  const scriptModules = await collect('../scripts', /\.mjs$/);
  const modules = [...runtimeModules, ...edgeModules, ...scriptModules];

  // Consumers: every runtime module, every fast-suite test, every script, and
  // every edge function entry point.
  const testDir = await collectTests('../tests');
  const edgeDir = await collectTests('../supabase/functions');
  const scripts = (await readdir(new URL('../scripts', import.meta.url)))
    .filter((n) => n.endsWith('.mjs'))
    .map((n) => `../scripts/${n}`);
  // A file that is both a scanned module and a consumer (every script is) is read
  // once; the Set drops the duplicate path, never the file.
  const consumers = await Promise.all(
    [...new Set([...modules, ...testDir, ...edgeDir, ...scripts])]
      .map(async (p) => ({ p, text: await readFile(new URL(p, import.meta.url), 'utf8') }))
  );

  const pattern = (name) => `\\b${name.replace(/\$/g, '\\$')}\\b`;
  const dead = [];
  const noCaller = [];
  for (const { p, text } of consumers.filter(({ p }) => modules.includes(p))) {
    const names = [...text.matchAll(
      /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm
    )].map((m) => m[1]);
    for (const name of names) {
      const usedElsewhere = consumers.some(
        (other) => other.p !== p && new RegExp(pattern(name)).test(other.text)
      );
      // Occurrences in the exporting file. One is the declaration alone, so
      // nothing there reads the name back; two or more is a real use.
      const usesHere = (text.match(new RegExp(pattern(name), 'g')) || []).length;
      const where = `${p.split('/').slice(-2).join('/')} :: ${name}`;
      if (!usedElsewhere && usesHere <= 1) dead.push(where);
      if (!usedElsewhere && runtimeModules.includes(p)) noCaller.push(where);
    }
  }
  assert.deepEqual(dead, [], 'these exports are referenced nowhere at all');
  assert.deepEqual(noCaller, [], 'these extension/ and lib/ exports have no caller in another file');
});
