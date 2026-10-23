// @last-edited: 2026-10-23 UTC+7.
// @title: latency-benchmark — how long the local driver takes, measured against a real browser.
// @state: a headless Chromium on a throwaway profile, a 100-row fixture, and the p50/p95 of every primitive and MCP tool.
// @dependencies: node:child_process, node:http, node:fs, node:os, node:path, driver, sessions, mcp-server.

// WHY THIS IS COMMITTED AND NOT AD-HOC.
// The latency report quotes numbers, and a number nobody can re-measure is a number nobody can check.
// This script is the reproduction: it launches its own headless browser on its own profile, serves its own fixture, drives the real driver and the real MCP surface, and prints p50/p95 next to the numbers the report claims.
// No user tab, profile or credential is touched, and the browser it launches is killed and its profile removed on the way out.

// WHY THE TEXT JOBS FOCUS THE FIELD FIRST.
// A stream of text with nothing focused fails fast by design, because text sent to a button cannot land and polling for a signature that will never move only measures the poll budget.
// So the input is focused before the text jobs, which is the same choice the original measurement made.

// WHY THE PAGE IS SCROLLED BACK BEFORE THE APPEND.
// A caret_line clicks a point on its way out of the restore, which moves focus to whatever sat under that point and can scroll the document with it.
// The append is measured after the page is scrolled back and the field is focused again, so it measures an append and not a click.

// WHY THE PROFILE CLEANUP IS TOLERANT OF FAILURE.
// The profile lives in the temp directory either way, so the failure is swallowed rather than turned into a red run.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installedBrowsers, openSession } from '../local/driver.js';
import { asDriver } from '../local/sessions.js';
import { createMcpServer } from '../local/mcp-server.js';

const PORT = 9466;
const runsArg = process.argv.find((value) => value.startsWith('--runs='));
const RUNS = Math.max(5, Math.min(200, Number(runsArg?.split('=')[1]) || 30));

// The fixture: a field to type into, a button to press, and a hundred rows to find.
// The field and the button are pinned to the top, so a scroll during one measurement cannot make the next one click off the page.

const FIXTURE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Latency fixture</title>
<style>body{font:14px sans-serif;margin:0}.row{padding:6px 10px;border-bottom:1px solid #eee}
#box{position:fixed;top:0;left:0;margin:0;padding:8px;border:1px solid #999;width:300px;background:#fff;z-index:5}
#run{position:fixed;top:0;left:320px;z-index:5}
#rows{margin-top:60px}</style></head>
<body>
<div id="box"><input id="field" aria-label="the field" placeholder="type here"></div>
<button id="run" role="button">Run</button>
<div id="rows">${Array.from({ length: 100 }, (_, i) =>
  `<div class="row" role="row" aria-label="Row ${i}">Row ${i}</div>`).join('\n')}
</div>
</body></html>`;

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return { p50: at(0.5), p95: at(0.95), n: sorted.length };
};

const line = (label, s) =>
  `  ${label.padEnd(32)} p50 ${s.p50.toFixed(2).padStart(8)} ms   p95 ${s.p95.toFixed(2).padStart(8)} ms   n=${s.n}`;

const bench = async (label, fn) => {
  await fn();
  const times = [];
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    await fn();
    times.push(performance.now() - started);
  }
  return { label, s: stats(times) };
};

const found = installedBrowsers().find((entry) => entry.binary);
if (!found) throw new Error('no Chromium browser was found on this machine');

const profile = mkdtempSync(join(tmpdir(), 'opera-latency-'));
const browser = spawn(found.binary, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  'about:blank'
], { detached: false, stdio: 'ignore' });

const http = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(FIXTURE);
});
await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${http.address().port}/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let up = false;
for (let i = 0; i < 100 && !up; i += 1) {
  try {
    up = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok;
  } catch {
    await sleep(100);
  }
}

let session = null;
try {
  if (!up) throw new Error(`no browser answered on port ${PORT}`);
  session = await openSession({ port: PORT, tabUrl: url, launch: false, viaBridge: false });
  const driver = asDriver(session);

  const mcpDriver = { ...driver, tabs: async () => [{ id: 't1', url, title: 'Latency fixture' }] };
  const server = createMcpServer({
    driver: mcpDriver,
    port: PORT,
    resolveTab: async () => ['t1'],
    open: async () => mcpDriver,
    close: async () => ({ closed: true })
  });
  const call = async (name, args = {}) => {
    const res = await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name, arguments: { tabId: 't1', ...args } }
    });
    if (!res.result) throw new Error(`${name}: ${JSON.stringify(res.error)}`);
    return JSON.parse(res.result.content[0].text);
  };

  console.log(`\nLocal driver latency — ${found.name}, 100-row fixture, ${RUNS} runs each\n`);
  console.log('Primitives (CDP round trips only)\n');

  const primitives = [
    await bench('session.settle()', () => session.settle()),
    await bench('session.snapshot(60)', () => session.snapshot({ limit: 60 })),
    await bench('session.pageState()', () => session.pageState()),
    await bench('session.clickAt()', () => session.clickAt(600, 300)),
    await bench('session.key("a", ["Control"])', () => session.key('a', ['Control'])),
    await bench('session.waitForText (present)', () => session.waitForText('Row 42')),
    await bench('session.read()', () => session.read()),
    await bench('session.waitForStill()', () => session.waitForStill()),
    await bench('session.windowState()', () => session.windowState()),
    await bench('driver.clickRow', () => driver.clickRow('row', 'Row 7'))
  ];
  for (const p of primitives) console.log(line(p.label, p.s));

  console.log('\nMCP tool calls (the surface an agent actually pays for)\n');

  await call('click_row', { role: 'textbox', name: 'the field' });
  const tools = [
    await bench('click', () => call('click', { x: 600, y: 300 })),
    await bench('click_row', () => call('click_row', { role: 'row', name: 'Row 7' })),
    await bench('press_key', () => call('press_key', { key: 'Tab' })),
    await bench('read_page', () => call('read_page')),
    await bench('ax_snapshot', () => call('ax_snapshot')),
    await bench('wait_for (found)', () => call('wait_for', { text: 'Row 42' })),
    await bench('wait_still', () => call('wait_still')),
    await bench('stream_keys text', () => call('stream_keys', { events: [{ text: 'ab' }, { key: 'Tab', gapMs: 0 }] })),
    await bench('stream_keys chords', () => call('stream_keys', {
      events: [{ key: 'a', modifiers: ['Control'] }, { key: 'b', modifiers: ['Control'] }]
    })),
    await bench('caret_line', () => call('caret_line'))
  ];
  await call('scroll', { y: 0 });
  await call('click_row', { role: 'textbox', name: 'the field' });
  tools.push(await bench('append', () => call('append', { text: 'bench' })));
  tools.push(await bench('browser_burst (3 steps)', () => call('browser_burst', {
    steps: [
      { action: 'resolve', role: 'row', name: 'Row 3' },
      { action: 'resolve', role: 'row', name: 'Row 4' },
      { action: 'resolve', role: 'row', name: 'Row 5' }
    ]
  })));
  for (const t of tools) console.log(line(t.label, t.s));
} finally {
  session?.close();
  browser.kill();
  http.close();
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
  }
}
console.log('');
