// @last-edited: 2026-10-08 UTC+7.
// @title: recon-workflows.test — Test.
// @state: locks the unknown-site recon order: detect, map, act, verify plus the CAPTCHA stop.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261009000001_opera_agent_browse_recon.sql', import.meta.url), 'utf8'
);

function definition() {
  const match = migration.match(/\$wf\$(.*?)\$wf\$/s);
  assert.ok(match, 'migration must embed the workflow JSON');
  return JSON.parse(match[1]);
}

const STRONG = ['recaptcha', 'captcha', 'verify you are human', 'select all images'];
const WEAK = ['consent', 'privacy notice'];
const COMMAND_BUDGET = 12;

function walk(steps, visit, conditions = []) {
  for (const step of steps || []) {
    visit(step, conditions);
    const nest = (branch) => walk(branch, visit, [...conditions, step.condition]);
    if (step.type === 'if') { nest(step.then); nest(step.else); }
    if (step.type === 'repeat' || step.type === 'foreach') walk(step.steps, visit, conditions);
  }
}
const condText = (c) => JSON.stringify(c || {});

test('recon runs detect, map, act, verify in order with honest failures', () => {
  const def = definition();
  const ids = def.steps.map((s) => s.id || s.name);
  assert.ok(ids.indexOf('read0') < ids.indexOf('collect'), 'read before map');
  const fails = [];
  walk(def.steps, (s) => { if (s.type === 'fail') fails.push(s.code); });
  assert.deepEqual([...new Set(fails)].sort(), ['CAPTCHA_BLOCKED', 'TARGET_NOT_FOUND', 'VERIFY_FAILED']);
});

test('every strong pattern blocks alone, weak patterns block only in pairs', () => {
  const def = definition();
  const findText = {};
  walk(def.steps, (s) => { if (s.type === 'command' && s.method === 'page.find') findText[s.id] = s.params.text; });
  for (const p of STRONG) assert.ok(Object.values(findText).includes(p), `strong pattern missing: ${p}`);
  for (const p of WEAK) assert.ok(Object.values(findText).includes(p), `weak pattern missing: ${p}`);
  const patternsIn = (conds) => conds
    .flatMap((c) => [...condText(c).matchAll(/steps\.([A-Za-z0-9_]+)\.result\.count/g)].map((m) => m[1]))
    .map((id) => findText[id])
    .filter(Boolean);
  const violations = [];
  walk(def.steps, (s, conditions) => {
    if (s.type !== 'if') return;
    const branches = [...(s.then || []), ...(s.else || [])];
    if (!branches.some((b) => b.type === 'set' && b.name === 'blocked' && b.value === true)) return;
    const pats = patternsIn([...conditions, s.condition]);
    const strongHits = pats.filter((p) => STRONG.includes(p));
    const weakHits = pats.filter((p) => WEAK.includes(p));
    if (strongHits.length === 0 && weakHits.length < 2) violations.push(pats);
  });
  assert.deepEqual(violations, [], 'consent alone must never block');
});

test('recon uses only known runner step types and methods, within budget', () => {
  const def = definition();
  const types = new Set(['command', 'if', 'set', 'repeat', 'foreach', 'wait', 'fail']);
  const methods = new Set(['page.read', 'page.find', 'page.collect_links', 'page.click', 'page.fill']);
  let commands = 0;
  walk(def.steps, (s) => {
    assert.ok(types.has(s.type), `unknown step type ${s.type}`);
    if (s.type === 'command') {
      commands += 1;
      assert.ok(methods.has(s.method), `unknown method ${s.method}`);
    }
    assert.ok(s.type !== 'repeat', 'recon carries no repeat');
    if (s.type === 'command' && s.method === 'page.find') assert.equal(s.params.exact, false, 'generic-first: never exact');
  });
  assert.ok(commands <= COMMAND_BUDGET, `${commands} commands exceed budget ${COMMAND_BUDGET}`);
  assert.ok(!JSON.stringify(def.steps).includes('page.scroll'), 'nothing may sit between find and click');
});

test('output reports honestly', () => {
  const def = definition();
  for (const key of ['blocked', 'found', 'title', 'url']) assert.ok(def.output[key] !== undefined, `output misses ${key}`);
});
