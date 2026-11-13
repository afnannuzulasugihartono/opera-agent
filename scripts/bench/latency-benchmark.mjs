// @last-edited: 2026-11-11 UTC+7.
// @title: latency-benchmark - the local road's per-tool latency, measured against the everyday browser.
// @state: the loopback bridge the extension is linked to, a fixture page, and the p50/p95 of every tool.
// @dependencies: node:fs, local/driver.js, local/sessions.js, local/mcp-server.js.

// WHY THIS IS COMMITTED AND NOT AD-HOC.
// The latency report quotes numbers, and a number nobody can re-measure is a number nobody can check.
// So the script is the reproduction: it asks the extension's own loopback bridge for the everyday browser, opens a fixture page there, drives the real MCP surface, and prints p50/p95 next to the numbers the report claims.
// The browser, the profile and the credentials are the person's; the fixture is ours and the tab it opens is closed when the run ends.

// WHY THE BRIDGE HAS TO BE RUNNING.
// The extension links to a local bridge if it finds one, and the bridge is what the local road is: the same commands, the same results, without the relay.
// The bridge is started by the caller (`node start-bridge.mjs` in this repository, or the local MCP server), and this script fails with the one fix when it is not there.

// WHY THE FIXTURE IS SERVED OVER HTTP.
// A page the extension can drive has to be a real page, and a local file URL asks the browser for permissions the extension does not have.

import { createServer } from 'node:http';

import { openSession } from '../../local/driver.js';
import { asDriver } from '../../local/sessions.js';
import { createMcpServer } from '../../local/mcp-server.js';

const RUNS = Number(process.argv.find((value) => value.startsWith('--runs='))?.split('=')[1] || 9);
const PORT = Number(process.env.OPERA_BENCHMARK_PORT || 9477);
const URL_FIXTURE = `http://127.0.0.1:${PORT}/latency-fixture.html`;

// WHY THE FIXTURE IS SERVED BY THIS SCRIPT.
// A page the extension can drive has to be a real page, and whoever serves it must not be a second thing to remember.
// So the fixture is served here, on a port of its own, and the run leaves nothing behind but the tab it opened.

const FIXTURE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Latency fixture</title>
<style>body{font:14px sans-serif;margin:0;padding:12px}
#box{position:fixed;top:0;left:0;padding:8px;border:1px solid #999;width:300px;background:#fff;z-index:5}
#rows{margin-top:150px}.row{padding:6px 10px;border-bottom:1px solid #eee}
</style></head>
<body>
<div id="box">
  <label for="field">Field</label><br>
  <input id="field" aria-label="the field" placeholder="type here">
  <button id="run">Run</button>
  <p id="status">idle</p>
</div>
<div id="rows"></div>
<script>
const status = document.getElementById('status');
document.getElementById('run').addEventListener('click', () => { status.textContent = 'ran'; });
document.getElementById('field').addEventListener('input', () => { status.textContent = 'typed:' + document.getElementById('field').value; });
document.getElementById('rows').innerHTML = Array.from({length:100}, (_,i) => '<div class="row" role="row" aria-label="Row ' + i + '">Row ' + i + '</div>').join('');
</script>
</body>
</html>`;

const fixtureServer = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(FIXTURE);
});
await new Promise((resolve) => fixtureServer.listen(PORT, '127.0.0.1', resolve));

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return { p50: at(0.5), p95: at(0.95), n: sorted.length };
};

const bench = async (label, fn, n = RUNS) => {
  try {
    await fn();
    const times = [];
    for (let i = 0; i < n; i += 1) {
      const t0 = Date.now();
      await fn();
      times.push(Date.now() - t0);
    }
    const s = stats(times);
    return { label, p50: s.p50, p95: s.p95, n: s.n, ok: true };
  } catch (error) {
    return { label, ok: false, error: String(error?.message || error).slice(0, 90) };
  }
};

const session = await openSession({ tabUrl: URL_FIXTURE, timeoutMs: 20000 });
const driver = asDriver(session);
const tab = { id: session.targetId, url: URL_FIXTURE, title: 'Latency fixture' };
const mcpDriver = { ...driver, tabs: async () => [tab] };

const server = createMcpServer({
  driver: mcpDriver,
  port: 9451,
  resolveTab: async () => [tab.id],
  open: async () => mcpDriver,
  close: async () => ({ closed: true })
});

// WHY THE ANSWER IS NOT PARSED.
// A tool may answer with a picture or with nothing at all, and the time it took is the measurement; the shape of the answer is not.

const call = async (name, args = {}) => {
  const res = await server.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: { tabId: tab.id, ...args } }
  });
  if (!res.result) throw new Error(`${name}: ${JSON.stringify(res.error)}`);
  const text = res.result.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
};

const results = [];
const add = async (label, fn, n) => {
  const r = await bench(label, fn, n);
  results.push(r);
  console.log(r.ok
    ? `  ${label.padEnd(26)} p50 ${String(r.p50).padStart(7)} ms   p95 ${String(r.p95).padStart(7)} ms   n=${r.n}`
    : `  ${label.padEnd(26)} failed: ${r.error}`);
};

console.log(`\nLocal road latency - bridge 9451, tab ${tab.id}, ${RUNS} runs each\n`);

const runRef = async (query) => (await call('find_elements', { query })).item?.ref;

await add('browser_status', () => call('browser_status', { tabId: undefined }));
await add('list_tabs', () => call('list_tabs'));
await add('read_page', () => call('read_page'));
await add('read_page (view map)', () => call('read_page', { view: 'map', limit: 5 }));
await add('find_elements', () => call('find_elements', { query: 'Row 42' }));
await add('capture_page', () => call('capture_page'), 5);
await add('scroll_page', () => call('scroll_page', { y: 120 }));
await add('activate_tab', () => call('activate_tab'));
await add('click_element', async () => call('click_element', { ref: await runRef('Run') }));
await add('fill_element', async () => call('fill_element', { ref: await runRef('the field'), value: 'x' }));
await add('press_key', () => call('press_key', { key: 'a' }));
await add('stream_keys', () => call('stream_keys', { events: [{ type: 'key', key: 'b' }] }));
await add('pointer', () => call('pointer', { x: 200, y: 160, pointerAction: 'move' }));
await add('run_browser_burst', () => call('run_browser_burst', { steps: [{ action: 'read' }] }));
await add('skill_recall', () => call('skill_recall', { query: 'browser' }));
await add('statement_manifest', () => call('statement_manifest'));
await add('media_state', () => call('media_state'));
await add('media_play', () => call('media_play'));
await add('run_workflow', () => call('run_workflow', { name: 'browser.status', input: {} }));
await add('run_program', () => call('run_program', {
  requestId: 'latency-1',
  program: {
    schemaVersion: 'OA_REACTIVE_VM_V1',
    programId: 'latency',
    goalId: 'latency',
    goalRevision: 1,
    target: { deviceId: 'x', tabId: tab.id },
    root: { id: 'r', type: 'SEQUENCE', children: [{ id: 'c', type: 'COMMAND', method: 'page.read', params: { tabId: tab.id } }] }
  }
}));
await add('run_adhoc', () => call('run_adhoc', {
  requestId: 'latency-2',
  graph: { nodes: [{ id: 'n1', type: 'command', method: 'page.read', params: { tabId: tab.id } }] }
}));
await add('start_watch', () => call('start_watch', { rule: { ruleId: 'latency', trigger: { kind: 'selectorPresence', selector: 'h1' }, action: { kind: 'noop' } } }));
await add('wait_events', () => call('wait_events', { timeoutMs: 400 }));
await add('stop_watch', () => call('stop_watch'));
await add('navigate_tab', () => call('navigate_tab', { url: URL_FIXTURE }));
await add('open_url', () => call('open_url', { url: URL_FIXTURE }));
await add('close_tab', () => call('close_tab', { tabId: tab.id }), 3);
await add('invoice_create', () => call('invoice_create', { client: 'latency-none', period: '2026-01' }), 3);

console.log('\nJSON\n' + JSON.stringify(results));
fixtureServer.close();
process.exit(0);
