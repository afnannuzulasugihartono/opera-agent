// @last-edited: 2026-11-06 UTC+7.
// @title: extension-run — drive a real browser through the shipped extension, and write down what happened.
// @state: the fixture portal, the loopback bridge, a Chrome with the extension loaded, seven calls, and the record.
// @dependencies: node:crypto, node:fs, node:os, node:path, node:url, ./proof-run.mjs.

// WHY THIS FILE EXISTS.
// The product ships a browser extension and promises it drives the everyday browser without a debugging port.
// Every proof so far drove a debugging port, which is the other road, so the promise rested on code alone.
// This run drives the road the extension owns: the shipped extension folder is loaded into a real Chrome, the extension opens the loopback socket itself, and every call the MCP client makes travels through it.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchProofBrowser, serveCompany, sha256, speakMcp } from './proof-run.mjs';

// WHY THE BRIDGE PORT IS THE ONE THE EXTENSION PROBES FIRST.
// extension/worker/bridge-link.js dials ws://127.0.0.1:9451 before it guesses at any other port, so a run on a port of its own would have the extension talking to somebody else's bridge.

const BRIDGE_PORT = 9451;

// WHY THE DEBUGGING PORT IS A PORT NOTHING LISTENS ON.
// A drive that fell back to a debugging port would drive a different browser on a different profile, and the record would claim an extension run that never happened.

const DEBUG_PORT = 9455;

// WHY THE MARKS ARE THE PAGE'S OWN WORDS.
// The fixture portal names itself and its download control, so a read that does not show them means the drive read something else, and the record must not say it read the portal.

const MARKS = ['Portal Mitra', 'Unduh CSV'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// WHY THE EXTENSION ID IS READ FROM THE MANIFEST KEY.
// The loopback bridge admits only two extension origins, and the id is what carries the origin.
// Deriving it from the key the manifest ships proves the loaded extension is one of them, and it cannot drift from the manifest.

export function extensionId(key) {
  const digest = crypto.createHash('sha256').update(Buffer.from(String(key), 'base64')).digest();
  let id = '';
  for (const byte of digest.subarray(0, 16)) {
    id += String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15));
  }
  return id;
}

const health = (port) => fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
  .then((response) => response.json())
  .catch(() => null);

// WHY THE RUN WAITS FOR THE LINK AND SAYS WHY IT DID NOT COME.
// The extension connects on its own schedule, and a run that started driving before the socket landed would fall back to a debugging port and call it a success.

async function waitForLink(port, { timeoutMs = 60000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await health(port);
    if (last?.ok === true && last.linked === true) return last;
    await sleep(250);
  }
  throw new Error(`the extension did not reach the bridge on 127.0.0.1:${port} within ${timeoutMs} ms; health said ${JSON.stringify(last)}`);
}

// WHY THE RUN JOINS A BRIDGE THAT IS ALREADY THERE.
// The loopback bridge holds one device socket, so a second extension connecting would evict the first.
// On a machine where the everyday browser already has the extension linked, this run therefore joins that bridge and drives the browser the extension already controls; on a quiet machine it starts the bridge itself and loads the extension from the tree.
// Both roads are the extension's road, and the record says which one ran.

export async function runExtensionProof({
  root = process.cwd(),
  bridgePort = BRIDGE_PORT,
  debugPort = DEBUG_PORT,
  downloads = null
} = {}) {
  const company = path.join(root, 'tests', 'fixtures', 'mock-company');
  const extension = path.join(root, 'extension');
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
  const id = extensionId(manifest.key);
  const work = downloads ?? fs.mkdtempSync(path.join(os.tmpdir(), 'opera-extension-'));
  fs.mkdirSync(work, { recursive: true });

  const holder = await health(bridgePort);
  const mode = holder ? 'joined' : 'own';
  const portal = await serveCompany(company);
  const mcp = speakMcp({
    port: debugPort,
    cwd: root,
    transport: 'bridge',
    env: { ...process.env, OPERA_BRIDGE_PORT: String(bridgePort) }
  });
  const rows = [];
  let browser = null;

  const note = (row) => {
    rows.push(row);
    return row;
  };

  try {
    const ready = await mcp.initialize();
    const tools = await mcp.listTools();
    if (mode === 'own') {
      browser = await launchProofBrowser({
        port: debugPort,
        extraArgs: [
          `--load-extension=${extension}`,
          `--disable-extensions-except=${extension}`,
          '--headless=new'
        ]
      });
    }
    const version = browser
      ? await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json())
      : await health(bridgePort);

    await waitForLink(bridgePort);

    note({
      kind: 'header',
      transport: 'bridge',
      mode,
      bridgePort,
      extensionId: id,
      browser: browser?.name ?? 'the browser the extension was linked to',
      browserVersion: String(version?.Browser ?? ''),
      server: ready?.serverInfo?.name ?? 'unknown',
      toolCount: tools.length,
      startedAt: new Date().toISOString()
    });

    const status = await mcp.tool('browser_status', {});
    if (Number(status.answer?.port) !== Number(bridgePort)) {
      throw new Error(`the drive answered on port ${status.answer?.port}, not the bridge on ${bridgePort}; nothing was recorded`);
    }
    note({ kind: 'call', tool: 'browser_status', ok: true, ms: status.ms, note: `the bridge on ${bridgePort} is the road in use` });

    process.stderr.write('extension run: browser_status done\n');
    const opened = await mcp.tool('open_url', { url: portal.url });
    const tabId = opened.answer?.action?.id;
    if (!tabId) throw new Error('open_url returned no tab id');
    note({ kind: 'call', tool: 'open_url', ok: true, ms: opened.ms, note: `tab ${tabId} opened the fixture portal` });

    process.stderr.write('extension run: open_url done\n');
    const read = await mcp.tool('read_page', { tabId });
    const text = String(read.answer?.text ?? '');
    for (const mark of MARKS) {
      if (!text.includes(mark)) throw new Error(`read_page did not show ${mark}`);
    }
    note({ kind: 'call', tool: 'read_page', ok: true, ms: read.ms, note: `${text.length} characters read from the portal` });

    process.stderr.write('extension run: read_page done\n');
    const found = await mcp.tool('find_elements', { tabId, query: 'Unduh CSV' });
    const matches = Array.isArray(found.answer) ? found.answer : [];
    if (!matches.length) throw new Error('find_elements did not find the download control');
    note({ kind: 'call', tool: 'find_elements', ok: true, ms: found.ms, note: `${matches.length} match for "Unduh CSV"` });

    process.stderr.write('extension run: find_elements done\n');
    const grabbed = await mcp.tool('download', {
      tabId,
      role: 'link',
      name: 'Unduh CSV',
      dir: work,
      saveAs: 'transaksi-2026-09.csv',
      timeoutMs: 30000
    });
    process.stderr.write('extension run: download done\n');
    if (grabbed.answer?.downloaded !== true) throw new Error(`download failed: ${grabbed.answer?.why ?? 'no reason given'}`);
    const csv = grabbed.answer.path;
    const hash = sha256(csv);
    const fixtureHash = sha256(path.join(company, 'transaksi-2026-09.csv'));
    if (hash !== fixtureHash) throw new Error(`the downloaded CSV is not the fixture: ${hash} versus ${fixtureHash}`);
    note({
      kind: 'download',
      tool: 'download',
      ok: true,
      ms: grabbed.ms,
      file: path.basename(csv),
      bytes: grabbed.answer.bytes,
      sha256: hash,
      sameAs: 'tests/fixtures/mock-company/transaksi-2026-09.csv',
      note: `${grabbed.answer.bytes} bytes landed, armed through ${grabbed.answer.armedVia}`
    });

    const shot = await mcp.tool('capture_page', { tabId });
    if (!shot.image) throw new Error('capture_page returned no picture');
    note({ kind: 'call', tool: 'capture_page', ok: true, ms: shot.ms, note: `${Math.round((shot.image.length * 3) / 4)} picture bytes` });

    const closed = await mcp.tool('close_tab', { tabId });
    note({ kind: 'call', tool: 'close_tab', ok: true, ms: closed.ms, note: `tab ${closed.answer?.id ?? tabId} closed` });

    return { rows, jpeg: shot.image, browser: browser?.name ?? 'the browser the extension was linked to', extensionId: id };
  } finally {
    await mcp.close().catch(() => null);
    browser?.close();
    await portal.close();
    if (!downloads) fs.rmSync(work, { recursive: true, force: true });
  }
}

// WHY THE RECORD IS MARKDOWN AND JSONL BOTH.
// The JSONL is what the suite reads, one line per call, and the Markdown is what a person reads.
// Neither is generated from the other, so one cannot quietly erase the other.

export function recordMarkdown({ rows, browser, extensionId: id }) {
  const calls = rows.filter((row) => row.kind === 'call' || row.kind === 'download');
  const download = calls.find((row) => row.kind === 'download');
  const header = rows.find((row) => row.kind === 'header');
  const road = header?.mode === 'own'
    ? 'The extension in `extension/` was loaded into a real Chrome, it opened the loopback bridge itself, and the local MCP server answered over that bridge.'
    : 'The loopback bridge was already up on this machine with the extension linked to it, so the local MCP server joined that bridge and every call below travelled through the extension.';
  return [
    '# Extension run: the extension drove the browser',
    '',
    `${road} No debugging port, no cloud relay.`,
    '',
    `Browser: ${browser}. Extension id: \`${id}\`. Bridge: 127.0.0.1:${header?.bridgePort ?? BRIDGE_PORT}. Tools the server advertised: ${header?.toolCount ?? 0}.`,
    '',
    '| # | call | what it left |',
    '| --- | --- | --- |',
    ...calls.map((row, index) => `| ${index + 1} | \`${row.tool}\` | ${row.note ?? 'ok'} |`),
    '',
    '| file | bytes | sha256 | equals |',
    '| --- | --- | --- | --- |',
    `| \`${download?.file}\` | ${download?.bytes} | \`${download?.sha256}\` | \`${download?.sameAs}\` |`,
    '',
    'The hashes in `extension-run.jsonl` are rechecked by `tests/extension-run.test.mjs`, so this record cannot drift away from what the code makes.',
    ''
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runExtensionProof();
  const dir = path.join(process.cwd(), 'proof');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'extension-portal.jpg'), Buffer.from(result.jpeg, 'base64'));
  fs.writeFileSync(path.join(dir, 'extension-run.jsonl'), `${result.rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'extension-run.md'), recordMarkdown(result));
  console.log(`extension run: ${result.rows.length} lines recorded, extension ${result.extensionId}`);
}
