// @last-edited: 2026-10-21 UTC+7.
// @title: statement-proof — the proof a delivered client-month carries, frozen.
// @state: the record and the manifest answer match the declared contract, field by field and type by type.
// @dependencies: node:test, strict, node:fs, node:os, node:path, ../local/statements.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { statementDelivered } from '../local/statements.js';

const contract = JSON.parse(
  fs.readFileSync(new URL('./fixtures/statement-proof-v1.json', import.meta.url), 'utf8')
);

// WHY THE PROOF IS FROZEN.
// Another agent hands this object to its own user and is believed because of it, so a field that changes shape is a change to what a promise means.
// The contract says which fields exist and what each one holds; this test says the delivery really answers with that, and the two agree.

const CHECKS = {
  string: (value) => assert.equal(typeof value, 'string', 'expected a string'),
  integer: (value) => assert.ok(Number.isInteger(value), 'expected an integer'),
  'string[]': (value) => {
    assert.ok(Array.isArray(value), 'expected an array');
    for (const item of value) assert.equal(typeof item, 'string', 'expected strings inside');
  },
  'integer|null': (value) => {
    if (value !== null) assert.ok(Number.isInteger(value), 'expected an integer or null');
  },
  'string|null': (value) => {
    if (value !== null) assert.equal(typeof value, 'string', 'expected a string or null');
  },
  'ISO-8601': (value) => {
    assert.equal(typeof value, 'string', 'expected a string');
    assert.ok(!Number.isNaN(Date.parse(value)), 'expected a date the machine can read');
  },
  'pdf|zip|ole|other': (value) => {
    assert.ok([
      'pdf',
      'zip',
      'ole',
      'other'
    ].includes(value), `unexpected kind: ${value}`);
  },
  'YYYY-MM': (value) => {
    assert.match(String(value), /^\d{4}-(0[1-9]|1[0-2])$/, 'expected a month');
  },
  '{ raw: string, digits: string|null }|null': (value) => {
    if (value === null) return;
    assert.equal(typeof value.raw, 'string', 'the balance keeps the text the portal printed');
    if (value.digits !== null) assert.equal(typeof value.digits, 'string', 'the digits are a string');
  }
};

function check(
  shape,
  value,
  where
) {
  const check_ = CHECKS[shape];
  assert.ok(check_, `the contract names a shape no test knows: ${shape} (${where})`);
  check_(value);
}

const PDF = Buffer.from(
  '%PDF-1.4\n'
  + '1 0 obj<</Type /Pages/Kids[2 0 R 3 0 R]/Count 2>>endobj\n'
  + '2 0 obj<</Type /Page/Parent 1 0 R>>endobj\n'
  + '3 0 obj<</Type /Page/Parent 1 0 R>>endobj\n'
  + 'trailer<</Root 1 0 R>>\n%%EOF\n'
);

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opera-proof-'));
}

test('a delivered client-month answers with the frozen proof', () => {
  const root = workspace();
  const dir = path.join(root, '2026-09', 'toko-sinar-jaya');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'toko-sinar-jaya-bca-2026-09.pdf');
  fs.writeFileSync(file, PDF);
  const manifest = path.join(root, '2026-09', 'manifest.json');

  const out = statementDelivered({
    client: 'Toko Sinar Jaya',
    portal: 'BCA',
    period: '2026-09',
    path: file,
    balance: 'Rp 8.900.000',
    manifest
  });

  assert.deepEqual(Object.keys(out.record).sort(), Object.keys(contract.record).sort(),
    'the record carries exactly the fields the contract names');
  for (const [field, shape] of Object.entries(contract.record)) {
    check(shape, out.record[field], field);
  }

  assert.deepEqual(Object.keys(out.manifest).sort(), Object.keys(contract.manifest).sort(),
    'the manifest answer carries exactly the fields the contract names');
  for (const [field, shape] of Object.entries(contract.manifest)) {
    check(shape, out.manifest[field], field);
  }

  assert.equal(out.record.kind, 'pdf');
  assert.equal(out.record.pages, 2);
  assert.equal(out.record.balance.digits, '8900000');
  assert.equal(out.record.balance.raw, 'Rp 8.900.000');
  assert.match(out.record.balanceFrom, /page/i, 'the balance names where it came from');
  assert.equal(out.record.bytes, PDF.length);
});

test('a workbook is proved as a workbook, and a missing balance is proved as missing', () => {
  const root = workspace();
  const dir = path.join(root, '2026-09', 'a');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'a-b-2026-09.xlsx');
  fs.writeFileSync(file, Buffer.from([
    0x50,
    0x4b,
    0x03,
    0x04,
    1,
    2,
    3,
    4
  ]));
  const manifest = path.join(root, '2026-09', 'manifest.json');

  const out = statementDelivered({
    client: 'A',
    portal: 'B',
    period: '2026-09',
    path: file,
    manifest
  });

  assert.equal(out.record.kind, 'zip');
  assert.equal(out.record.pages, null, 'a workbook has no pages to count');
  assert.equal(out.record.balance, null, 'a balance that was not read is not invented');
  assert.equal(out.record.balanceFrom, null);
  for (const [field, shape] of Object.entries(contract.record)) check(shape, out.record[field], field);
});

test('the manifest on disk carries the same proof as the answer', () => {
  const root = workspace();
  const dir = path.join(root, '2026-09', 'a');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'a-b-2026-09.pdf');
  fs.writeFileSync(file, PDF);
  const manifest = path.join(root, '2026-09', 'manifest.json');

  statementDelivered({
    client: 'A',
    portal: 'B',
    period: '2026-09',
    path: file,
    balance: 'Rp 1.000',
    manifest
  });
  const rows = JSON.parse(fs.readFileSync(manifest, 'utf8'));

  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), Object.keys(contract.record).sort(),
    'the stored line is the same proof the answer gave');
  for (const [field, shape] of Object.entries(contract.record)) check(shape, rows[0][field], field);
});
