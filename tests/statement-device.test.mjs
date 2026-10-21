// @last-edited: 2026-10-21 UTC+7.
// @title: statement-device — the device side of a delivery, proved against a fake browser.
// @state: the download, the wait, the proof, the manifest, and the refusals.
// @dependencies: node:test, strict, node:fs, node:os, node:path, ../extension/worker/statement.js.

// WHY THIS FILE EXISTS. The device is the side that delivers: it downloads the file
// with the name the card chose, waits until the browser says it is whole, and writes
// one line into a manifest on the person's own machine. None of that had a test, and
// the pieces that can be tested without a browser are exactly the pieces that decide
// whether a delivery is honest: the name rule, the wait, the refusals, and the row.
//
// The fake is a browser that answers what Chrome answers: a download record with a
// state and a size, a storage that keeps what it was given, and a scripting API that
// runs the page verification and answers with the bytes it read.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  statementDownload,
  statementManifest,
  loadManifest,
  MANIFEST_KEY
} from '../extension/worker/statement.js';

const PDF = Buffer.from(
  '%PDF-1.4\n'
  + '1 0 obj<</Type /Pages/Kids[2 0 R 3 0 R]/Count 2>>endobj\n'
  + '2 0 obj<</Type /Page/Parent 1 0 R>>endobj\n'
  + '3 0 obj<</Type /Page/Parent 1 0 R>>endobj\n'
  + 'trailer<</Root 1 0 R>>\n%%EOF\n'
);

function fakeBrowser({ bytes = PDF, state = 'complete', interrupted = null } = {}) {
  const storage = new Map();
  const calls = { downloads: [], injected: [], verified: [] };
  let nextId = 1;

  const globals = {
    chrome: {
      downloads: {
        async download(options) {
          calls.downloads.push(options);
          const id = nextId++;
          globals.chrome.downloads.search = async ({ id: wanted }) => [{
            id: wanted,
            state,
            error: interrupted,
            filename: `/home/user/Downloads/${options.filename}`,
            fileSize: bytes.length
          }];
          return id;
        },
        async search() { return []; }
      },
      storage: {
        local: {
          async get(key) {
            return storage.has(key) ? { [key]: storage.get(key) } : {};
          },
          async set(bag) {
            for (const [key, value] of Object.entries(bag)) storage.set(key, value);
          }
        }
      },
      scripting: {
        async executeScript(options) {
          if (options.files) {
            calls.injected.push(...options.files);
            return [];
          }
          calls.verified.push(options.args[0]);
          const helpers = globalThis.OperaAgentStatementFile;
          const kind = helpers.kindOf(new Uint8Array(bytes));
          const pages = kind === 'pdf' ? helpers.countPages(new Uint8Array(bytes)) : null;
          return [{ ok: true, bytes: bytes.length, kind, pages, pagesFrom: helpers.pagesFrom(kind, pages || 0) }];
        }
      },
      tabs: {
        async query() { return [{ id: 7 }]; },
        async get(id) { return { id, url: 'https://portal.test/statements' }; }
      }
    }
  };

  return { globals, calls, storage };
}

async function withBrowser(options, run) {
  const browser = fakeBrowser(options);
  const previous = globalThis.chrome;
  globalThis.chrome = browser.globals.chrome;
  try {
    return await run(browser);
  } finally {
    globalThis.chrome = previous;
  }
}

test('a delivery downloads the file under the name it was given and proves it', async () => {
  await withBrowser({}, async (browser) => {
    const out = await statementDownload({
      client: 'Toko Sinar Jaya',
      portal: 'BCA',
      period: '2026-09',
      filename: 'toko-sinar-jaya-bca-2026-09.pdf',
      url: 'https://portal.test/statement/2026-09.pdf',
      balance: 'Rp 8.900.000'
    });

    assert.equal(out.ok, true);
    assert.equal(out.duplicate, false);
    assert.equal(browser.calls.downloads[0].filename, 'toko-sinar-jaya-bca-2026-09.pdf',
      'the name the card chose is the name the file gets');
    assert.equal(browser.calls.downloads[0].conflictAction, 'overwrite');
    assert.equal(browser.calls.downloads[0].saveAs, false, 'the person is not asked where to save it');
    assert.deepEqual(browser.calls.injected, ['lib/statement-file.js'],
      'the page is given the helpers before it is asked to read the bytes');

    assert.equal(out.row.kind, 'pdf');
    assert.equal(out.row.pages, 2);
    assert.equal(out.row.pagesFrom, 'counted from the file structure');
    assert.equal(out.row.bytes, PDF.length);
    assert.equal(out.row.path, '/home/user/Downloads/toko-sinar-jaya-bca-2026-09.pdf');
    assert.deepEqual(out.row.balance, { raw: 'Rp 8.900.000', digits: '8900000' });
    assert.match(out.row.balanceFrom, /page/i);
    assert.equal(out.manifest.delivered, 1);
  });
});

test('the manifest lives on the device and survives being read again', async () => {
  await withBrowser({}, async (browser) => {
    await statementDownload({
      client: 'Toko Sinar Jaya', portal: 'BCA', period: '2026-09',
      filename: 'a.pdf', url: 'https://portal.test/a.pdf'
    });
    const stored = browser.storage.get(MANIFEST_KEY);
    assert.equal(stored.rows.length, 1, 'the row is written to the device storage');

    const read = await statementManifest();
    assert.equal(read.ok, true);
    assert.equal(read.delivered, 1);
    assert.deepEqual(read.clients, ['Toko Sinar Jaya']);
    assert.deepEqual(read.periods, ['2026-09']);
  });
});

test('a second delivery of the same client-month is refused, and replace corrects it', async () => {
  await withBrowser({}, async () => {
    const first = await statementDownload({
      client: 'A', portal: 'B', period: '2026-09', filename: 'a.pdf', url: 'https://portal.test/a.pdf'
    });
    assert.equal(first.duplicate, false);

    const again = await statementDownload({
      client: 'A', portal: 'B', period: '2026-09', filename: 'a.pdf', url: 'https://portal.test/a.pdf'
    });
    assert.equal(again.duplicate, true, 'a second line would bill the same month twice');
    assert.match(again.why, /twice/);
    assert.equal((await statementManifest()).delivered, 1);

    const replaced = await statementDownload({
      client: 'A', portal: 'B', period: '2026-09', filename: 'a.pdf', url: 'https://portal.test/a.pdf', replace: true
    });
    assert.equal(replaced.duplicate, false);
    assert.equal((await statementManifest()).delivered, 1, 'a replace corrects the line instead of adding one');
  });
});

test('a name with a folder in it is refused, because the device writes one folder', async () => {
  await withBrowser({}, async (browser) => {
    await assert.rejects(
      () => statementDownload({ client: 'A', portal: 'B', period: '2026-09', filename: '../escape.pdf', url: 'https://portal.test/a.pdf' }),
      /must be a file name, not a path/
    );
    assert.equal(browser.calls.downloads.length, 0, 'nothing was downloaded');
  });
});

test('a month that is not a month is refused before anything is downloaded', async () => {
  await withBrowser({}, async (browser) => {
    await assert.rejects(
      () => statementDownload({ client: 'A', portal: 'B', period: 'September', filename: 'a.pdf', url: 'https://portal.test/a.pdf' }),
      /YYYY-MM/
    );
    assert.equal(browser.calls.downloads.length, 0);
  });
});

test('a download that is interrupted is named as interrupted', async () => {
  await withBrowser({ state: 'interrupted', interrupted: 'FILE_NO_SPACE' }, async () => {
    await assert.rejects(
      () => statementDownload({ client: 'A', portal: 'B', period: '2026-09', filename: 'a.pdf', url: 'https://portal.test/a.pdf', timeoutMs: 1000 }),
      /interrupted/
    );
  });
});

test('a workbook is proved as a workbook, with no pages to count', async () => {
  const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
  await withBrowser({ bytes: xlsx }, async () => {
    const out = await statementDownload({
      client: 'A', portal: 'B', period: '2026-09', filename: 'a.xlsx', url: 'https://portal.test/a.xlsx'
    });
    assert.equal(out.row.kind, 'zip');
    assert.equal(out.row.pages, null);
    assert.match(out.row.pagesFrom, /not a PDF/);
  });
});

test('the manifest that was written is the one the device reads back', async () => {
  await withBrowser({}, async (browser) => {
    await statementDownload({ client: 'A', portal: 'B', period: '2026-09', filename: 'a.pdf', url: 'https://portal.test/a.pdf' });
    const manifest = await loadManifest();
    assert.equal(manifest.rows.length, 1);
    assert.equal(manifest.rows[0].client, 'A');
  });
});
