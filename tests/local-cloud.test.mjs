// @last-edited: 2026-11-09 UTC+7.
// @title: local-cloud.test — the same tools, the hosted server, and a bearer token.
// @state: a tool call round-tripped against a fake hosted endpoint, and the door it closes when there is no token.
// @dependencies: node:test, strict, node:http, node:os, node:fs, node:child_process, ../local/bin/opera-agent-mcp.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  accessToken,
  configDir,
  tokenPath,
  readStoredToken,
  authorizeUrl,
  openBrowser,
  exchangeCode,
  refreshAccessToken,
  loginInstructions,
} from '../local/oauth.js';
import { serveCloud, hostedBase, pinnedDeviceName } from '../local/cloud.js';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bin = path.join(root, 'local', 'bin', 'opera-agent-mcp.js');

// WHY THE FAKE SPEAKS MCP OVER HTTP.
// The proxy has no opinions about methods, so a fake that answers initialize, tools/list and tools/call proves the pipe forwards a call intact, which is the only claim worth making about a proxy.

function collect(child) {
  const waiters = new Map();
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.trim();
      if (!line) continue;
      const message = JSON.parse(line);
      const waiter = waiters.get(message?.id);
      if (waiter) {
        waiters.delete(message.id);
        waiter(message);
      }
    }
  });
  const send = (payload) => child.stdin.write(`${JSON.stringify(payload)}\n`);
  const waitFor = (id, timeoutMs = 8000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer for ${id} within ${timeoutMs} ms`)), timeoutMs);
    waiters.set(id, (message) => { clearTimeout(timer); resolve(message); });
  });
  return { send, waitFor };
}

async function fakeHosted() {
  const requests = [];
  const server = createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const message = JSON.parse(body);
      requests.push({ authorization: req.headers.authorization, provider: req.headers['x-opera-provider'], device: req.headers['x-opera-device'], message });
      if (req.headers.authorization !== 'Bearer test-token') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized', error_description: 'A valid Opera Agent access token is required.' }));
        return;
      }
      const reply = (result) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      };
      if (message.method === 'initialize') {
        return reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake-hosted', version: '1.0.0' } });
      }
      if (message.method === 'tools/list') {
        return reply({ tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object', properties: {} } }] });
      }
      if (message.method === 'tools/call') {
        return reply({ content: [{ type: 'text', text: '{"ok":true}' }] });
      }
      return reply({});
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/mcp`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('a tool call round-trips through the cloud proxy to the hosted server', async () => {
  const host = await fakeHosted();
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'opera-cloud-config-'));
  const child = spawn(process.execPath, [bin, 'cloud'], {
    env: { ...process.env, OPERA_AGENT_MCP_TOKEN: 'test-token', OPERA_AGENT_MCP_BASE_URL: host.url, OPERA_AGENT_MCP_CONFIG_HOME: configHome, OPERA_AGENT_MCP_DEVICE_NAME: 'opera' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const io = collect(child);
  try {
    const init = io.waitFor(1);
    io.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const initialized = await init;
    assert.equal(initialized.result.serverInfo.name, 'fake-hosted');

    const list = io.waitFor(2);
    io.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listed = await list;
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), ['ping']);

    const call = io.waitFor(3);
    io.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ping', arguments: {} } });
    const answered = await call;
    assert.equal(answered.result.content[0].text, '{"ok":true}', 'the tool answer survives the proxy verbatim');

    assert.equal(host.requests.length, 3);
    for (const seen of host.requests) {
      assert.equal(seen.authorization, 'Bearer test-token', 'the proxy carried the account token');
      assert.equal(seen.provider, 'opera-agent-mcp', 'and said which client it was');
      assert.equal(seen.device, 'opera', 'and named the browser it drives, so every call of one session lands on the same one');
    }
  } finally {
    child.stdin.end();
    await new Promise((resolve) => child.on('close', resolve));
    await host.close();
    fs.rmSync(configHome, { recursive: true, force: true });
  }
});

test('without a token, the proxy names the sign-in and opens nothing', async () => {
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'opera-cloud-config-'));
  const child = spawn(process.execPath, [bin, 'cloud'], {
    env: { ...process.env, OPERA_AGENT_MCP_TOKEN: '', OPERA_AGENT_MCP_CONFIG_HOME: configHome },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { err += chunk; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 3, 'an install without a token exits named, not half-signed-in');
  assert.equal(out, '', 'and says nothing to the MCP client');
  assert.match(err, /opera-agent-mcp auth/, 'the sign-in named');
  assert.match(err, /oauth\/authorize/, 'and the URL is on the page');
  fs.rmSync(configHome, { recursive: true, force: true });
});

test('the OAuth helpers size the home and point the sign-in', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'opera-oauth-'));
  try {
    assert.equal(configDir({ OPERA_AGENT_MCP_CONFIG_HOME: home }), home);
    assert.equal(tokenPath({ OPERA_AGENT_MCP_CONFIG_HOME: home }), path.join(home, 'token.json'));
    assert.equal(readStoredToken({ OPERA_AGENT_MCP_CONFIG_HOME: home }), null);
    const url = authorizeUrl('verifier', 'state');
    assert.match(url, /oauth\/authorize/);
    assert.match(url, /code_challenge_method=S256/);
    assert.match(url, /state=state/);
    assert.match(url, /redirect_uri=/);
    assert.match(loginInstructions({}), /opera-agent-mcp auth/);
    assert.match(loginInstructions({}), /oauth\/authorize/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the exchange and the refresh speak to the token endpoint and keep what they are given', async () => {
  const answers = [];
  const fake = async (endpoint, init) => {
    answers.push({ endpoint, body: String(init?.body ?? '') });
    return {
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'at-1', refresh_token: 'rt-1', token_type: 'bearer', expires_in: 3600 })
    };
  };
  const exchanged = await exchangeCode({ code: 'code-1', verifier: 'verifier-1', fetchImpl: fake });
  assert.equal(exchanged.access_token, 'at-1');
  assert.equal(exchanged.refresh_token, 'rt-1');
  const refreshed = await refreshAccessToken('rt-1', fake);
  assert.equal(refreshed.refresh_token, 'rt-1', 'the existing refresh token is kept when the server stays quiet about it');
  assert.equal(answers.length, 2);
  assert.match(answers[0].endpoint, /oauth\/token/);
  assert.match(answers[0].body, /grant_type=authorization_code/);
  assert.match(answers[1].body, /grant_type=refresh_token/);
});

test('the environment wins over the stored token, and the proxy honours a base override', async () => {
  assert.equal(await accessToken({ env: { OPERA_AGENT_MCP_TOKEN: 'env-token' } }), 'env-token');
  assert.equal(hostedBase({ OPERA_AGENT_MCP_BASE_URL: 'http://127.0.0.1:9/mcp' }), 'http://127.0.0.1:9/mcp');
});

test('the pin comes from the environment, then from the paired device file, and never from nothing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'opera-pin-'));
  try {
    assert.equal(pinnedDeviceName({ OPERA_AGENT_MCP_DEVICE_NAME: 'from-env' }, { home }), 'from-env');
    assert.equal(pinnedDeviceName({}, { home }), '', 'an unpaired machine names no browser');
    fs.mkdirSync(path.join(home, '.opera-agent'), { recursive: true });
    fs.writeFileSync(path.join(home, '.opera-agent', 'device.json'), JSON.stringify({ deviceName: 'opera-7', token: 'a'.repeat(64) }));
    assert.equal(pinnedDeviceName({}, { home }), 'opera-7', 'the paired device file names the browser this machine drives');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the browser is opened detached with an ignored stream and unreported errors', () => {
  const opened = [];
  const runner = (command, args, opts) => {
    opened.push({ command, args, detached: opts?.detached, stdio: opts?.stdio });
    return { on: () => {}, unref: () => {} };
  };
  openBrowser('https://example.test/consent', runner);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].detached, true);
  assert.deepEqual(opened[0].stdio, 'ignore');
});

test('serveCloud without a token answers 3 on an already-closed stream', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'opera-oauth-'));
  const lines = [];
  const stderr = { write: (line) => lines.push(line) };
  try {
    const code = await serveCloud({ env: { OPERA_AGENT_MCP_TOKEN: '', OPERA_AGENT_MCP_CONFIG_HOME: home }, input: Readable.from([]), stderr });
    assert.equal(code, 3);
    assert.ok(lines.some((line) => /opera-agent-mcp auth/.test(line)));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
