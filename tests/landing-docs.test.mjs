// @last-edited: 2026-11-04 UTC+7.
// @title: landing-docs — the docs page says what the product does, and the code proves every number on it.
// @state: six sections, one map, and counts read from the source rather than typed.
// @dependencies: node:test, node:assert, node:fs, mcp surface, extension protocol.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mcpSurfaceSourceSync } from './helpers/mcp-surface-source.mjs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

test('the docs page carries six sections and one map', () => {
  const html = read('landing/docs.html');
  for (const id of ['pasang', 'pairing', 'tugas', 'saldo', 'mcp', 'batas']) {
    assert.match(html, new RegExp(`<h2 id="${id}"`), `${id} has a section`);
    assert.ok(html.includes(`href="#${id}"`), `${id} is reachable from the map`);
  }
  assert.match(html, /<ul class="toc"/, 'the map is a list');
});

test('the docs page states the counts the code proves', () => {
  const html = read('landing/docs.html');
  const mcp = mcpSurfaceSourceSync();
  const tools = (mcp.match(/registerTool\("/g) || []).length;
  assert.match(html, new RegExp(`\\b${tools} tool`), `the page states ${tools} tools`);

  const protocol = read('extension/lib/protocol.js');
  const specs = /METHOD_SPECS\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(protocol)?.[1] ?? '';
  const primitives = [...specs.matchAll(/^\s{2}'([a-z_]+\.[a-z_]+)':/gm)].length;
  assert.match(html, new RegExp(`\\b${primitives} primitive`), `the page states ${primitives} primitives`);

  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.permissions.length, 6);
  assert.match(html, /enam izin/i, 'the page states six permissions');
});

test('the docs page states the money the wallet enforces', () => {
  const html = read('landing/docs.html');
  const wallet = read('supabase/functions/_shared/wallet.js');
  assert.match(wallet, /ACTION_CAP = 10/, 'the code caps a job at ten actions');
  assert.match(html, /10 aksi/, 'and the page says so');
  assert.match(wallet, /HOLD_MS = 30 \* 60 \* 1000/, 'the hold lasts thirty minutes');
  assert.match(html, /30 menit/, 'and the page says so');
  assert.match(html, /dikembalikan penuh/, 'a failed job is refunded in full');
});

test('the docs page links to the doors a reader needs', () => {
  const html = read('landing/docs.html');
  for (const href of ['./unduh.html', './dashboard.html', './harga', './dukungan.html']) {
    assert.ok(html.includes(`href="${href}"`), `the page reaches ${href}`);
  }
});
