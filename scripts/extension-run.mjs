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

// WHY THE CONTROL IS ONE CONSTANT.
// The record names the control the drive pressed, and the call must press that same control, so one constant carries both.

const CONTROL = { role: 'link', name: 'Unduh CSV' };

// WHY THE OWN LINK WAIT IS SHORT.
// A browser that loaded the extension reaches the bridge on its own schedule, which is seconds, so the default sixty seconds is a minute of waiting to learn what five seconds learns.
// The joined road keeps the long wait, because that extension may be asleep rather than absent.

const OWN_LINK_WAIT_MS = 5000;

// WHY THE VERSION IS READ BEFORE THE LINK IS WAITED FOR.
// Chrome 137 removed --load-extension from the branded build, so an own-mode run on a current Chrome loads no extension at all and can only fail after the full link timeout.
// A build that answers "Chrome/<major>" is a suspect when the link does not come: branded Chrome from 137 on is known to ignore the flag, while Chrome for Testing and Chromium still honour it, and only one of those differences is invisible in this payload.

export function chromeIgnoresLoadExtension(product) {
  const match = /^Chrome\/(\d+)\./.exec(String(product ?? '').trim());
  return match ? Number(match[1]) >= 137 : false;
}

export function majorOf(product) {
  const match = /^Chrome\/(\d+)\./.exec(String(product ?? '').trim());
  return match ? Number(match[1]) : null;
}

// WHY THE ROAD SENTENCE DEPENDS ON THE MODE, AND WHY AN ABSENT HEADER IS NOT A ROAD.
// Own mode opens a debugging port to launch its Chrome and loads the extension into it; joined mode touches no port at all.
// A row set with no header is not a record of either road, and guessing one is the drift the sentence is supposed to prevent, so it says so instead of defaulting.

export function roadFor({ mode } = {}) {
  if (mode === 'own') {
    return 'The extension in `extension/` was loaded into a real Chrome, it opened the loopback bridge itself, and the local MCP server answered over that bridge. A debugging port was open on that Chrome to launch it; every call below still travelled over the bridge.';
  }
  if (mode === 'joined') {
    return 'The loopback bridge was already up on this machine with the extension linked to it, so the local MCP server joined that bridge and every call below travelled through the extension. No debugging port, no cloud relay.';
  }
  return 'The recorded rows carry no header, so the road this run took cannot be read from the jsonl.';
}

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

async function runExtensionProof({
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

  // WHY THE JOIN IS GATED ON A LINKED BRIDGE.
  // A bridge server that is up with no extension behind it is a bridge this run cannot drive, and joining it meant waiting sixty seconds for a link that never arrives.
  // Only a linked holder is joined; anything else is the server's own browser.

  const mode = holder?.linked === true ? 'joined' : 'own';
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

      // WHY THE VERSION IS READ, AND WHY IT CANNOT REFUSE THE RUN ON ITS OWN.
      // Branded Chrome 137 and newer ignore --load-extension, so own mode would sit through the whole link timeout on a browser that loaded no extension and then blame the extension for it.
      // But /json/version answers "Chrome/<major>" for branded Chrome and for Chrome for Testing alike, and the two differ exactly here: one ignores the flag and the other honours it.
      // So the version goes into the link-wait timeout instead: the link still has to arrive, and the wait is short so a dead extension is caught in seconds, while the failure names the flag limit as a suspect rather than as the verdict.

      const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
        .then((response) => response.json())
        .catch(() => null);
      const link = await waitForLink(bridgePort, { timeoutMs: OWN_LINK_WAIT_MS })
        .then((answer) => answer, () => null);
      if (!link) {
        const suspect = chromeIgnoresLoadExtension(version?.Browser)
          ? ` The launched Chrome is major ${majorOf(version.Browser)}, and branded Chrome 137 and newer ignore --load-extension - Chrome for Testing and Chromium still honour it.`
          : '';
        throw new Error(`the extension did not reach the bridge on 127.0.0.1:${bridgePort} within ${OWN_LINK_WAIT_MS} ms; health said ${JSON.stringify(link ? { ok: true, linked: true } : null)}.${suspect} Own mode launches its own browser; link the extension in an everyday browser instead and run with that bridge already up.`);
      }
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
      ...CONTROL,
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

    // WHY THE PRESS IS RECORDED WITH THE FILE.
    // A file that landed says the drive fetched something, not that it pushed a button to get it.
    // The press is the product's claim, so the record carries the point it pushed and what was under that point.

    const pressed = grabbed.answer.clicked;
    if (!pressed || !Number.isFinite(Number(pressed.x)) || !Number.isFinite(Number(pressed.y))) {
      throw new Error('the download arrived without a press behind it, so nothing was recorded');
    }
    note({
      kind: 'download',
      tool: 'download',
      ok: true,
      ms: grabbed.ms,
      file: path.basename(csv),
      bytes: grabbed.answer.bytes,
      sha256: hash,
      sameAs: 'tests/fixtures/mock-company/transaksi-2026-09.csv',
      pressed: {
        x: Math.round(Number(pressed.x)),
        y: Math.round(Number(pressed.y)),
        control: CONTROL,
        hit: pressed.hit ?? null,
        handle: pressed.handle ?? null
      },
      note: `pressed the download control "${CONTROL.name}" at ${Math.round(Number(pressed.x))},${Math.round(Number(pressed.y))}; ${grabbed.answer.bytes} bytes landed, armed through ${grabbed.answer.armedVia}`
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

// WHY THE ROAD AND THE CLOSING SENTENCE ARE REGENERATED FROM THE ROWS.
// The markdown is what a person reads and the jsonl is what the suite reads, and neither is written from the other, so a sentence that lives in only one of them is a sentence nobody rechecked.
// The closing line names the one thing the suite actually does: it re-hashes the fixture and compares, which is a check of the bytes, not a replay of the drive.

export function recordMarkdown({ rows, browser, extensionId: id }) {
  const calls = rows.filter((row) => row.kind === 'call' || row.kind === 'download');
  const download = calls.find((row) => row.kind === 'download');
  const header = rows.find((row) => row.kind === 'header');
  return [
    '# Extension run: the extension drove the browser',
    '',
    roadFor({ mode: header?.mode }),
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
    '`tests/extension-run.test.mjs` re-hashes the fixture in the tree and compares it with the hash in `extension-run.jsonl`, so the record cannot claim bytes the fixture does not hold. It does not drive a browser again, so the calls themselves are proven by the run and not by the test.',
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
