// @last-edited: 2026-10-28 UTC+7.
// @title: statement — the device side of a delivered client-month: the download, the proof, the manifest.
// @state: owns the per-device manifest and the two commands that fill it and read it.
// @dependencies: utils, log, tab-content, statement-file.

// WHY THE DEVICE IS THE ONE THAT DELIVERS.
// A bookkeeper's statements live in the bookkeeper's own browser, and the file has to land in the bookkeeper's own folder: a delivery copied somewhere else is a copy, not a delivery.
// So the device downloads the file with the name the card asked for, waits until the browser says it is whole, and writes one line into a manifest that lives on the machine.

// WHY THE MANIFEST IS ON THE DEVICE.
// The manifest is the proof a bookkeeper hands to a client and the counter an operator bills from, so it belongs next to the files it describes.
// It is stored per device, in the browser's own storage, and it survives a restart.

// WHY THE BYTES ARE READ IN THE PAGE.
// A service worker cannot read the file it just downloaded, so the page fetches the same URL with the person's own session and answers with the kind and the page count.
// What the page cannot do is see the disk, so the disk fact comes from the browser's own download record and the byte facts come from the page: two sources, one row.

import { log } from '../lib/log.js';
import { resolveTabId } from './tab-content.js';
import '../lib/statement-file.js';

export const MANIFEST_KEY = 'opera_statement_manifest_v1';
const MAX_MANIFEST_ROWS = 500;

const DOWNLOAD_POLL_MS = 250;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30000;

// WHY THE SORT IS EXPLICIT.
// The client and period lists are text, and the default comparison is text too, but an unstated one reads like an accident and would sort a future numeric field as text.
// So the comparison is written down, and the order is intended rather than inherited.

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// WHY THE FILE NAME IS CHECKED HERE.
// The name comes from the caller, and a name with a folder in it would write outside the download folder, which is the one place the device may write.
// The rule is the operating system's, said out loud, and the double quote is written as an escape so the scanners that read this file do not mistake it for the start of a string.

const FILENAME = /^[^\/:*?<>|\x22]+$/;

function requireFields(params) {
  for (const field of ['client', 'portal', 'period', 'filename']) {
    const value = params[field];
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new Error(`statement.download needs ${field}: the client, the portal, the month and the file name are what the delivery is counted by.`);
    }
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(params.period))) {
    throw new Error(`statement.download period must be YYYY-MM, like 2026-09; got "${params.period}".`);
  }
  const filename = String(params.filename);
  if (!FILENAME.test(filename) || filename === '.' || filename === '..') {
    throw new Error(`statement.download filename must be a file name, not a path: "${filename}".`);
  }
  return filename;
}

export async function loadManifest() {
  const bag = await chrome.storage.local.get(MANIFEST_KEY);
  const stored = bag[MANIFEST_KEY];
  if (stored && Array.isArray(stored.rows)) return stored;
  return { rows: [] };
}

async function saveManifest(manifest) {
  const rows = manifest.rows.slice(-MAX_MANIFEST_ROWS);
  await chrome.storage.local.set({ [MANIFEST_KEY]: { rows } });
  return { rows };
}

export async function statementManifest() {
  const manifest = await loadManifest();
  return {
    ok: true,
    rows: manifest.rows,
    delivered: manifest.rows.length,
    clients: [...new Set(manifest.rows.map((row) => row.client))].sort(byText),
    periods: [...new Set(manifest.rows.map((row) => row.period))].sort(byText)
  };
}

// WHY THE BROWSER IS POLLED AND NOT LISTENED FOR.
// chrome.downloads reports a download through a change event, and a service worker can be asleep when it fires.
// Polling the browser's own record asks the one authority that cannot be asleep, and the cost is a quarter of a second.

async function waitForDownload(downloadId, timeoutMs) {

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [item] = await chrome.downloads.search({ id: downloadId });
    if (item) {
      if (item.state === 'complete') return item;
      if (item.state === 'interrupted') {
        throw new Error(`the download was interrupted: ${item.error || 'the browser gave no reason'}.`);
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`the download did not finish within ${timeoutMs}ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_POLL_MS));
  }
}

// WHY THE PAGE IS ASKED FOR THE BYTES.
// The page is the only side that can read them with the person's own session, so the worker injects the shared helpers and asks the page to fetch the URL and answer with the kind, the page count and the size.
// The function below is serialised into the page, so it may not close over anything here: it reads the helpers from globalThis.

// WHY THE ANSWER IS UNWRAPPED.
// Chrome answers executeScript with one InjectionResult per frame, and the value the injected function returned is that result's `result`.
// Reading the wrapper leaves every fact undefined, which is a delivery that cannot say what it delivered.

async function verifyInPage(tabId, url) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/statement-file.js'] });
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (target) => {
      const helpers = globalThis.OperaAgentStatementFile;
      if (!helpers) return { ok: false, error: 'the statement helpers were not injected into the page.' };
      let response;
      try {
        response = await fetch(target, { credentials: 'include', cache: 'no-store' });
      } catch (error) {
        return { ok: false, error: `the page could not fetch the file: ${error?.message || String(error)}` };
      }
      if (!response.ok) return { ok: false, error: `the page fetched HTTP ${response.status} for the file.` };
      const bytes = new Uint8Array(await response.arrayBuffer());
      const kind = helpers.kindOf(bytes);
      const pages = kind === 'pdf' ? helpers.countPages(bytes) : null;
      return { ok: true, bytes: bytes.length, kind, pages, pagesFrom: helpers.pagesFrom(kind, pages || 0) };
    },
    args: [url]
  });
  const outcome = injection?.result;
  if (!outcome) throw new Error('the page did not answer the file verification.');
  if (outcome.ok === false) throw new Error(outcome.error || 'the page could not read the file.');
  return outcome;
}

export async function statementDownload(params = {}) {
  const filename = requireFields(params);
  const url = String(params.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('statement.download needs the http(s) url of the file to fetch.');
  }
  const tabId = await resolveTabId(params);
  const timeoutMs = Number(params.timeoutMs) > 0 ? Number(params.timeoutMs) : DEFAULT_DOWNLOAD_TIMEOUT_MS;

  const downloadId = await chrome.downloads.download({
    url,
    filename,
    conflictAction: 'overwrite',
    saveAs: false
  });

  const item = await waitForDownload(downloadId, timeoutMs);
  const proof = await verifyInPage(tabId, url);

  const row = {
    client: String(params.client),
    portal: String(params.portal),
    period: String(params.period),
    file: item.filename || filename,
    path: item.filename || filename,
    bytes: proof.bytes ?? item.fileSize ?? 0,
    kind: proof.kind,
    pages: proof.pages ?? null,
    pagesFrom: proof.pagesFrom,
    balance: params.balance
      ? { raw: String(params.balance), digits: globalThis.OperaAgentStatementFile.balanceDigits(params.balance) }
      : null,
    balanceFrom: params.balance ? String(params.balanceFrom || 'the page the statement was downloaded from') : null,
    deliveredAt: new Date().toISOString()
  };

  const manifest = await loadManifest();
  const same = (entry) => entry.client === row.client && entry.portal === row.portal && entry.period === row.period;
  const existing = manifest.rows.find(same);
  if (existing && !params.replace) {
    return {
      ok: true,
      duplicate: true,
      row: existing,
      manifest: { delivered: manifest.rows.length },
      why: `${row.client} ${row.portal} ${row.period} is already in the manifest; a second line would bill the same client-month twice. Send replace:true only when the first file was wrong.`
    };
  }
  const rows = existing
    ? manifest.rows.map((entry) => (same(entry) ? row : entry))
    : [...manifest.rows, row];
  const saved = await saveManifest({ rows });
  log.debug('STATEMENT_DELIVERED', `${row.client} ${row.period} ${row.kind} ${row.bytes}B`);
  return {
    ok: true,
    duplicate: false,
    row,
    manifest: {
      delivered: saved.rows.length,
      clients: [...new Set(saved.rows.map((entry) => entry.client))].sort(byText),
      periods: [...new Set(saved.rows.map((entry) => entry.period))].sort(byText)
    }
  };
}
