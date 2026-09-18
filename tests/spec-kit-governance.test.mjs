import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const skillNames = [
  'analyze','clarify','constitution','converge','implement',
  'plan','checklist','specify','tasks','taskstoissues',
];

test('Spec Kit governance scaffold stays complete and bounded', async () => {
  const init = JSON.parse(await readFile('.specify/init-options.json', 'utf8'));
  assert.equal(init.speckit_version, '1.0.8');
  assert.equal(init.ai, 'codex');
  assert.equal(init.ai_skills, true);
  assert.equal(init.script, 'ps');

  const integration = JSON.parse(await readFile('.specify/integration.json', 'utf8'));
  assert.equal(integration.default_integration, 'codex');
  assert.equal(integration.integration_settings.codex.invoke_separator, '-');
  assert.equal(integration.integration_settings.codex.parsed_options.events, 'false');

  const constitution = await readFile('.specify/memory/constitution.md', 'utf8');
  assert.match(constitution, /AGENTS\.md.*SECURITY\.md/s);
  assert.match(constitution, /P6 is \*\*ACCEPTED \/ CLOSED\*\*/);
  assert.match(constitution, /Milestone 8E remains paused\/not started/);
  assert.match(constitution, /Unrequested implementation.*scope creep/s);

  for (const name of skillNames) {
    const path = `.agents/skills/speckit-${name}/SKILL.md`;
    const body = await readFile(path, 'utf8');
    assert.match(body, new RegExp(`name: "speckit-${name}"`));
    assert.doesNotMatch(body, /__SPECKIT_COMMAND_[A-Z0-9_-]+__/);
    assert.doesNotMatch(body, /\{SCRIPT\}/);
  }

  const guide = await readFile('docs/SPEC_KIT_GOVERNANCE.md', 'utf8');
  assert.match(guide, /Spec Kit does not replace existing governance/);
  assert.match(guide, /P6 is \*\*ACCEPTED \/ CLOSED\*\*/);
  assert.match(guide, /8E remains paused/);
});
