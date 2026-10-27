// @last-edited: 2026-10-27 UTC+7.
// @title: no-site-code — the gate that keeps a site name out of the driver.
// @state: the symbols and selectors the drive used to know Google Docs by, and the hosts it must no longer name.
// @dependencies: node:test, node:assert/strict, node:fs, node:path.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url);
const localDir = path.join(root.pathname.replace(/^\/(?=[A-Za-z]:)/, ''), 'local');

const FORBIDDEN_SYMBOLS = [
  'isDocsDocument',
  'DOCS_COPY_EXPRESSION',
  'LOCAL_CARET_EXPRESSION',
  'CARET_TOLERANCE_PX',
  'CARET_SCROLL_ATTEMPTS',
  'SCROLL_MARK',
  'kix-canvas',
  'kix-cursor',
  'kix-appview',
  'docs-texteventtarget'
];

const FORBIDDEN_HOSTS = [
  'docs.google.com',
  'sheets.google.com',
  'slides.google.com'
];

const localFiles = () => fs.readdirSync(localDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => entry.name);

test('no file in local/ names a site or a site selector', () => {
  const offenders = [];
  for (const name of localFiles()) {
    const body = fs.readFileSync(path.join(localDir, name), 'utf8');
    for (const needle of FORBIDDEN_SYMBOLS) {
      if (body.includes(needle)) offenders.push(`${name} carries ${needle}`);
    }
  }
  assert.deepEqual(offenders, [], `the drive must not know a site by name:\n${offenders.join('\n')}`);
});

test('no file in local/ matches a url against a site', () => {
  const offenders = [];
  for (const name of localFiles()) {
    const body = fs.readFileSync(path.join(localDir, name), 'utf8');
    for (const host of FORBIDDEN_HOSTS) {
      if (body.includes(host)) offenders.push(`${name} names ${host}`);
    }
  }
  assert.deepEqual(offenders, [], `a url match is the per-site code this gate exists to bar:\n${offenders.join('\n')}`);
});

test('the new modules carry the four header fields', () => {
  for (const name of ['surface-profile.js', 'read-strategy.js', 'caret-guard.js', 'action-strategy.js', 'canvas.js']) {
    const body = fs.readFileSync(path.join(localDir, name), 'utf8');
    for (const field of ['@last-edited', '@title', '@state', '@dependencies']) {
      assert.ok(body.includes(field), `${name} is missing ${field}`);
    }
  }
});
