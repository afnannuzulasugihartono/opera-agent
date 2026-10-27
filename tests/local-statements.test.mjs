// @last-edited: 2026-10-21 UTC+7.
// @title: statements - a card names the file before the drive, and the manifest refuses a file that is not whole.
// @state: naming, period shape, disk verification, duplicate billing, and the balance as the page printed it.
// @dependencies: node:test, strict, node:fs, node:os, node:path, ../local/jobs/statements.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { balanceDigits, slug, statementCard, statementDelivered } from '../local/jobs/statements.js';

const PDF = Buffer.from(
  '%PDF-1.4\n'
  + '1 0 obj<</Type /Pages/Kids[2 0 R 3 0 R]/Count 2>>endobj\n'
  + '2 0 obj<</Type /Page/Parent 1 0 R>>endobj\n'
  + '3 0 obj<</Type /Page/Parent 1 0 R>>endobj\n'
  + 'trailer<</Root 1 0 R>>\n%%EOF\n'
);

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opera-statements-'));
}

function fileAt(dir, name = 'statement-2026-09.pdf', bytes = PDF) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
}

test('the card names one file for one client-month, however the person writes the name', () => {
  const root = workspace();
  const first = statementCard({ client: 'Toko Sinar Jaya', portal: 'BCA', period: '2026-09', root });
  const second = statementCard({ client: '  toko   sinar jaya ', portal: 'bca', period: '2026-09', root });

  assert.equal(first.saveAs, 'toko-sinar-jaya-bca-2026-09.pdf');
  assert.equal(second.path, first.path, 'the same client-month lands on the same file');
  assert.equal(first.path, path.join(root, '2026-09', 'toko-sinar-jaya', first.saveAs));
  assert.equal(first.manifest, path.join(root, '2026-09', 'manifest.json'));
  assert.equal(first.exists, false);
});

test('a period that is not a month is refused, because it cannot be billed', () => {
  assert.throws(() => statementCard({ client: 'A', portal: 'B', period: 'September' }), /YYYY-MM/);
  assert.throws(() => statementCard({ client: 'A', portal: 'B', period: '2026-13' }), /YYYY-MM/);
  assert.throws(() => statementCard({ client: '', portal: 'B', period: '2026-09' }), /needs client/);
});

test('a slug keeps the words and drops the punctuation', () => {
  assert.equal(slug('CV. Sinar Jaya & Co.'), 'cv-sinar-jaya-co');
  assert.equal(slug('  '), 'untitled');
  assert.equal(slug('Toko  Budi'), 'toko-budi');
});

test('a delivered PDF is checked on disk and its pages counted from the file', () => {
  const root = workspace();
  const card = statementCard({ client: 'Toko Sinar Jaya', portal: 'BCA', period: '2026-09', root });
  const file = fileAt(card.dir, card.saveAs);

  const out = statementDelivered({
    client: card.client, portal: card.portal, period: card.period,
    path: file, balance: 'Rp 8.900.000', manifest: card.manifest
  });

  assert.equal(out.duplicate, false);
  assert.equal(out.record.kind, 'pdf');
  assert.equal(out.record.pages, 2);
  assert.equal(out.record.pagesFrom, 'counted from the file structure');
  assert.equal(out.record.bytes, PDF.length);
  assert.deepEqual(out.record.balance, { raw: 'Rp 8.900.000', digits: '8900000' });
  assert.match(out.record.balanceFrom, /page/);
  assert.equal(out.manifest.delivered, 1);
  assert.deepEqual(out.manifest.periods, ['2026-09']);

  const rows = JSON.parse(fs.readFileSync(card.manifest, 'utf8'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].file, card.saveAs);
});

test('a file still being written, an empty file, a missing path and a folder are each refused by name', () => {
  const root = workspace();
  const job = { client: 'A', portal: 'B', period: '2026-09' };

  assert.throws(
    () => statementDelivered({ ...job, path: path.join(root, 'x.pdf.crdownload') }),
    /still being written/
  );

  const empty = path.join(root, 'empty.pdf');
  fs.writeFileSync(empty, '');
  assert.throws(() => statementDelivered({ ...job, path: empty }), /zero bytes/);

  assert.throws(() => statementDelivered({ ...job, path: path.join(root, 'nope.pdf') }), /no file at/);
  assert.throws(() => statementDelivered({ ...job, path: root }), /not a file/);
});

test('a second line for the same client-month is refused before it can bill twice', () => {
  const root = workspace();
  const card = statementCard({ client: 'Toko Sinar Jaya', portal: 'BCA', period: '2026-09', root });
  const file = fileAt(card.dir, card.saveAs);
  const job = { client: card.client, portal: card.portal, period: card.period, path: file, manifest: card.manifest };

  statementDelivered(job);
  const again = statementDelivered(job);

  assert.equal(again.duplicate, true);
  assert.equal(again.manifest.delivered, 1);
  assert.match(again.why, /twice/);

  const replaced = statementDelivered({ ...job, balance: 'Rp 9.100.000', replace: true });
  assert.equal(replaced.duplicate, false);
  assert.equal(replaced.manifest.delivered, 1, 'a replace corrects the line instead of adding one');
  const rows = JSON.parse(fs.readFileSync(card.manifest, 'utf8'));
  assert.equal(rows[0].balance.digits, '9100000');
});

test('a workbook is recorded as what it is, not as a PDF with no pages', () => {
  const root = workspace();
  const card = statementCard({ client: 'A', portal: 'B', period: '2026-09', root, ext: 'xlsx' });
  const file = fileAt(card.dir, card.saveAs, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]));

  const out = statementDelivered({ client: 'A', portal: 'B', period: '2026-09', path: file, manifest: card.manifest });

  assert.equal(out.record.kind, 'zip');
  assert.equal(out.record.pages, null);
  assert.match(out.record.pagesFrom, /not a PDF/);
});

test('the balance keeps the raw text and the digits, and reads Indonesian money both ways', () => {
  assert.equal(balanceDigits('Rp 8.900.000'), '8900000');
  assert.equal(balanceDigits('Rp 8.900.000,00'), '8900000');
  assert.equal(balanceDigits('(Rp 1.250.000)'), '-1250000');
  assert.equal(balanceDigits('8.900.000,-'), '8900000');
  assert.equal(balanceDigits(''), null);
  assert.equal(balanceDigits(null), null);
});

