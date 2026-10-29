// @last-edited: 2026-10-21 UTC+7.
// @title: statements - one client-month, one file, one line of proof.
// @state: the card names the file before the drive starts; the manifest refuses a file that is not whole.
// @dependencies: node:fs, node:os, node:path.

// WHY THE CLIENT-MONTH IS THE UNIT.
// The product is sold per delivered client-month, and a bookkeeper's month is a list of (client, portal, period) triples.
// Everything here is keyed by that triple, so a delivery can be counted, repeated and billed without asking anyone what "one statement" means.

// WHY THIS IS A CARD AND NOT A SCRIPT.
// A script that drives a bank portal would have to encode that portal: which link says "Unduh", which frame holds the table, which dialog asks for a month.
// That knowledge rots, and it is exactly the per-site code the extension is forbidden to carry.
// So this module produces the part that does not depend on the site - the name, the folder, the period, what must be true before the file counts - and the agent does the part that does: look, decide, click, verify.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PERIOD_SHAPE = /^\d{4}-(0[1-9]|1[0-2])$/;
const EXT_SHAPE = /^[a-z0-9]{2,5}$/;

// WHY THE SORT IS EXPLICIT.
// The periods and clients are text, and the default comparison is text too, but an unstated one reads like an accident and would sort a future numeric field as text.
// So the comparison is written down, and the order is intended rather than inherited.

const byText = (
  a,
  b
) => (a < b ? -1 : a > b ? 1 : 0);

// WHY THE NAME IS DERIVED AND NOT TYPED.
// A person typing file names produces "BCA Sept'26 (2).pdf" once and then never again the same way, and a manifest full of near-duplicates cannot be billed.
// The slug keeps the client's own words, lowercased and joined, so the file still reads as theirs and sorts as one family.

export function slug(text) {
  const cleaned = String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return cleaned || 'untitled';
}

// WHY THE DEFAULT FOLDER IS UNDER DOWNLOADS AND NOT IN THE REPO.
// The person already knows where Downloads is, the manifest sits beside the files it describes, and a job that crashes leaves nothing behind in a working tree.

function statementsRoot() {
  return path.join(os.homedir(), 'Downloads', 'opera-statements');
}

// WHY THE PERIOD IS CHECKED BEFORE ANYTHING ELSE.
// A card for "September" or "2026-9" would name a file that can never match the one from last month, and the error would surface at billing time instead of here.
// The shape is the shape the manifest groups by.

function jobShape(job) {
  for (const field of ['client', 'portal', 'period']) {
    if (job[field] === null || job[field] === undefined || String(job[field]).trim() === '') {
      throw new Error(`a statement job needs ${field}: the client, the portal and the month are what the delivery is counted by.`);
    }
  }
  if (!PERIOD_SHAPE.test(String(job.period))) {
    throw new Error(`the period must be YYYY-MM, like 2026-09; got "${job.period}". A month is the unit that gets billed, so a loose one cannot be fixed later.`);
  }
}

export function statementCard({
  client,
  portal,
  period,
  root = null,
  url = null,
  ext = 'pdf'
} = {}) {
  jobShape({
    client,
    portal,
    period
  });
  if (!EXT_SHAPE.test(String(ext))) {
    throw new Error(`ext must be a file extension like pdf or csv; got "${ext}"`);
  }
  const base = path.resolve(String(root ?? statementsRoot()));
  const dir = path.join(base, String(period), slug(client));
  const saveAs = `${slug(client)}-${slug(portal)}-${period}.${ext}`;
  const file = path.join(dir, saveAs);
  return {
    client: String(client),
    portal: String(portal),
    period: String(period),
    url: url === null || url === undefined ? null : String(url),
    dir,
    saveAs,
    path: file,
    manifest: path.join(base, String(period), 'manifest.json'),
    exists: fs.existsSync(file),
    steps: [
      'open_url the portal page the person named, or the statement page if they gave one directly',
      'if the page asks to sign in, stop and ask the person to sign in in this browser - never type a password',
      'read_page and check the account and the month on screen against this card before going further',
      'find_elements for the download control by the words the portal uses (Unduh, Download, PDF, Statement) - the words are the site\'s, so this is a look and not a guess',
      'download with dir and saveAs, and act only on downloaded:true',
      'read the closing balance off the page, then statement_delivered with the path and that balance'
    ],
    proof: [
      'download answered downloaded:true and named this path',
      'the file is on disk, is not a .crdownload, and is larger than zero bytes',
      'a PDF keeps its page count from its own structure; other kinds are named as what they are',
      'the closing balance is recorded with the page as its source, because the number a bookkeeper reconciles is the one the portal showed'
    ],
    refuse: [
      'a .crdownload or a zero-byte file is not a delivery',
      'typing a password, or answering a bank\'s one-time code, is not something this job does',
      'a month that is not on screen is not the month being delivered, whatever the card says'
    ]
  };
}

// WHY THE KIND IS SNIFFED AND NOT TRUSTED FROM THE EXTENSION.
// A portal that answers a PDF request with an HTML error page and a .pdf name is common enough; trusting the suffix would file an error page as a statement.
// Four magic numbers are enough to tell a PDF, a workbook and "something else" apart without a parser.

function kindOf(head) {
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'zip';
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return 'ole';
  return 'other';
}

// WHY PAGES ARE COUNTED FROM THE FILE AND NOT FROM A VIEWER.
// Opening a viewer would mean another process, another window and a fresh way to be wrong.
// A PDF states each page as /Type /Page; counting that token is honest about its own limit: a file that packs its objects into a compressed stream shows none, and then the answer is null with the reason, never a zero that reads as an empty statement.

function countPdfPages(bytes) {
  const text = bytes.toString('latin1');
  const found = text.match(/\/Type\s*\/Page(?![s])/g);
  return found ? found.length : 0;
}

// WHY THE BALANCE KEEPS ITS RAW TEXT.
// "Rp 8.900.000" and "8.900.000,-" are the same number to a person and different strings to a machine, and a bookkeeper checking the manifest wants the one the portal printed.
// Digits are for comparing; the raw is for reading.
// Cents are dropped only when they are written as cents, because in Indonesian money the dot groups thousands and the comma groups sen.

export function balanceDigits(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') return null;
  const negative = /^\s*\(.*\)\s*$/.test(text) || /^\s*-/.test(text);
  text = text.replace(/[()]/g, '').replace(/,\d{1,2}\s*$/, '');
  const digits = text.replace(/\D+/g, '').replace(/^0+(?=\d)/, '');
  return digits ? `${negative ? '-' : ''}${digits}` : null;
}

function readManifest(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw new Error(`the manifest at ${file} exists but cannot be read (${error.message}); move it aside or fix it, or a delivery would overwrite a record it cannot see`);
  }
}

export function statementDelivered({
  client,
  portal,
  period,
  path: file,
  balance = null,
  manifest = null,
  replace = false
} = {}) {
  jobShape({
    client,
    portal,
    period
  });
  if (!file || String(file).trim() === '') {
    throw new Error('statement_delivered needs path: the file download answered with. Without it there is nothing to verify.');
  }
  const where = path.resolve(String(file));
  if (where.endsWith('.crdownload') || where.endsWith('.tmp')) {
    throw new Error(`${path.basename(where)} is still being written; wait until download answers downloaded:true and hand over that path`);
  }
  let stat;
  try {
    stat = fs.statSync(where);
  } catch (error) {
    throw new Error(`no file at ${where} (${error.code ?? error.message}); pass the path download returned, because a name you expected is not evidence`);
  }
  if (!stat.isFile()) throw new Error(`${where} is not a file; a folder cannot be a delivered statement`);
  if (stat.size === 0) throw new Error(`${where} is zero bytes; a file that landed empty is a failed download wearing a name`);

  const bytes = fs.readFileSync(where);
  const kind = kindOf(bytes.subarray(0, 8));
  const pages = kind === 'pdf' ? countPdfPages(bytes) : null;
  const digits = balanceDigits(balance);
  const record = {
    client: String(client),
    portal: String(portal),
    period: String(period),
    file: path.basename(where),
    path: where,
    bytes: stat.size,
    kind,
    pages: pages === 0 ? null : pages,
    pagesFrom: kind !== 'pdf'
      ? `not a PDF: sniffed as ${kind}`
      : pages === 0
        ? 'the file packs its pages into a compressed stream, so the count is not visible'
        : 'counted from the file structure',
    balance: balance === null || balance === undefined || String(balance).trim() === ''
      ? null
      : {
        raw: String(balance).trim(),
        digits
      },
    balanceFrom: balance === null || balance === undefined || String(balance).trim() === '' ? null : 'the page the statement was downloaded from',
    deliveredAt: new Date().toISOString()
  };

  const where2 = manifest === null || manifest === undefined
    ? path.join(path.dirname(where), 'manifest.json')
    : path.resolve(String(manifest));
  const rows = readManifest(where2);
  const same = (row) => row.client === record.client && row.portal === record.portal && row.period === record.period;
  const existing = rows.find(same) ?? null;
  if (existing && !replace) {
    return {
      duplicate: true,
      record: existing,
      manifest: {
        path: where2,
        delivered: rows.length
      },
      why: `${record.client} ${record.portal} ${record.period} is already in the manifest; a second line would bill the same client-month twice. Pass replace:true only when the first file was wrong.`
    };
  }

  const next = existing ? rows.map((row) => (same(row) ? record : row)) : [
    ...rows,
    record
  ];
  fs.mkdirSync(path.dirname(where2), { recursive: true });
  const tmp = `${where2}.writing`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 1)}\n`);
  fs.rmSync(where2, { force: true });
  fs.renameSync(tmp, where2);

  return {
    duplicate: false,
    record,
    manifest: {
      path: where2,
      delivered: next.length,
      periods: [...new Set(next.map((row) => row.period))].sort(byText),
      clients: [...new Set(next.map((row) => row.client))].sort(byText)
    }
  };
}
