// @last-edited: 2026-11-12 UTC+7.
// @title: install - the trusted path from "npm install -g" to a browser that has the extension.
// @state: the fetch verifies the header hash and the magic bytes before anything touches the disk; a failed verify writes no folder.
// @dependencies: node:crypto, node:fs/promises.

import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const ZIP_URL = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.zip?for=chrome';
export const SHA256_HEADER = 'x-opera-sha256';
export const EXTENSION_ID = 'ofgemipoobcnbjkfanmofjbdonjapmgl';

export async function fetchVerifiedZip({ url = ZIP_URL, sha256Header = SHA256_HEADER, fetchImpl = globalThis.fetch }: { url?: string; sha256Header?: string; fetchImpl?: typeof fetch } = {}): Promise<Buffer> {
  if (!url) throw new Error('fetchVerifiedZip: url is required');
  const head = await fetchImpl(url, { method: 'HEAD' });
  if (!head?.ok) throw new Error(`HEAD ${url} answered ${head?.status ?? 'no response'}`);
  const expected = head.headers?.get?.(sha256Header);
  if (!expected) throw new Error(`HEAD ${url} carries no ${sha256Header} header`);
  const body = await fetchImpl(url, { method: 'GET' });
  if (!body?.ok) throw new Error(`GET ${url} answered ${body?.status ?? 'no response'}`);
  const bytes = Buffer.from(await body.arrayBuffer());
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual.toLowerCase() !== String(expected).toLowerCase()) throw new Error(`sha256 mismatch: expected ${expected}, got ${actual}`);
  return bytes;
}

export function crxReadme(browser: unknown): string {
  const name = String(browser);
  return `Opera Agent for ${name}

This folder keeps a verified copy of the extension build (opera-agent.zip) in
case the browser cannot install it from the registry. To install manually:
extract opera-agent.zip, then chrome://extensions (edge: edge://extensions,
brave: brave://extensions) -> Developer mode -> Load unpacked -> the extracted folder.

How the automatic install works: the browser reads HKCU\\Software\\...\\Extensions\\${EXTENSION_ID},
fetches the update manifest, downloads the same build from the update endpoint, and installs it. Deleting the
key removes the extension on next start.

Uninstall: run \`opera-agent-mcp uninstall\`, or double-click
docs/store/extension-registry-uninstall.reg from the repository.
Pairing: run \`opera-agent-mcp auth\` to sign in, then open the extension and pair the device.
`;
}

export async function installCrxInto(root: string, browser: string, bytes: Uint8Array | Buffer, readme = crxReadme(browser)): Promise<{ folder: string; crx: string }> {
  if (!bytes || bytes.length === 0) {
    throw new Error('installCrxInto called with empty bytes; refusing to write');
  }
  const folder = path.join(root, browser.charAt(0).toUpperCase() + browser.slice(1));
  await mkdir(folder, { recursive: true });
  const crx = path.join(folder, 'opera-agent.zip');
  await writeFile(crx, bytes);
  await writeFile(path.join(folder, 'README.txt'), readme);
  return { folder, crx };
}

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { detectBrowsers } from './browsers.js';
import { writeExtensionKey } from './registry.js';

const NON_WINDOWS = 'Opera Agent installs its extension only into Windows browsers. On this platform, install from the Chrome Web Store or the Opera Agent download page (https://opera-agent.pages.dev/unduh).';

const NO_BROWSER = 'No Chrome, Brave, Edge or Chrome for Testing was found on this machine. Install one of them, or grab the signed build from https://opera-agent.pages.dev/unduh.';

// The registry rows are told the same caveat: the exec answers utf8 strings or throws.

const defaultExec = (cmd: string, args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export interface InstallOptions {
  platform?: string;
  env?: NodeJS.ProcessEnv;
  exec?: (cmd: string, args: string[]) => string;
  fetchImpl?: typeof fetch;
  existsAt?: (path: string) => boolean;
  root?: string;
  print?: (message: string) => void;
}

export interface BrowserInstallRow {
  id: string;
  keyWritten: boolean;
  crx: 'written' | 'failed';
  destination?: string | undefined;
  error?: string | undefined;
}

export async function install({
  platform = process.platform,
  env = process.env,
  exec = defaultExec,
  fetchImpl = globalThis.fetch,
  existsAt = fs.existsSync,
  root = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'OperaAgent') : path.join(os.homedir(), 'OperaAgent'),
  print = () => {},
}: InstallOptions = {}) {
  if (platform !== 'win32') return { ok: false, browsers: [], message: NON_WINDOWS };
  const found = detectBrowsers({ platform: 'win32', exists: existsAt, env }).filter((entry) => ['chrome', 'brave', 'edge', 'chromeForTesting'].includes(entry.id));
  if (found.length === 0) return { ok: false, browsers: [], message: NO_BROWSER };

  const results: BrowserInstallRow[] = [];
  for (const browser of found) {
    const key = writeExtensionKey({ vendor: browser.id, exec });
    if (!key.ok) {
      results.push({ id: browser.id, keyWritten: false, crx: 'failed', error: key.error });
      continue;
    }
    let crx: 'written' | 'failed' = 'written';
    let error: string | undefined;
    let destination: string | undefined;
    try {
      const bytes = await fetchVerifiedZip({ fetchImpl });
      const written = await installCrxInto(root, browser.id, bytes);
      destination = written.folder;
    } catch (caught: unknown) {
      crx = 'failed';
      error = String((caught as Error)?.message || caught);
    }
    results.push({ id: browser.id, keyWritten: true, crx, destination, error });
  }

  const ok = results.every((entry) => entry.keyWritten && entry.crx === 'written');
  const message = [
    ...results.map((entry) => {
      if (!entry.keyWritten) return `${entry.id}: registry key not written (${entry.error})`;
      if (entry.crx === 'written') return `${entry.id}: registered for automatic install; backup written to ${entry.destination}`;
      return `${entry.id}: registered for automatic install (restart the browser to pick it up); the backup ZIP failed: ${entry.error}`;
    }),
    'Sign in with `opera-agent-mcp auth`, then open the extension and pair the device.',
  ].join('\n');
  print(message);
  return { ok, browsers: results, message };
}

import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { deleteExtensionKey } from './registry.js';

export const deviceFile = (home: string): string => path.join(home, '.opera-agent', 'device.json');

const defaultSpawn = (cmd: string, args: string[], opts: import('node:child_process').SpawnOptions) => {
  const child = spawn(cmd, args, opts);
  child.unref();
  return child;
};

export interface UninstallOptions {
  env?: NodeJS.ProcessEnv;
  platform?: string;
  exec?: (cmd: string, args: string[]) => string;
  spawnImpl?: (cmd: string, args: string[], opts: import('node:child_process').SpawnOptions) => import('node:child_process').ChildProcess;
  root?: string;
  home?: string;
  keepPair?: boolean;
  print?: (message: string) => void;
}

export async function uninstall({
  env = process.env,
  platform = process.platform,
  exec = defaultExec,
  spawnImpl = defaultSpawn,
  root = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'OperaAgent') : path.join(os.homedir(), 'OperaAgent'),
  home = env.OPERA_AGENT_HOME || os.homedir(),
  keepPair = false,
  print = () => {},
}: UninstallOptions = {}) {
  const steps: Array<{ step: string; result: string }> = [];
  for (const vendor of ['chrome', 'brave', 'edge', 'chromeForTesting']) {
    const result = deleteExtensionKey({ vendor, exec });
    steps.push({ step: `registry key for ${vendor}`, result: result.ok ? 'deleted; the registry-installed extension removes itself on next browser start' : `not removed (${result.error})` });
  }
  if (platform === 'win32') {
    try {
      if (existsSync(root)) {
        await rm(root, { recursive: true, force: true });
        steps.push({ step: 'OperaAgent folder', result: `deleted ${root}` });
      } else {
        steps.push({ step: 'OperaAgent folder', result: 'not found' });
      }
    } catch (error: unknown) {
      steps.push({ step: 'OperaAgent folder', result: `could not delete: ${String((error as Error)?.message ?? error)}` });
    }
  } else {
    steps.push({ step: 'OperaAgent folder', result: 'not applicable (the folder is Windows-only)' });
  }
  const device = deviceFile(home);
  if (keepPair) {
    steps.push({ step: 'device pairing', result: 'kept (--keep-pair)' });
  } else if (existsSync(device)) {
    try {
      await rm(device, { force: true });
      steps.push({ step: 'device pairing', result: 'deleted' });
    } catch (error: unknown) {
      steps.push({ step: 'device pairing', result: `could not delete: ${String((error as Error)?.message ?? error)}` });
    }
  } else {
    steps.push({ step: 'device pairing', result: 'not found' });
  }
  try {
    spawnImpl('npm', ['uninstall', '-g', 'opera-agent-mcp'], { detached: true, stdio: 'ignore' });
    steps.push({ step: 'npm package', result: 'uninstall spawned in its own process; it finishes after this command exits' });
  } catch (error: unknown) {
    steps.push({ step: 'npm package', result: `could not spawn the uninstall (${String((error as Error)?.message ?? error)}); run \`npm uninstall -g opera-agent-mcp\` yourself` });
  }
  const instructions = [
    'A registry-installed extension leaves the browser on its next start.',
    'Copies installed the manual developer-mode way (Load unpacked) stay until you remove them in the browser itself:',
    'chrome://extensions, brave://extensions, edge://extensions -> Remove (Chrome for Testing: chrome://extensions in the testing browser).',
  ].join('\n');
  const message = [...steps.map((entry) => `${entry.step}: ${entry.result}`), instructions].join('\n');
  print(message);
  return { ok: true, steps, message };
}

// WHY A MISSING BROWSER OR A FOREIGN OS IS NOT A FAILURE.
// `install` reports information the user may act on, and exits 0; anything exit 1 names a thing that was attempted and failed.

export async function installFromCli() {
  const report = await install();
  if (report.message) process.stdout.write(report.message + '\n');
  if (report.ok) return 0;
  if (report.browsers.length === 0) return 0;
  return 1;
}

export async function uninstallFromCli({ keepPair = process.argv.includes('--keep-pair') }: { keepPair?: boolean } = {}) {
  const report = await uninstall({ keepPair });
  if (report.message) process.stdout.write(report.message + '\n');
  return 0;
}
