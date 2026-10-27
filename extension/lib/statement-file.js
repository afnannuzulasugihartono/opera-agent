// @last-edited: 2026-10-21 UTC+7.
// @title: statement-file — the byte-level proof of a file, shared by the worker and the page.
// @state: the kind of a file and its page count, read from the bytes themselves.
// @dependencies: none.

// WHY THIS IS A CLASSIC SCRIPT AND NOT A MODULE.
// The worker needs these two answers about a file it has just downloaded, and it cannot read that file: a service worker has no access to the disk the browser wrote to.
// The page can read the same bytes - it fetched them - but a content script cannot import a module either.
// So the answers live here, in a file with no exports that publishes them on globalThis, and both sides read them from there: the worker imports it for the side effect, and the page has it injected before the verification runs.

// WHY THE BYTES AND NOT THE NAME.
// A portal that answers a PDF request with an HTML error page and a .pdf name is common enough, and trusting the name would file an error page as a statement.
// The kind is read from the first bytes, and the page count is read from the file's own structure.

(() => {
  'use strict';

  if (globalThis.OperaAgentStatementFile) return;

  const PDF_HEAD = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  const ZIP_HEAD = [0x50, 0x4b, 0x03, 0x04];
  const OLE_HEAD = [0xd0, 0xcf, 0x11, 0xe0];

  const startsWith = (bytes, head) => {
    if (!bytes || bytes.length < head.length) return false;
    for (let i = 0; i < head.length; i += 1) {
      if (bytes[i] !== head[i]) return false;
    }
    return true;
  };

  // WHY FOUR ANSWERS.
  // A PDF, a workbook, an old Office file, and "something else" are the four kinds a statement arrives as, and the four magic numbers are enough to tell them apart without a parser.
  const kindOf = (bytes) => {
    if (startsWith(bytes, PDF_HEAD)) return 'pdf';
    if (startsWith(bytes, ZIP_HEAD)) return 'zip';
    if (startsWith(bytes, OLE_HEAD)) return 'ole';
    return 'other';
  };

  const latin1 = (bytes) => {
    let out = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return out;
  };

  // WHY THE PAGE COUNT IS COUNTED AND NOT PARSED.
  // A PDF states each page as /Type /Page, and counting that token is honest about its own limit: a file that packs its objects into a compressed stream shows none, and then the answer is zero with the reason, never a number that reads like a count.
  const countPages = (bytes) => {
    const text = latin1(bytes);
    const found = text.match(/\/Type\s*\/Page(?![s])/g);
    return found ? found.length : 0;
  };

  // WHY THE REASON IS PART OF THE ANSWER.
  // "Two pages" and "the file packs its pages into a compressed stream" are different facts, and only one of them tells a bookkeeper that the statement is short.
  const pagesFrom = (kind, pages) => {
    if (kind !== 'pdf') return `not a PDF: sniffed as ${kind}`;
    if (!pages) return 'the file packs its pages into a compressed stream, so the count is not visible';
    return 'counted from the file structure';
  };

  // WHY THE MONEY IS READ TWICE.
  // A bookkeeper checks the manifest by eye, so the text the portal printed is kept; a machine compares two months, so the digits are derived.
  // This rule mirrors the one in local/jobs/statements.js: Indonesian money groups thousands with a dot and sen with a comma, so a trailing ",00" is cents and is dropped, and a figure in brackets is negative.
  // The two copies of this rule are a known pair: if they ever disagree, the same raw text produces two different digit strings, which the proof contract would show.
  const balanceDigits = (raw) => {
    let text = String(raw ?? '').trim();
    if (text === '') return null;
    const negative = /^\s*\(.*\)\s*$/.test(text) || /^\s*-/.test(text);
    text = text.replace(/[()]/g, '').replace(/,\d{1,2}\s*$/, '');
    const digits = text.replace(/\D+/g, '').replace(/^0+(?=\d)/, '');
    return digits ? `${negative ? '-' : ''}${digits}` : null;
  };

  globalThis.OperaAgentStatementFile = { kindOf, countPages, pagesFrom, balanceDigits };
})();
