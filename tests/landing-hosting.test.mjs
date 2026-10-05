// @last-edited: 2026-10-05 16:45 UTC+7.
// @title: landing-hosting — the Cloudflare Pages config agrees with the Vercel config.
// @state: 5 locks; the site is served by both hosts, so both configs must say the same thing.
// @dependencies: node:test, node:assert, node:fs.

// The site is served by Cloudflare Pages as well as Vercel, and the two configure
// headers in different files: vercel.json on one, _headers on the other. Nothing makes
// them agree, so this lock does. Without it the day someone adds a CSP for a new page
// on one host, that page silently loses its policy on the other.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const vercel = JSON.parse(fs.readFileSync(new URL('landing/vercel.json', root), 'utf8'));
const headers = fs.readFileSync(new URL('landing/_headers', root), 'utf8');

/**
 * Parse the Cloudflare _headers file into the same shape vercel.json uses.
 *
 * @param {string} text the whole file
 * @returns {{paths: string[], headers: Record<string, string>}[]}
 */

function parse(text) {
  const rules = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { paths: line.split(',').map((p) => p.trim()), headers: {} };
      rules.push(current);
      continue;
    }
    const at = line.indexOf(':');
    current.headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return rules;
}

const rules = parse(headers);
const bySource = Object.fromEntries(vercel.headers.map((h) => [h.source, h.headers]));

test('every _headers rule restates a vercel.json entry verbatim', () => {
  // WHY the source line is kept in the file: it names which rule each block came from,
  // so this comparison is checkable by a reader and not only by this test.
  assert.ok(rules.length > 0, 'the file has rules');
  for (const rule of rules) {
    const marker = headers.match(new RegExp(`^${escapeRe(rule.paths.join(', '))}\\n# from vercel\\.json (\\S+)`, 'm'));
    assert.ok(marker, `every rule block names its vercel.json source: ${rule.paths.join(', ')}`);
    const source = marker[1];
    const original = bySource[source];
    assert.ok(original, `vercel.json has an entry for ${source}`);
    for (const [key, value] of Object.entries(rule.headers)) {
      // WHY the one exception: Cloudflare Pages does not infer a media type from the
      // extension, and a browser handed a .zip without one saves it under the wrong
      // name. Vercel did infer it, so the two hosts genuinely differ here.
      if (key === 'Content-Type') continue;
      const match = original.find((h) => h.key === key);
      assert.ok(match, `${rule.paths[0]} sets ${key}, which ${source} also sets`);
      assert.equal(value, match.value, `${rule.paths[0]} sends the same ${key} as ${source}`);
    }
  }
});

test('every path of the site is covered, so no rule can be reached by inheritance', () => {
  // WHY this matters: the first live incident on this site was header precedence. An
  // unlisted path falls back to Cloudflare's default policy, which is not ours.
  const covered = new Set(rules.flatMap((rule) => rule.paths));
  for (const page of ['/', '/index.html', '/auth', '/auth.html', '/akun', '/akun.html', '/dashboard', '/dashboard.html', '/privasi.html', '/syarat.html', '/unduh.html', '/404.html']) {
    assert.ok(covered.has(page), `_headers must cover ${page}`);
  }
});

test('no _headers rule uses a wildcard, because ordering is the trap it avoids', () => {
  for (const rule of rules) {
    assert.doesNotMatch(rule.paths.join(' '), /\*/, `no wildcard in ${rule.paths.join(', ')}`);
  }
});

test('the pages that talk to Supabase still name only that origin', () => {
  for (const path of ['/auth', '/akun', '/dashboard']) {
    const rule = rules.find((r) => r.paths.includes(path));
    const csp = rule.headers['Content-Security-Policy'];
    assert.match(csp, /connect-src https:\/\/\*\.supabase\.co/, `${path} may reach Supabase`);
    assert.doesNotMatch(csp, /connect-src[^;]*https?:\/\/(?!\*\.supabase\.co)/, `${path} names no second origin`);
  }
  for (const path of ['/', '/privasi.html', '/syarat.html', '/unduh.html']) {
    const rule = rules.find((r) => r.paths.includes(path));
    assert.match(rule.headers['Content-Security-Policy'], /connect-src 'none'/, `${path} connects nowhere`);
  }
});

test('the archive is served as a zip so the browser saves it under its real name', () => {
  const rule = rules.find((r) => r.paths.includes('/opera-agent-1.6.15.zip'));
  assert.ok(rule, 'the archive has its own rule');
  assert.equal(rule.headers['Content-Type'], 'application/zip');
});

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}