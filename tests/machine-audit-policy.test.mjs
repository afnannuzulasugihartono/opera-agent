import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The machine-audit policy (2026-10-03).
//
// The owner changed the audit requirement from "Codex performs an independent
// audit" to "a machine audit is the required default". This file pins that
// change, because a policy that only says "machine is enough" is
// indistinguishable from "the author may sign their own work". Four of the
// assertions below protect against exactly that regression, and one of them
// protects a violation that has actually happened in this repository.

const agentsPath = new URL('../AGENTS.md', import.meta.url);
const agents = fs.readFileSync(agentsPath, 'utf8');

const policyStart = agents.indexOf('## Audit policy');
const policyEnd = agents.indexOf('## Evidence-first bug repair loop');
assert.ok(policyStart >= 0 && policyEnd > policyStart, 'the policy section must exist and be findable');
const policy = agents.slice(policyStart, policyEnd);

test('a machine audit is the default, and Codex is permitted but not required', () => {
  assert.match(policy, /machine audit is the required default/);
  // Codex stays allowed. Only the exclusivity is gone.
  assert.match(policy, /a separate agent session, or Codex/);
  assert.doesNotMatch(
    policy,
    /Codex performs\s+an independent audit/,
    'Codex must no longer be the sole mandated auditor'
  );
});

test('the auditor may not be the session that wrote the code', () => {
  assert.match(policy, /must be a session that did\s+not write the code under review/);
  // Phrased positively, and the converse is spelled out so it cannot be read
  // the other way round by an agent looking for permission.
  assert.doesNotMatch(policy, /may also audit its own/);
});

test('the auditor is read-only, and the authority list is explicit', () => {
  assert.match(policy, /must be\s+read-only/);
  for (const authority of ['no edit', 'commit', 'push', 'deployment', 'production authority']) {
    assert.ok(
      policy.includes(authority),
      `read-only must explicitly exclude: ${authority}`
    );
  }
});

test('fresh task context is required, not merely implied by "separate"', () => {
  assert.match(policy, /fresh task context/);
});

test('the auditor is given head and diff range, not the author\'s reasoning', () => {
  assert.match(policy, /exact head, the diff range, and the question/);
  assert.match(policy, /Do not hand it a summary of your\s+own\s+reasoning and call that a scope/);
});

test('the four-way distinction survives the change', () => {
  // This is the part that carries the actual safety value, and it is the easiest
  // thing to lose while rewording an audit rule. "code present" is split across
  // two lines in the file, so it is matched as a pattern rather than a substring.
  for (const part of [
    /code\s+present/,
    /automated tests passing/,
    /live acceptance passing/,
    /production promotion/
  ]) {
    assert.match(policy, part, `the audit must still distinguish: ${part}`);
  }
});

test('the verdict vocabulary and the promotion gate survive', () => {
  for (const verdict of ['`PASS`', '`CONDITIONAL PASS`', '`FAIL`']) {
    assert.ok(policy.includes(verdict), `verdict vocabulary must include ${verdict}`);
  }
  assert.match(policy, /only `PASS` permits the next\s+milestone/);
});

test('a waiver must be recorded as an accepted risk, not look like a pass', () => {
  // This one is not hypothetical. On 2026-10-03 the owner waived an audit, and
  // nothing in the repository at that moment forced the waiver to leave a trace.
  // A reader of the next handoff could not have told a skipped audit from a
  // completed one. That is the specific failure this assertion exists to stop.
  assert.match(policy, /Where the\s+user waives the audit instead, record the waiver/);
  assert.match(policy, /the residual risk, and who\s+accepted it/);
  assert.match(policy, /a missing audit and an accepted risk must\s+never be readable as the same thing/);
});

test('the policy states what a machine auditor cannot do', () => {
  // Without this the rule reads as a clean swap, and the residual loss is
  // invisible to every future session.
  assert.match(policy, /shares its author'?s? blind spots/);
  assert.match(policy, /category of threat nobody thought to\s+check for/);
  assert.match(policy, /instead of letting a `PASS` stand in for human\s+judgement that never happened/);
});

test('rerunning the author\'s own checks is explicitly not an audit', () => {
  assert.match(policy, /only reruns what the author already ran has not audited\s+anything/);
  assert.match(policy, /if that is all it managed, it must say so in the\s+verdict/);
});

test('the addition did not restructure the section around it', () => {
  // The new prose sits inside the existing policy section rather than becoming
  // a new heading, so `repo-naming-governance` and the section slicing in
  // `preserve-before-overwrite-rule` keep working.
  // The full heading line, not just the "## " prefix.
  const headings = policy.match(/^#{2,3} .+$/gm) || [];
  // Renamed 2026-10-03 (owner-ordered short titles): the locator follows the
  // rename; the assertion itself is unchanged.
  assert.deepEqual(
    headings,
    ['## Audit policy'],
    'no new heading may be introduced inside the policy section'
  );
});

test('the rest of AGENTS.md is intact', () => {
  // Guards against an over-broad edit taking a neighbouring rule with it.
  assert.match(agents, /## Repository discipline/);
  assert.match(agents, /## Naming conventions/);
  // The spec-kit sections were intentionally removed 2026-10-03 with the skills
  // themselves (owner-ordered, history-free directives file). What must remain
  // is the single Skills table with the skill-tool invocation mechanism, not a
  // guardrail and not a removal changelog.
  assert.match(agents, /## Skills/);
  assert.match(agents, /skill\(\{ name: "<skill-name>" \}\)/);
  assert.match(agents, /karpathy-guidelines/);
  assert.doesNotMatch(agents, /## Spec Kit workflow guardrail/);
  assert.doesNotMatch(agents, /## Spec Kit skills removed/);
  assert.match(agents, /6\. \*\*Preserve before overwrite\.\*\*/);
  assert.match(agents, /7\. \*\*Acceptance basis is CI evidence\.\*\*/);
  // The reusable prompt pointer must remain reachable from the policy.
  assert.match(policy, /docs\/prompts\/chatgpt-web-checkpoint\.md/);
});

test('the file has no encoding damage', () => {
  const bytes = fs.readFileSync(agentsPath);
  assert.notEqual(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, true, 'no BOM');
  const text = bytes.toString('utf8');
  assert.equal((text.match(/\r/g) || []).length, 0, 'no CRLF');
  assert.doesNotMatch(text, /�/, 'no U+FFFD replacement characters');
});

const promptPath = new URL('../docs/prompts/chatgpt-web-checkpoint.md', import.meta.url);
const prompt = fs.readFileSync(promptPath, 'utf8');

test('AGENTS.md declares a doc precedence chain with the archive last', () => {
  // Stale docs (CircleCI-era records, old checkpoints) must lose to live files,
  // or grep-first agents drift. The chain names the loser explicitly.
  assert.match(agents, /archive \(historical, always loses\)/);
});

test('AGENTS.md declares a bootstrap order with an area pointer table', () => {
  assert.match(agents, /## Bootstrap order/);
  assert.match(agents, /\| Area \| Read first \|/);
});

test('skill loading is binding and recorded via a Karpathy trailer', () => {
  assert.match(agents, /carries a `Karpathy:` trailer/);
});

test('the audit checks skill use and surgical scope', () => {
  // The auditor reviews the diff, so surgical scope is checkable there even
  // though the loading act itself is not observable.
  assert.match(prompt, /state whether the session loaded the skill/);
});