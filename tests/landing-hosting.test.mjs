// @last-edited: 2026-10-06 09:18 UTC+7.
// @title: landing-hosting — how both hosts are configured, and why each line is there.
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
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
const vercel = JSON.parse(read('landing/vercel.json'));
const headers = read('landing/_headers');

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
      // WHY the two exceptions: Cloudflare Pages does not infer a media type from the
      // extension, and Vercel's own edge header means nothing to the other host. Both
      // files still have to say the same thing about everything else.
      if (key === 'Content-Type' || key === 'Vercel-CDN-Cache-Control') continue;
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

test('both hosts upload the same file set, so no page exists on only one of them', () => {
  // WHY this lock: Vercel reads .vercelignore, Cloudflare Pages reads .assetsignore, and
  // a page published on one host and missing on the other is the hardest kind of 404 to
  // notice. The two lists must therefore name the same things.
  const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const vercelIgnore = read('.vercelignore');
  const assetsIgnore = read('.assetsignore');
  for (const entry of vercelIgnore) {
    assert.ok(assetsIgnore.includes(entry), `.assetsignore must also exclude ${entry}`);
  }
  // WHY these four are excluded on Cloudflare and not on Vercel: they are deployment
  // plumbing, not pages. Publishing them would make the two hosts differ, which is the
  // thing this lock exists to prevent, and a reader gains nothing from them.
  for (const entry of ['.gitignore', '.vercelignore', 'vercel.json', '.assetsignore']) {
    assert.ok(assetsIgnore.includes(entry), `.assetsignore must exclude ${entry}`);
  }
  // WHY every page must survive the exclusion list: an ignore pattern is a glob, and a
  // pattern too broad would silently take a page with it.
  const pages = fs.readdirSync(new URL('landing/', root)).filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 7, `the site still has its pages, found ${pages.length}`);
  for (const page of pages) {
    assert.ok(!assetsIgnore.includes(page), `${page} must not be excluded from the upload`);
  }
});

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('a push does not deploy, because every push spent the daily budget', () => {
  // WHY this is locked rather than noted: the failure mode is silence. The push succeeds,
  // the commit is on main, and production keeps serving the previous build with nothing in
  // CI or git to say so. Measured twice on this project.
  assert.equal(vercel.git?.deploymentEnabled, false, 'git auto-deployment is off');
});

test('the static-hosting pins survive that change', () => {
  // WHY these three specifically: an auto-detected framework replaced the root document
  // once already, and the deployment URL served a dashboard while the alias 404'd.
  assert.equal(vercel.framework, null, 'no framework may be detected');
  assert.equal(vercel.buildCommand, null, 'there is no build step to run');
  assert.equal(vercel.outputDirectory, '.', 'the served directory is the site itself');
  assert.equal(vercel.cleanUrls, true, 'and extensionless URLs are the canonical ones');
});

test('the deploy invocation is written down where it will be found', () => {
  // WHY this assertion changed twice: the project's Root Directory is `landing`, so the
  // Vercel CLI resolves `landing/landing` from the repository root and refuses, and from
  // inside `landing/` it refuses the same way. Measured on this project. Cloudflare then
  // became the front door and the Vercel CLI stopped being the way to publish at all, so
  // the lock now names the host that serves the site and the workflow that publishes it.
  // A lock naming a retired invocation would preserve a claim that stopped being true.
  const handoff = read('docs/HANDOFF.md');
  assert.match(handoff, /wrangler pages deploy|Cloudflare Pages/i, 'the host that serves the site is named');
  assert.match(handoff, /publish-crx\.yml|deploy-site\.yml/, 'and the workflow that publishes it');
  assert.match(handoff, /CLI cannot deploy/i, 'and says plainly that the Vercel CLI is not the way');
  assert.match(read('AGENTS.md'), /wrangler pages deploy|deploy-site\.yml/, 'the invocation sits with the rules that bind a deploy');
});

test('the edge is told not to hold a page, because Cache-Control alone does not', () => {
  // WHY this lock names two headers: measured on the live site, every page answered 200 with
  // `Cache-Control: no-store` and `x-vercel-cache: HIT` with an age around thirty minutes,
  // and the cached copy survived a deployment. A shipped fix was invisible for half an hour
  // and a live verification read the previous build. `Cache-Control` governs the browser;
  // Vercel's edge only obeys `Vercel-CDN-Cache-Control`, which nothing here set.
  for (const entry of vercel.headers) {
    const cdn = entry.headers.find((h) => h.key === 'Vercel-CDN-Cache-Control');
    assert.ok(cdn, `${entry.source} tells the edge what to do`);
    // WHY the CRX is in the immutable group with the zip: both are versioned
    // artifacts whose bytes never change under a given name, so re-fetching them
    // on every visit would be waste, and a stale copy is impossible because a
    // new version is a new filename. The .exe is NOT here: it is rebuilt often
    // and served from the same name, so holding it would pin an old installer.
    const isArchive = /\.(zip|crx)$/.test(entry.source);
    assert.equal(cdn.value, isArchive ? 'public, max-age=31536000, immutable' : 'no-store', `${entry.source} holds or releases as intended`);
  }
  const headers = read('landing/_headers');
  const rules = headers.split('\n').filter((l) => /^ {2}Vercel-CDN-Cache-Control:/.test(l));
  const blocks = headers.split(/\n\n/).filter((b) => /^ {2}Cache-Control:/m.test(b));
  assert.equal(rules.length, blocks.length, 'the other host is told the same thing on every rule');
});

test('the archive is held, because its name carries the version', () => {
  const archive = vercel.headers.find((h) => h.source === '/opera-agent-1.6.15.zip');
  assert.ok(archive, 'the archive has a rule of its own rather than inheriting no-store');
  assert.match(archive.headers.find((h) => h.key === 'Cache-Control').value, /immutable/, 'and is immutable, which is safe only because the name is versioned');
});

test('the site is reachable at the path GoTrue asks for, from the site root directory', () => {
  // WHY the two belong in one lock: the consent screen only works because it is served
  // from the same origin GoTrue validates, and it only works at that path because the
  // file sits in the directory the URL names.
  assert.match(read('supabase/config.toml'), /site_url = "https:\/\/opera-agent\.pages\.dev"/);
  assert.match(read('supabase/config.toml'), /authorization_path = "\/oauth\/consent"/);
  assert.ok(fs.existsSync(new URL('landing/oauth/consent.html', root)), 'the page is at that path');
  const sources = vercel.headers.map((h) => h.source);
  for (const source of ['/oauth/consent', '/oauth/consent.html']) {
    assert.ok(sources.includes(source), `${source} carries its own policy`);
  }
});
