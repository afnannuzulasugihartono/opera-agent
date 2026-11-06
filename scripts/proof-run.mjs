// @last-edited: 2026-11-06 UTC+7.
// @title: proof-run — one real drive: a browser reads a portal, the CSV lands, and four office files come out with the bytes the site ships.
// @state: the fixture portal, a throwaway Chrome, the MCP client over stdio, the five steps, and the record the suite rechecks.
// @dependencies: node:child_process, node:fs, node:http, node:os, node:path, ../local/browsers.js, ../local/driver.js, ../local/transport.js.

// WHY THIS FILE EXISTS.
// The product claims it drives a browser and hands back designed office files, and until this run the claim rested on separate tests: one drove a fake page, another wrote a workbook.
// A run that does both in one breath is the only thing that answers "can it actually do the job", and the hashes are what make the answer checkable instead of a story.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { launchArgs } from '../local/browsers.js';
import { installedBrowsers } from '../local/driver.js';
import { waitForBrowser } from '../local/transport.js';

// WHY THE SERVER ANSWERS FROM A WHITELIST.
// The portal is two files, and a server that joined the request into a folder would be a door nothing needs.

const SERVED = new Map([
  ['/portal.html', { file: 'portal.html', type: 'text/html; charset=utf-8' }],
  ['/transaksi-2026-09.csv', { file: 'transaksi-2026-09.csv', type: 'text/csv; charset=utf-8' }]
]);

export async function serveCompany(company = path.resolve('tests', 'fixtures', 'mock-company')) {
  const server = http.createServer((request, response) => {
    const entry = SERVED.get((request.url || '/').split('?')[0]);
    if (!entry) {
      response.writeHead(404);
      response.end();
      return;
    }
    const body = fs.readFileSync(path.join(company, entry.file));
    response.writeHead(200, { 'content-type': entry.type, 'content-length': body.length });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    url: `http://127.0.0.1:${port}/portal.html`,
    csvUrl: `http://127.0.0.1:${port}/transaksi-2026-09.csv`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

// WHY THE PORT IS NOT THE EVERYDAY ONE.
// A browser started on the shared port is the browser the person is using, and a proof that drives that one can destroy their session.
// The shared port is refused by name rather than left to a comment.

const SHARED_PORT = 9222;

// WHY THE PROFILE IS TEMPORARY AND ITS REMOVAL IS FORGIVING.
// The cookies and history the run makes must die with it, and a profile folder Chrome still holds for a moment is cleared by the operating system later.
// A cleanup that could throw would mask the step that actually failed.

export async function launchProofBrowser({ port = Number(process.env.OPERA_PROOF_PORT || 9444), env = process.env } = {}) {
  if (port === SHARED_PORT) throw new Error(`${SHARED_PORT} is the shared browser; the proof run refuses to drive it.`);
  const [entry] = installedBrowsers({ env });
  if (!entry?.binary) throw new Error('No Chromium browser was found on this machine.');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opera-proof-'));
  const child = spawn(entry.binary, launchArgs({ browser: entry, port, userDataDir }), { stdio: 'ignore' });

  const up = await waitForBrowser(port, { timeoutMs: 15000 }).then(() => true, () => false);
  if (!up) {
    child.kill();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw new Error(`${entry.name} did not answer port ${port}; nothing was driven.`);
  }

  return {
    port,
    name: entry.name,
    close() {
      child.kill();
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {

      }
    }
  };
}

// WHY THE CLIENT IS THIS SMALL.
// MCP over stdio is one JSON object per line, and the server answers every request with the id it was given.
// A client that framed anything else would be testing its own idea of the protocol instead of the one the product ships.

const CALL_TIMEOUT_MS = 60000;

const parseAnswer = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export function speakMcp({ port, cwd = process.cwd(), env = process.env } = {}) {
  const child = spawn(process.execPath, [path.join(cwd, 'local', 'bin', 'opera-local.js')], {
    cwd,
    env: { ...env, OPERA_LOCAL_TRANSPORT: 'cdp', OPERA_LOCAL_PORT: String(port) },
    stdio: ['pipe', 'pipe', 'inherit']
  });

  const waiting = new Map();
  let buffer = '';
  let nextId = 1;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        continue;
      }
      const pending = waiting.get(message.id);
      if (!pending) continue;
      waiting.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
    }
  });

  const call = (method, params) => new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error(`${method} did not answer within ${CALL_TIMEOUT_MS} ms`));
    }, CALL_TIMEOUT_MS);
    waiting.set(id, {
      method,
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  const tool = async (name, args = {}) => {
    const result = await call('tools/call', { name, arguments: args });
    const blocks = Array.isArray(result?.content) ? result.content : [];
    const texts = blocks.filter((block) => block.type === 'text').map((block) => block.text);
    const ms = Number(String(texts.at(-1) ?? '').replace(/\s*ms$/, ''));
    const body = texts.slice(0, Math.max(0, texts.length - 1)).join('\n');
    return {
      name,
      ms: Number.isFinite(ms) ? ms : null,
      answer: parseAnswer(body),
      text: body,
      image: blocks.find((block) => block.type === 'image')?.data ?? null
    };
  };

  return {
    call,
    tool,
    initialize: () => call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'proof-run', version: '1' } }),
    listTools: async () => ((await call('tools/list', {}))?.tools ?? []).map((entry) => entry.name),
    close: async () => {
      child.stdin.end();
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 5000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  };
}
