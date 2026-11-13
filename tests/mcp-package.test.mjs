// @last-edited: 2026-11-08 UTC+7.
// @title: mcp-package.test — the published package carries every module it imports, or it is a broken install.
// @state: the package name and binary, the file list against the imports, and the packed tarball's contents.
// @dependencies: node:test, strict, promises, node:fs, node:path, node:child_process.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);

const root = new URL('..', import.meta.url);
const local = new URL('local/', root);
const manifest = JSON.parse(await readFile(new URL('local/package.json', root), 'utf8'));

async function sourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) out.push(...await sourceFiles(child));
    else if (entry.name.endsWith('.js')) out.push(child);
  }
  return out;
}

function importsOf(source) {
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]).filter((specifier) => specifier.startsWith('.'));
}

test('the package is named and run the way the guide says', () => {
  assert.equal(manifest.name, 'opera-agent-mcp');
  assert.ok(manifest.bin['opera-agent-mcp'], 'the package installs one command');
  assert.equal(manifest.type, 'module');
  assert.ok(manifest.engines.node, 'the package says which node it needs');
});

test('every module the package imports is inside the package', async () => {
  const files = await sourceFiles(local);
  const packageRoot = new URL('local/', root).pathname;
  const missing = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const specifier of importsOf(source)) {
      const resolved = new URL(specifier, file).pathname;
      if (!resolved.startsWith(packageRoot)) {
        missing.push(`${path.relative(root.pathname, file.pathname)} imports ${specifier}, outside the package`);
        continue;
      }
      if (!existsSync(new URL(`file://${resolved}`))) {
        missing.push(`${path.relative(root.pathname, file.pathname)} imports ${specifier}, which does not exist`);
      }
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('the packaged copy of the shared endpoint module still pins the region', async () => {
  const { socketUrl } = await import('../local/lib/endpoints.js');
  assert.equal(socketUrl('https://example.test/bridge'), 'wss://example.test/bridge?forceFunctionRegion=ap-southeast-1');
});

const bin = fileURLToPath(new URL('../local/bin/opera-agent-mcp.js', import.meta.url));

async function fakeHealthBridge(payload) {
  const server = http.createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function fakeHome() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'opera-agent-doctor-'));
  await mkdir(path.join(home, '.opera-agent'), { recursive: true });
  await writeFile(path.join(home, '.opera-agent', 'device.json'), JSON.stringify({ deviceName: 'everyday-test', token: 'a'.repeat(64) }));
  return home;
}

async function runDoctor(env) {
  const clean = { ...process.env };
  delete clean.OPERA_AGENT_MCP_TOKEN;
  try {
    const { stdout } = await exec(process.execPath, [bin, 'doctor'], {
      encoding: 'utf8',
      env: { ...clean, ...env }
    });
    return { out: stdout, code: 0 };
  } catch (error) {
    return { out: String(error?.stdout ?? ''), code: Number(error?.code ?? 1) };
  }
}

const FIRM_HEALTH = {
  ok: true,
  linked: true,
  deviceId: 'device-1',
  queued: 0,
  waiting: 0,
  lastHeardMsAgo: 120,
  devices: [{
    slot: 1,
    id: 'device-1',
    instanceId: '11111111-2222-3333-4444-555555555555',
    extensionVersion: '1.6.32',
    connectedAt: 1,
    meter: { plan: 'plan.firm', allowance: 500, dailyQuota: 5000, sent: 7, usedToday: 314, remaining: 4679 }
  }],
  meterRefusal: null
};

test('the doctor prints what is connected, the plan, and what the plan allows', async () => {
  const bridge = await fakeHealthBridge(FIRM_HEALTH);
  const home = await fakeHome();
  try {
    const { out, code } = await runDoctor({
      OPERA_BRIDGE_PORT: String(bridge.port),
      OPERA_AGENT_HOME: home,
      OPERA_AGENT_MCP_CONFIG_HOME: path.join(home, 'config')
    });
    assert.equal(code, 0, 'a ready machine exits zero');
    assert.match(out, /everyday-test/);
    assert.match(out, /plan\.firm/);
    assert.match(out, /500/, 'the session allowance is printed');
    assert.match(out, /5000/, 'the daily quota is printed');
    assert.match(out, /4679/, 'the remaining quota is printed');
    assert.match(out, /1\.6\.32/, 'the extension version is printed');
    assert.match(out, /opera-agent-update\/download\/opera-agent\.crx/, 'the CRX download link is printed');
    assert.match(out, /verdict +ready/, 'the ready verdict is the last word');
  } finally {
    await bridge.close();
    await rm(home, { recursive: true, force: true });
  }
});

test('a bridge from before the meter is named as the problem, not mistaken for an empty machine', async () => {
  const bridge = await fakeHealthBridge({ ok: true, linked: true, deviceId: 'old-device', queued: 0, waiting: 0, lastHeardMsAgo: 40 });
  const home = await fakeHome();
  try {
    const { out, code } = await runDoctor({
      OPERA_BRIDGE_PORT: String(bridge.port),
      OPERA_AGENT_HOME: home,
      OPERA_AGENT_MCP_CONFIG_HOME: path.join(home, 'config')
    });
    assert.equal(code, 1);
    assert.match(out, /before the meter/);
    assert.match(out, /restart the driver/i);
  } finally {
    await bridge.close();
    await rm(home, { recursive: true, force: true });
  }
});

test('the doctor says why a machine is degraded instead of crashing', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'opera-agent-doctor-'));
  try {
    const { out, code } = await runDoctor({
      OPERA_BRIDGE_PORT: '1',
      OPERA_AGENT_HOME: home,
      OPERA_AGENT_MCP_CONFIG_HOME: path.join(home, 'config')
    });
    assert.equal(code, 1, 'a degraded machine says so in its exit code');
    assert.match(out, /device file/, 'the device-file state is printed');
    assert.match(out, /not listening/i, 'the bridge state is printed');
    assert.match(out, /opera-agent-update\/download\/opera-agent\.crx/, 'the fix is the CRX link');
    assert.match(out, /degraded/, 'the verdict names the state');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('the docs name the two modes and where the gate lives', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const agentCall = await readFile(new URL('../docs/agent-call.md', import.meta.url), 'utf8');
  const localReadme = await readFile(new URL('../local/README.md', import.meta.url), 'utf8');
  assert.match(readme, /opera-agent-mcp/, 'the README names the installed command');
  assert.match(readme, /local/);
  assert.match(readme, /cloud/);
  assert.match(agentCall, /PLAN_LIMIT_REACHED/, 'the refusal is named in the docs');
  assert.match(agentCall, /bridge/i, 'and the gate is named with where it lives');
  assert.match(agentCall, /doctor/);
  assert.match(localReadme, /doctor/, 'the local README names the doctor');
  assert.match(localReadme, /cloud/, 'and the two modes');
});

test('the package lists every module the server needs, and its shared copies are the current ones', async () => {
  const files = manifest.files;
  for (const needed of ['bin/opera-agent-mcp.js', 'mcp-server.js', 'bridge-ws.js', 'tools.js', 'lib/endpoints.js', 'lib/socket-protocol.js']) {
    assert.ok(files.includes(needed), `the package must ship ${needed}`);
  }
  for (const name of ['socket-protocol.js', 'endpoints.js']) {
    const source = await readFile(new URL(`extension/lib/${name}`, root), 'utf8');
    const copy = await readFile(new URL(`local/lib/${name}`, root), 'utf8');
    assert.equal(copy, source, `local/lib/${name} has drifted from extension/lib/${name}; run node scripts/pack/pack-mcp.mjs`);
  }
});
