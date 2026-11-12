// @last-edited: 2026-11-12 UTC+7.
// @title: install - the trusted path from "npm install -g" to a browser that has the extension.
// @state: the fetch verifies the header hash and the magic bytes before anything touches the disk; a failed verify writes no folder.
// @dependencies: node:crypto, node:fs/promises.

import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
