import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The karpathy-guidelines skill (2026-10-03).
//
// Installed as a second, lighter layer on top of AGENTS.md, not instead of it.
// Three things are pinned here because each one is a way this file could quietly
// become harmful:
//
// 1. It must not outrank AGENTS.md. If an agent reads only the skill, it will
//    suggest things AGENTS.md forbids -- speculative flexibility, tidying adjacent
//    code, and stopping to plan before writing a failing test.
// 2. Its factual claim about provenance must stay visible: Karpathy did not write
//    it. A file named after someone implies authorship it does not have.
// 3. The sections that were edited must be edited for a reason that is recorded.
//    Otherwise a later reader cannot tell a deliberate adaptation from a drift.

const skillPath = new URL('../.agents/skills/karpathy-guidelines/SKILL.md', import.meta.url);
const skill = fs.readFileSync(skillPath, 'utf8');
const agents = fs.readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');

test('the skill is discoverable where the repo already keeps skills', () => {
  assert.ok(fs.existsSync(skillPath), 'SKILL.md must exist under .agents/skills/');
  // Frontmatter, matching the ten Spec Kit skills beside it.
  assert.ok(skill.startsWith('---\n'), 'frontmatter must be the first thing in the file');
  assert.match(skill, /name: "karpathy-guidelines"/);
  assert.match(skill, /description: ".+"/);
  assert.match(skill, /license: MIT/);
  // A description must actually say when to use it, or no agent loads it.
  const description = skill.match(/description: "([^"]+)"/)[1];
  assert.ok(description.length > 40, 'description must be specific enough to route on');
});

test('it does not claim Karpathy wrote it', () => {
  // The file is named after him and is widely described as his. It is not.
  assert.match(skill, /Not authored by Andrej Karpathy/);
  assert.match(skill, /community \(multica-ai\/andrej-karpathy-skills\)/);
  assert.match(skill, /derived_from/, 'provenance must point at the post it came from');
  assert.match(skill, /https:\/\/github\.com\/multica-ai\/andrej-karpathy-skills/);
});

test('AGENTS.md is declared as the binding authority, not AGENTS.md', () => {
  assert.match(skill, /`AGENTS\.md` wins/);
  assert.match(skill, /\*\*binding\*\*/);
  // And it must name the repo-specific rule that is stricter than "think first".
  // "think before coding" wraps across lines; "failing tests" is on one line.
  assert.match(skill, /is stricter than "think before\s+coding"/);
  assert.match(skill, /failing tests before runtime\s+behavior/);
});

test('principle 3 records the incident rather than just asserting the rule', () => {
  assert.match(skill, /mention it - don't delete it/);
  assert.match(skill, /opera_run_fast/);
  assert.match(skill, /Reporting is cheap; deleting someone else's artifact is a decision/);
  // The exception matters as much as the prohibition, or the rule is unfollowable.
  assert.match(skill, /this change supersedes/);
  assert.match(skill, /makes a preference\s+irreversible/);
});

test('principle 4 points at the repo bar for accepting a lock', () => {
  assert.match(skill, /made to fail on a realistic violation/);
  assert.match(skill, /both directions/);
  assert.match(skill, /running the thing, not reading it/);
});

test('principle 2 does not talk this repo out of its evidence', () => {
  // The risk: "no speculative flexibility" read as "skip the lock".
  assert.match(skill, /a lock is not "speculative flexibility"/i);
  // Wrapped across two lines in the file.
  assert.match(skill, /Simplicity applies to the mechanism, not to\s+the evidence/);
});

test('principle 1 covers the case this repo hit: an inaccessible prerequisite', () => {
  assert.match(skill, /Report an inaccessible prerequisite instead of working around it/);
  assert.match(skill, /Prefer a cheap reversible commit over an irreversible one/);
});

test('all four original principles survive the edit', () => {
  for (const heading of [
    '## 1. Think Before Coding',
    '## 2. Simplicity First',
    '## 3. Surgical Changes',
    '## 4. Goal-Driven Execution'
  ]) {
    assert.ok(skill.includes(heading), `${heading} must be present`);
  }
  // And the upstream trade-off line is not quietly dropped.
  assert.match(skill, /bias toward caution over speed/);
});

test('the skill references a rule that AGENTS.md actually contains', () => {
  // If AGENTS.md is edited and the rule moves, this file must not go stale into
  // pointing at something that no longer says what it claims.
  assert.match(agents, /6\. \*\*Preserve before overwrite\.\*\*/);
  assert.match(agents, /Mention, do not delete, pre-existing code/);
  assert.match(agents, /Never lock a removal in a test/);
  assert.match(skill, /`AGENTS\.md` rule 6/);
});

test('the file has no encoding damage', () => {
  const bytes = fs.readFileSync(skillPath);
  assert.notEqual(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, true, 'no BOM');
  const text = bytes.toString('utf8');
  assert.equal((text.match(/\r/g) || []).length, 0, 'no CRLF');
  // A U+FFFD replacement char, not a literal question mark -- the upstream text
  // contains a real question in "Would a senior engineer say this is
  // overcomplicated?", so a bare /\?/ check would flag legitimate content.
  assert.doesNotMatch(text, /\uFFFD/, 'no U+FFFD replacement characters');
  assert.equal((text.match(/\uFFFD/g) || []).length, 0);
});