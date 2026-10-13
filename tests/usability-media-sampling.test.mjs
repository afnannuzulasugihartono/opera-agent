// @last-edited: 2026-10-13 UTC+7.
// @title: usability-media-sampling — internal media sampling with local seek.
// @state: media.sample_at is registered with versioned local seek semantics, off the public surface.
// @dependencies: node:fs, node:test, strict.

// Why source-text pins, stated per AGENTS.md: an internal workflow is added here, so
// the lockable claim is where it is reachable and where it is not. These
// assertions read the migration to prove media.sample_at is registered with
// versioned local seek semantics, never seeks by navigation or reload, and
// stays off the public MCP surface -- the tool count is checked against the
// live source, so adding a public media tool would fail here. Runtime behavior
// for the workflow itself is exercised by the live suites, not here.

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

test('adds a versioned internal media.sample_at workflow with local seek semantics', () => {
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

test('media sampling does not seek by navigation or reload', () => {
  assert.equal(migrationExists, true);
  assert.doesNotMatch(migration, /"method"\s*:\s*"tabs\.(?:navigate|reload)"/);
  assert.doesNotMatch(migration, /(?:[?&#](?:t|start)=|time_continue)/i);
});

test('advertised media capabilities are invocable tools (decision superseded by measurement)', () => {

  const registered = [
    ...mcpSource.matchAll(/server\.registerTool\("([a-z_]+)"/g)
  ].map((match) => match[1]);
  assert.equal(registered.length, 31);
  for (const name of ['media_state', 'media_play', 'media_pause', 'media_seek']) {
    assert.ok(registered.includes(name), `${name} is exposed`);
  }
});
