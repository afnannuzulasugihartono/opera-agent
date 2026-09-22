import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const migrationUrl = new URL(
  '../supabase/migrations/20260919171500_pre_8e_r5_media_fast_path.sql',
  import.meta.url
);
const migrationExists = fs.existsSync(migrationUrl);
const migration = migrationExists ? fs.readFileSync(migrationUrl, 'utf8') : '';
const mcpSource = fs.readFileSync(
  new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url),
  'utf8'
);

test('R5 adds a versioned internal media.sample_at workflow with local seek semantics', () => {
  assert.equal(
    migrationExists,
    true,
    'R5 media fast-path migration must exist before implementation can pass'
  );
  assert.match(migration, /opera_register_workflow/);
  assert.match(migration, /media\.sample_at/);
  for (const method of ['media.state', 'media.pause', 'media.seek', 'media.play']) {
    assert.match(migration, new RegExp(method.replace('.', '\\.')));
  }
  assert.match(migration, /steps\.before\.result\.media\.paused/);
  assert.match(migration, /input\.seconds/);
});

test('R5 media sampling does not seek by navigation or reload', () => {
  assert.equal(migrationExists, true);
  assert.doesNotMatch(migration, /"method"\s*:\s*"tabs\.(?:navigate|reload)"/);
  assert.doesNotMatch(migration, /(?:[?&#](?:t|start)=|time_continue)/i);
});

test('R5 keeps media controls internal and preserves the 19-tool public MCP surface', () => {
  const registered = [
    ...mcpSource.matchAll(/server\.registerTool\("([a-z_]+)"/g)
  ].map((match) => match[1]);
  assert.equal(registered.length, 22); // U-T rebaseline
  assert.equal(registered.some((name) => name.startsWith('media_')), false);
  assert.doesNotMatch(mcpSource, /server\.registerTool\("media_/);
});
