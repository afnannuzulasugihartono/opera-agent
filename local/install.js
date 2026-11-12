// @last-edited: 2026-11-12 UTC+7.
// @title: install - the trusted path from "npm install -g" to a browser that has the extension.
// @state: the fetch verifies the header hash and the magic bytes before anything touches the disk; a failed verify writes no folder.
// @dependencies: node:crypto, node:fs/promises.

import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const CRX_URL = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/opera-agent-ofgemipoobcnbjkfanmofjbdonjapmgl-1.6.44.crx';
export const SHA256_HEADER = 'x-opera-sha256';
export const EXTENSION_ID = 'ofgemipoobcnbjkfanmofjbdonjapmgl';
export const CRX_MAGIC = [0x43, 0x72, 0x32, 0x34]; // 'Cr24'

export async function fetchVerifiedCrx({ url, sha256Header = SHA256_HEADER, fetchImpl = globalThis.fetch } = {}) {
  if (!url) throw new Error('fetchVerifiedCrx: url is required');
  const head = await fetchImpl(url, { method: 'HEAD' });
  if (!head?.ok) throw new Error(`HEAD ${url} answered ${head?.status ?? 'no response'}`);
  const expected = head.headers?.get?.(sha256Header);
  if (!expected) throw new Error(`HEAD ${url} carries no ${sha256Header} header`);
  const body = await fetchImpl(url, { method: 'GET' });
  if (!body?.ok) throw new Error(`GET ${url} answered ${body?.status ?? 'no response'}`);
  const bytes = Buffer.from(await body.arrayBuffer());
  if (bytes.length < CRX_MAGIC.length || !CRX_MAGIC.every((b, i) => bytes[i] === b)) throw new Error('payload is not a CRX (magic bytes missing)');
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual.toLowerCase() !== String(expected).toLowerCase()) throw new Error(`sha256 mismatch: expected ${expected}, got ${actual}`);
  return bytes;
}

export function crxReadme(browser) {
  return `Opera Agent for ${browser}

This folder keeps a verified copy of the extension in case the browser
cannot install it from the registry. To install manually: chrome://extensions
(edge/brave equivalents) -> Developer mode -> Load unpacked -> this folder's
parent in this OperaAgent tree.

How the automatic install works: the browser reads HKCU\\Software\\...\\Extensions\\${EXTENSION_ID},
fetches the update manifest, downloads the same CRX, and installs it. Deleting the
key removes the extension on next start.

Uninstall: run \`opera-agent-mcp uninstall\`, or double-click
store/extension-registry-uninstall.reg from the repository.
Pairing: run \`opera-agent-mcp auth\` to sign in, then open the extension and pair the device.
`;
}

export async function installCrxInto(root, browser, bytes, readme = crxReadme(browser)) {
  if (!bytes || bytes.length < CRX_MAGIC.length || !CRX_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new Error('installCrxInto called with bytes that are not a CRX; refusing to write');
  }
  const folder = path.join(root, browser[0].toUpperCase() + browser.slice(1));
  await mkdir(folder, { recursive: true });
  const crx = path.join(folder, 'extension.crx');
  await writeFile(crx, bytes);
  await writeFile(path.join(folder, 'README.txt'), readme);
  return { folder, crx };
}

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { detectBrowsers } from './browsers.js';
import { writeExtensionKey } from './registry.js';

const NON_WINDOWS = 'Opera Agent installs its extension only into Windows browsers. On this platform, install from the Chrome Web Store or the Opera Agent download page (https://opera-agent.pages.dev/unduh).';

const NO_BROWSER = 'No Chrome, Brave or Edge was found on this machine. Install one of them, or grab the signed build from https://opera-agent.pages.dev/unduh.';

const defaultExec = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export async function install({
  platform = process.platform,
  env = process.env,
  exec = defaultExec,
  fetchImpl = globalThis.fetch,
  existsAt = fs.existsSync,
  root = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'OperaAgent') : path.join(os.homedir(), 'OperaAgent'),
  print = () => {},
} = {}) {
  if (platform !== 'win32') return { ok: false, browsers: [], message: NON_WINDOWS };
  const found = detectBrowsers({ platform: 'win32', exists: existsAt, env }).filter((entry) => ['chrome', 'brave', 'edge'].includes(entry.id));
  if (found.length === 0) return { ok: false, browsers: [], message: NO_BROWSER };

  const results = [];
  for (const browser of found) {
    const key = writeExtensionKey({ vendor: browser.id, exec });
    if (!key.ok) {
      results.push({ id: browser.id, keyWritten: false, crx: 'failed', error: key.error });
      continue;
    }
    let crx = 'written';
    let error;
    let destination;
    try {
      const bytes = await fetchVerifiedCrx({ url: CRX_URL, fetchImpl });
      const written = await installCrxInto(root, browser.id, bytes);
      destination = written.folder;
    } catch (caught) {
      crx = 'failed';
      error = String(caught?.message || caught);
    }
    results.push({ id: browser.id, keyWritten: true, crx, destination, error });
  }

  const ok = results.every((entry) => entry.keyWritten && entry.crx === 'written');
  const message = [
    ...results.map((entry) => {
      if (!entry.keyWritten) return `${entry.id}: registry key not written (${entry.error})`;
      if (entry.crx === 'written') return `${entry.id}: registered for automatic install; backup written to ${entry.destination}`;
      return `${entry.id}: registered for automatic install (restart the browser to pick it up); the backup CRX failed: ${entry.error}`;
    }),
    'Sign in with `opera-agent-mcp auth`, then open the extension and pair the device.',
  ].join('\n');
  print(message);
  return { ok, browsers: results, message };
}
