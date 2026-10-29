// @last-edited: 2026-10-26 UTC+7.
// @title: landing-hosting — how both hosts are configured, and why each line is there.
// @state: the site is served by both hosts, so both configs must say the same thing, and every page must be allowed to load what it names.
// @dependencies: node:test, node:assert, node:fs.

// The site is served by Cloudflare Pages as well as Vercel, and the two configure headers in different files: vercel.json on one, _headers on the other.
// Nothing makes them agree, so this lock does.
// Without it the day someone adds a CSP for a new page on one host, that page silently loses its policy on the other.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
const vercel = JSON.parse(read('landing/vercel.json'));
const headers = read('landing/_headers');

function parse(text) {
  const rules = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = {
        paths: line.split(',').map((p) => p.trim()),
        headers: {}
      };
      rules.push(current);
      continue;
    }
    const at = line.indexOf(':');
    current.headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return rules;
}

const rules = parse(headers);
const bySource = Object.fromEntries(vercel.headers.map((h) => [
  h.source,
  h.headers
]));

test('every _headers rule restates a vercel.json entry verbatim', () => {
  assert.ok(rules.length > 0, 'the file has rules');
  for (const rule of rules) {
    const marker = headers.match(new RegExp(`^${escapeRe(rule.paths.join(', '))}\\n# from vercel\\.json (\\S+)`, 'm'));
    assert.ok(marker, `every rule block names its vercel.json source: ${rule.paths.join(', ')}`);
    const source = marker[1];
    const original = bySource[source];
    assert.ok(original, `vercel.json has an entry for ${source}`);
    for (const [key, value] of Object.entries(rule.headers)) {
      if (key === 'Content-Type' || key === 'Vercel-CDN-Cache-Control') continue;
      const match = original.find((h) => h.key === key);
      assert.ok(match, `${rule.paths[0]} sets ${key}, which ${source} also sets`);
      assert.equal(value, match.value, `${rule.paths[0]} sends the same ${key} as ${source}`);
    }
  }
});

test('every path of the site is covered, so no rule can be reached by inheritance', () => {
  const covered = new Set(rules.flatMap((rule) => rule.paths));
  for (const page of ['/', '/beranda', '/beranda.html', '/index.html', '/akun', '/akun.html', '/dashboard', '/dashboard.html', '/unduh', '/unduh.html', '/unduh-berkas', '/unduh-berkas.html', '/privasi', '/privasi.html', '/syarat', '/syarat.html', '/fitur', '/fitur.html', '/dukungan', '/dukungan.html', '/404.html', '/robots.txt', '/sitemap.xml']) {
    assert.ok(covered.has(page), `_headers must cover ${page}`);
  }
});

test('no _headers block joins paths with a comma, because Cloudflare matches it against nothing', () => {
  for (const rule of rules) {
    assert.equal(rule.paths.length, 1, `one path per block: ${rule.paths.join(', ')}`);
  }
  for (const line of headers.split('\n')) {
    if (!line.trim() || line.startsWith('#') || /^\s/.test(line)) continue;
    assert.doesNotMatch(line, /,/, `no comma-joined path line: ${line}`);
  }
});

test('no _headers rule uses a wildcard, because ordering is the trap it avoids', () => {
  for (const rule of rules) {
    assert.doesNotMatch(rule.paths.join(' '), /\*/, `no wildcard in ${rule.paths.join(', ')}`);
  }
});

test('the pages that talk to Supabase still name only that origin', () => {
  for (const path of ['/', '/index.html', '/akun', '/dashboard']) {
    const rule = rules.find((r) => r.paths.includes(path));
    const csp = rule.headers['Content-Security-Policy'];
    assert.match(csp, /connect-src https:\/\/\*\.supabase\.co/, `${path} may reach Supabase`);
    assert.doesNotMatch(csp, /connect-src[^;]*https?:\/\/(?!\*\.supabase\.co)/, `${path} names no second origin`);
  }
  for (const path of ['/beranda', '/privasi.html', '/syarat.html', '/unduh.html']) {
    const rule = rules.find((r) => r.paths.includes(path));
    assert.match(rule.headers['Content-Security-Policy'], /connect-src 'none'/, `${path} connects nowhere`);
  }
});

test('every inline module script is named by a hash, and the CSP offers no unsafe-inline', () => {
  const hashOf = (html) => {
    const body = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    return "'sha256-" + createHash('sha256').update(body, 'utf8').digest('base64') + "'";
  };
  for (const path of ['beranda.html', 'index.html', 'akun.html', 'dashboard.html', 'dukungan.html', 'oauth/consent.html']) {
    const rule = rules.find((r) => r.paths.includes(`/${path}`) || (path === 'index.html' && r.paths.includes('/')));
    const csp = rule?.headers['Content-Security-Policy'];
    const html = read(`landing/${path}`);
    assert.ok(csp, `${path} has a CSP`);
    assert.match(csp, /script-src 'self'/, `${path} runs scripts from itself only`);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/, `${path} has no inline-script loophole`);
    assert.ok(csp.includes(hashOf(html)), `${path} CSP names its exact inline script`);
  }
});

test('every page may load the stylesheet and script it names', () => {
  // WHY THE POLICY IS CHECKED AGAINST THE ASSETS AND NOT ONLY AGAINST THE OTHER HOST.
  // Measured live on 2026-10-26: every page linked /site.css, every CSP said style-src 'unsafe-inline' without 'self', and both hosts blocked the site's own stylesheet.
  // The only symptom was a console error: the header computed as display:block and the nav lost its layout.
  // The drift test above would have kept the two hosts equal in their mistake, so this test asks the question the drift test cannot.

  const pages = fs.readdirSync(new URL('landing/', root)).filter((f) => f.endsWith('.html'));
  for (const page of pages) {
    const html = read(`landing/${page}`);
    const assets = [
      ...[...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => [
        'style-src',
        m[1]
      ]),
      ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => [
        'script-src',
        m[1]
      ])
    ];
    const rule = rules.find((r) => r.paths.includes(`/${page}`));
    assert.ok(rule, `${page} has a _headers rule`);
    const csp = rule.headers['Content-Security-Policy'];
    assert.ok(csp, `${page} has a CSP`);
    for (const [directive, href] of assets) {
      if (/^[a-z]+:|^\/\//i.test(href)) continue;
      assert.match(csp, new RegExp(`${directive} [^;]*'self'`), `${page} may load its own ${href} under ${directive}`);
    }
  }
});

test('the features page states the counts and the permissions the product has', () => {
  // WHY THE FEATURES PAGE IS READ AGAINST THE CODE.
  // Measured on 2026-10-26: the page said 31 tools and 29 primitives, its meta said 39 and 28, and it named five permissions while the manifest declares six.
  // A marketing page that undercounts its own permissions is not a rounding error: it describes a product with less access than the one it ships.

  const protocol = read('extension/lib/protocol.js');
  const specs = /METHOD_SPECS\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(protocol)?.[1] ?? '';
  const primitives = [...specs.matchAll(/^\s{2}'([a-z_]+\.[a-z_]+)':/gm)].length;
  const contract = JSON.parse(read('tests/fixtures/mcp-contract-v1.json'));
  const manifest = JSON.parse(read('extension/manifest.json'));
  const fitur = read('landing/fitur.html');

  assert.ok(primitives > 0, 'the protocol exports an allowlist to count');
  assert.equal(contract.toolCount, contract.tools.length, 'the contract agrees with itself');
  assert.match(fitur, new RegExp(`>${contract.toolCount} tool, ${primitives} primitive<`),
    `the Indonesian heading states ${contract.toolCount} tools and ${primitives} primitives`);
  assert.match(fitur, new RegExp(`"${contract.toolCount} tools, ${primitives} primitives"`),
    'the English heading states the same counts');
  assert.match(fitur, new RegExp(`<meta name="description" content="[^"]*${contract.toolCount} tool dan ${primitives} primitive`),
    'the description a search engine reads states the same counts');

  for (const permission of manifest.permissions) {
    assert.match(fitur, new RegExp(`\\b${permission}\\b`, 'i'), `the features page names the ${permission} permission`);
  }
  assert.equal(manifest.permissions.length, 6, 'the manifest still declares six API permissions, so the page must say six');
  assert.match(fitur, /Enam izin, dijelaskan/, 'the Indonesian heading counts six permissions');
  assert.match(fitur, /Six permissions, each explained/, 'the English heading counts six permissions');
});

test('the site hosts no archive, because the endpoint serves the newest one', () => {
  for (const rule of rules) {
    assert.doesNotMatch(rule.paths.join(' '), /\.(zip|crx)$/,
      `no _headers rule names a versioned archive: ${rule.paths.join(', ')}`);
  }
  for (const header of vercel.headers) {
    assert.doesNotMatch(header.source, /\.(zip|crx)$/,
      `vercel.json names no versioned archive: ${header.source}`);
  }
});

test('both hosts upload the same file set, so no page exists on only one of them', () => {
  const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const vercelIgnore = read('.vercelignore');
  const assetsIgnore = read('.assetsignore');
  for (const entry of vercelIgnore) {
    assert.ok(assetsIgnore.includes(entry), `.assetsignore must also exclude ${entry}`);
  }

  for (const entry of ['.gitignore', '.vercelignore', 'vercel.json', '.assetsignore']) {
    assert.ok(assetsIgnore.includes(entry), `.assetsignore must exclude ${entry}`);
  }

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
  assert.equal(vercel.git?.deploymentEnabled, false, 'git auto-deployment is off');
});

test('the static-hosting pins survive that change', () => {
  assert.equal(vercel.framework, null, 'no framework may be detected');
  assert.equal(vercel.buildCommand, null, 'there is no build step to run');
  assert.equal(vercel.outputDirectory, '.', 'the served directory is the site itself');
  assert.equal(vercel.cleanUrls, true, 'and extensionless URLs are the canonical ones');
});

test('the deploy invocation is written down where it will be found', () => {
  const handoff = read('docs/handoff.md');
  assert.match(handoff, /wrangler pages deploy|Cloudflare Pages/i, 'the host that serves the site is named');
  assert.match(handoff, /publish-crx\.yml|deploy-site\.yml/, 'and the workflow that publishes it');
  assert.match(handoff, /CLI cannot deploy/i, 'and says plainly that the Vercel CLI is not the way');
  assert.match(read('docs/security.md'), /wrangler pages deploy|deploy-site\.yml/, 'the invocation sits with the operator manual');
});

test('the edge is told not to hold a page, because Cache-Control alone does not', () => {
  for (const entry of vercel.headers) {
    const cdn = entry.headers.find((h) => h.key === 'Vercel-CDN-Cache-Control');
    assert.ok(cdn, `${entry.source} tells the edge what to do`);

    assert.equal(cdn.value, 'no-store', `${entry.source} releases rather than holds`);
  }
  const headers = read('landing/_headers');
  const rules = headers.split('\n').filter((l) => /^ {2}Vercel-CDN-Cache-Control:/.test(l));
  const blocks = headers.split(/\n\n/).filter((b) => /^ {2}Cache-Control:/m.test(b));
  assert.equal(rules.length, blocks.length, 'the other host is told the same thing on every rule');
});

test('the site is reachable at the path GoTrue asks for, from the site root directory', () => {
  assert.match(read('supabase/config.toml'), /site_url = "https:\/\/opera-agent\.pages\.dev"/);
  assert.match(read('supabase/config.toml'), /authorization_path = "\/oauth\/consent"/);
  assert.ok(fs.existsSync(new URL('landing/oauth/consent.html', root)), 'the page is at that path');
  const sources = vercel.headers.map((h) => h.source);
  for (const source of ['/oauth/consent', '/oauth/consent.html']) {
    assert.ok(sources.includes(source), `${source} carries its own policy`);
  }
});
