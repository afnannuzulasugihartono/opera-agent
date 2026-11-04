# Single Host — Cloudflare Pages Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Vercel from the repository so Cloudflare Pages (`_headers`) is the only hosting configuration, with the full test suite green.

**Architecture:** Delete `vercel.json` and `.vercelignore`; make `_headers` the sole source of header policy; rewrite every test that reads `vercel.json` to read the parsed `_headers` instead; remove the vercel.app origin from CORS, auth redirects, docs, and comments. No header value changes — the policy moves house, it is not rewritten.

**Tech Stack:** Node `node:test`, `node:assert/strict`, `node:fs`, `node:crypto`; Cloudflare `_headers` format (one path per block, two-space indented headers, `#` comments).

**Spec:** `docs/superpowers/specs/2026-11-04-single-host-cloudflare-design.md`

## Global Constraints

- Tidak ada perubahan pada isi halaman, stylesheet, skrip, atau dict i18n.
- Tidak ada perubahan pada `_worker.js`, kecuali bila tes menuntut penyesuaian komentar yang menyebut Vercel.
- Tidak ada perubahan pada perilaku `deploy-site.yml` selain menghapus apa pun yang menyebut Vercel bila ada.
- Tidak ada migrasi data, tidak ada perubahan Supabase selain menghapus domain dari daftar redirect dan CORS.
- `Vercel-CDN-Cache-Control` dipertahankan sebagai no-op dokumentatif; Cloudflare mengabaikannya tanpa efek.
- Domain `opera-agent.vercel.app` tidak muncul di CORS, redirect, atau contoh — link instalasi lama gagal total (diterima pemilik 2026-11-04).

## Review Focus

1. **A path in `_headers` that no page uses** — a stale block (e.g. a removed page) would keep a CSP naming hashes of scripts that no longer exist; a reasonable person expects every block's path to match a shipped file. Pinned in Task 4.
2. **A page with no `_headers` block** — a new page added without a rule would deploy without any CSP; a reasonable person expects the suite to fail the moment a page lacks its rule. Pinned in Task 4.
3. **An inline script whose hash is not in the block's CSP** — editing a classic script without updating the hash ships a page whose script the browser refuses to run; a reasonable person expects the hash test to catch it per page. Pinned in Task 3.
4. **A Supabase redirect URL pointing at a dead host** — `config.toml` keeping vercel.app would send OAuth users to a domain that no longer answers; a reasonable person expects the redirect list to name only live hosts. Pinned in Task 6.
5. **An edge function answering a dead origin** — `_shared/cors.js` keeping vercel.app would echo ACAO for a host nobody serves; a reasonable person expects the allowlist to match the deployed front door plus extension IDs. Pinned in Task 6.

---

### Task 1: Lock the current policy surface before anything moves

**Files:**
- Test: `tests/landing-hosting.test.mjs:1-65` (read-only)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the exact path→header map every later task must preserve — 15 vercel.json sources and 24 `_headers` blocks, listed in the commit message.

- [ ] **Step 1: Dump the full policy surface into the ledger**

```bash
node -e "const v=require('./landing/vercel.json');for(const h of v.headers){console.log(h.source, h.headers.map(x=>x.key).join(','))}" > /tmp/policy-before.txt && wc -l /tmp/policy-before.txt
```

Run: `node -e "const v=require('./landing/vercel.json');for(const h of v.headers){console.log(h.source, h.headers.map(x=>x.key).join(','))}"`
Expected: 15 lines, each starting with a source path from `/` `/(.*)` `/index.html` `/beranda` `/beranda.html` `/akun` `/akun/:path*` `/akun.html` `/dashboard` `/dashboard/:path*` `/dashboard.html` `/oauth/consent` `/oauth/consent.html` `/robots.txt` `/sitemap.xml`.

- [ ] **Step 2: Record the `_headers` block count**

Run: `node -e "const fs=require('fs');console.log(fs.readFileSync('landing/_headers','utf8').split('\n\n').length + ' blocks')"`
Expected: `27 blocks`.

- [ ] **Step 3: Commit the inventory (no code changes)**

```bash
git add -N docs/superpowers/specs/2026-11-04-single-host-cloudflare-design.md
git commit -q -m "Record the 15-entry policy surface before the single-host cut" --allow-empty
```

### Task 2: Make `landing-hosting.test.mjs` read `_headers` only

**Files:**
- Modify: `tests/landing-hosting.test.mjs:1-256`
- Test: `tests/landing-hosting.test.mjs`

**Interfaces:**
- Consumes: the `parse(text)` helper already in the file (lines 20-34), which returns `rules: Array<{ paths: string[], headers: Record<string,string> }>`; a rule object looks like `{ paths: ['/beranda'], headers: { 'Content-Security-Policy': "default-src 'none'; ...", 'Cache-Control': 'no-store', ... } }`.
- Produces: a hosting suite with zero references to `vercel.json` — every later task's tests run against it.

- [ ] **Step 1: Write the failing test for "no vercel references remain"**

Add at the end of `tests/landing-hosting.test.mjs`:

```javascript
test('no part of the repo still points at the retired host', () => {
  const self = fs.readFileSync(new URL('landing-hosting.test.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(self, /vercel\.json|bySource/, 'this suite reads only _headers');
  assert.ok(!fs.existsSync(new URL('../landing/vercel.json', import.meta.url)), 'vercel.json is gone');
  assert.ok(!fs.existsSync(new URL('../landing/.vercelignore', import.meta.url)), '.vercelignore is gone');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/landing-hosting.test.mjs`
Expected: FAIL on `no part of the repo still points at the retired host` (`vercel.json` still exists).

- [ ] **Step 3: Replace the module header (lines 1-37)**

```javascript
// @last-edited: 2026-11-04 UTC+7.
// @title: landing-hosting — how the single host is configured, and why each line is there.
// @state: the site is served by Cloudflare Pages alone, so _headers is the whole policy, and every page must be allowed to load what it names.
// @dependencies: node:test, node:assert, node:fs.

// The site is served by Cloudflare Pages, and the single file landing/_headers carries the whole policy: one path per block, two-space headers, # comments.
// There is no second config to drift against, so this lock checks the file against itself: same-structure paths carry the same headers, and every page is covered.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
const headers = read('landing/_headers');

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
```

Delete the `vercel` constant (line 17) and the `bySource` constant (line 37).

- [ ] **Step 4: Replace the drift test (lines 39-56) with the self-consistency test**

```javascript
test('same-structure paths carry the same headers, because there is no second file to compare against', () => {

  assert.ok(rules.length > 0, 'the file has rules');
  const groups = [
    ['/beranda', '/beranda.html'],
    ['/akun', '/akun.html'],
    ['/dashboard', '/dashboard.html'],
    ['/oauth/consent', '/oauth/consent.html'],
    ['/privasi.html', '/syarat.html'],
    ['/fitur', '/fitur.html', '/dukungan', '/dukungan.html'],
    ['/unduh', '/unduh.html', '/unduh-berkas', '/unduh-berkas.html']
  ];
  for (const group of groups) {
    const first = rules.find((r) => r.paths.includes(group[0]));
    assert.ok(first, `${group[0]} has a rule`);
    for (const path of group.slice(1)) {
      const rule = rules.find((r) => r.paths.includes(path));
      assert.ok(rule, `${path} has a rule`);
      assert.deepEqual(rule.headers, first.headers, `${path} sends exactly the headers ${group[0]} sends`);
    }
  }
});
```

- [ ] **Step 5: Replace the archive test (lines 172-182)**

```javascript
test('the site hosts no archive, because the endpoint serves the newest one', () => {

  for (const rule of rules) {
    assert.doesNotMatch(rule.paths.join(' '), /\.(zip|crx)$/,
      `no _headers rule names a versioned archive: ${rule.paths.join(', ')}`);
  }
});
```

- [ ] **Step 6: Replace the upload-set test (lines 184-205)**

```javascript
test('one ignore file decides the upload, so no page exists on only one host', () => {

  assert.ok(!fs.existsSync(new URL('landing/.vercelignore', root)), 'there is no second ignore file to drift against');
  const assetsIgnore = read('landing/.assetsignore')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  for (const entry of ['.gitignore', '.assetsignore']) {
    assert.ok(assetsIgnore.includes(entry), `.assetsignore must exclude ${entry}`);
  }

  const pages = fs.readdirSync(new URL('landing/', root)).filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 7, `the site still has its pages, found ${pages.length}`);
  for (const page of pages) {
    assert.ok(!assetsIgnore.includes(page), `${page} must not be excluded from the upload`);
  }
});
```

- [ ] **Step 7: Delete the auto-deploy pins (lines 211-214) and the static-hosting pins (lines 216-222)**

Delete both tests outright — they assert `vercel.git.deploymentEnabled === false`, `vercel.framework === null`, `vercel.buildCommand === null`, `vercel.outputDirectory === '.'`, `vercel.cleanUrls === true`, i.e. properties of a file that will not exist. There is no Cloudflare equivalent to pin: Pages serves the directory as uploaded, with no build step to misconfigure. Record the deletion reason in the commit message.

- [ ] **Step 8: Replace the GoTrue test's vercel read (lines 247-256)**

```javascript
test('the site is reachable at the path GoTrue asks for, from the site root directory', () => {

  assert.match(read('supabase/config.toml'), /site_url = "https:\/\/opera-agent\.pages\.dev"/);
  assert.match(read('supabase/config.toml'), /authorization_path = "\/oauth\/consent"/);
  assert.ok(fs.existsSync(new URL('landing/oauth/consent.html', root)), 'the page is at that path');
  for (const source of ['/oauth/consent', '/oauth/consent.html']) {
    const rule = rules.find((r) => r.paths.includes(source));
    assert.ok(rule, `${source} carries its own policy`);
  }
});
```

- [ ] **Step 9: Update the handoff wording test (lines 224-231)**

```javascript
test('the deploy invocation is written down where it will be found', () => {

  const handoff = read('docs/handoff.md');
  assert.match(handoff, /wrangler pages deploy|Cloudflare Pages/i, 'the host that serves the site is named');
  assert.match(handoff, /publish-crx\.yml|deploy-site\.yml/, 'and the workflow that publishes it');
  assert.match(read('docs/security.md'), /wrangler pages deploy|deploy-site\.yml/, 'the invocation sits with the operator manual');
});
```

- [ ] **Step 10: Update the no-comma test's rationale comment (lines 66-75) — no code change**

The test body stays identical; only the title comment's rationale is already host-neutral. No edit needed. Verify by running.

- [ ] **Step 11: Run the suite, expecting the "still points at the retired host" test to fail on missing-file asserts**

Run: `node --test tests/landing-hosting.test.mjs`
Expected: FAIL only on `no part of the repo still points at the retired host` (vercel.json still exists) and possibly `every path of the site is covered` if a path is missing. All rewritten tests PASS.

- [ ] **Step 12: Commit the test rewrite (implementation still pending)**

```bash
git add tests/landing-hosting.test.mjs
git commit -q -m "Point the hosting lock at _headers alone"
```

### Task 3: Delete the Vercel files and empty references

**Files:**
- Delete: `landing/vercel.json`, `landing/.vercelignore`
- Modify: `landing/.gitignore` (remove `.vercel` line), `landing/.assetsignore` (rewrite header + remove `.vercelignore`/`vercel.json` lines), `landing/404.html` (comment line 3), `landing/oauth/consent.html` (comment line 89), `scripts/format-comments.mjs` (line 26: remove `'.vercelignore'` from the walked-extension list)
- Test: `tests/landing-hosting.test.mjs` (the Task 2 test now passes)

**Interfaces:**
- Consumes: the `_headers`-only suite from Task 2.
- Produces: a tree with no vercel.json — every test that reads it must already have been rewritten in Tasks 2, 5, or 6 (this task deletes last, after those rewrites land).

- [ ] **Step 1: Verify no test still reads vercel.json**

Run: `node -e "const fs=require('fs');const hits=[];for(const f of fs.readdirSync('tests').filter(x=>x.endsWith('.mjs'))){const t=fs.readFileSync('tests/'+f,'utf8');if(t.includes('vercel.json')&&!t.includes('still points at the retired host'))hits.push(f)};console.log(hits.length?hits:'clean')"`
Expected: `clean`. If not clean, STOP — Tasks 5 and 6 must land first.

- [ ] **Step 2: Delete the files**

```bash
git rm -q landing/vercel.json landing/.vercelignore
```

- [ ] **Step 3: Rewrite `landing/.assetsignore` header and entries**

```text
# @last-edited: 2026-11-04 UTC+7.
# @title: .assetsignore — keep deploy-only files out of the Cloudflare upload.
# @state: the single ignore file; tests/landing-hosting.test.mjs fails on drift.
# @dependencies: none stated.

# WHY this file exists: Cloudflare Pages uploads the whole directory, and files that are not the site must not ship.
# Same exclusions, same order.

.env*
AGENTS.md
.gitignore
.assetsignore
```

- [ ] **Step 4: Remove `.vercel` from `landing/.gitignore` and root `.gitignore` (line 76)**

Delete the `.vercel` line in both files. No other `.gitignore` content changes.

- [ ] **Step 5: Update the two HTML comments**

`landing/404.html` line 3: `<!-- @state: served by the catch-all rule in _headers. -->`
`landing/oauth/consent.html` line 89: replace `pinned in vercel.json and _headers` with `pinned in _headers`.

- [ ] **Step 6: Remove `'.vercelignore'` from `scripts/format-comments.mjs` walked list (line 26)**

The list maps extensions to walked files; delete the `'.vercelignore'` string only.

- [ ] **Step 7: Run the hosting suite**

Run: `node --test tests/landing-hosting.test.mjs`
Expected: PASS, including `no part of the repo still points at the retired host`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -q -m "Delete the retired host config; _headers is the whole policy"
```

### Task 4: Pin every `_headers` block to a shipped file (Review Focus 1+2)

**Files:**
- Modify: `tests/landing-hosting.test.mjs` (append one test)
- Test: `tests/landing-hosting.test.mjs`

**Interfaces:**
- Consumes: `rules` from Task 2 (same file, lines 20-36).
- Produces: nothing downstream; this is the guard that replaces the old drift test's coverage.

- [ ] **Step 1: Write the failing test**

Append to `tests/landing-hosting.test.mjs`:

```javascript
test('every _headers block names a shipped file, and every shipped page is named', () => {
  const pages = new Set(fs.readdirSync(new URL('landing/', root)));
  const named = new Set();
  for (const rule of rules) {
    for (const path of rule.paths) {
      const file = path === '/' ? 'index.html' : path.replace(/^\//, '');
      named.add(file);
      assert.ok(pages.has(file), `_headers names ${path}, and ${file} ships`);
    }
  }
  for (const page of [...pages].filter((f) => f.endsWith('.html'))) {
    assert.ok(named.has(page) || named.has(`oauth/${page}`), `${page} has a rule, so it never deploys without a CSP`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/landing-hosting.test.mjs`
Expected: FAIL — `oauth/consent.html` is matched only via the `oauth/` prefix check which is deliberately loose; adjust: the actual failure will surface any block whose file does not exist (none expected) or any page without a rule. If it passes immediately, verify the test is not vacuous by temporarily renaming a check — do not ship a test you never saw fail; if it passes first try, break one path on purpose, watch it fail, restore, watch it pass.

- [ ] **Step 3: Fix whatever the test surfaces (expected: nothing — `_headers` already covers all 24 paths)**

If green after the red-green check above, commit as is.

- [ ] **Step 4: Commit**

```bash
git add tests/landing-hosting.test.mjs
git commit -q -m "Pin every _headers block to a shipped file, and back"
```

### Task 5: Rewrite the eight `vercel.headers` readers

**Files:**
- Modify: `tests/landing-auth.test.mjs:16,42-49`, `tests/landing-dashboard.test.mjs:21-22,215-217`, `tests/landing-consent.test.mjs:77-83`, `tests/landing-page.test.mjs:120-123`, `tests/landing-not-found.test.mjs:12-20`, `tests/landing-unduh-hub.test.mjs:106-120`, `tests/landing-unduhswap.test.mjs:90-103`, `tests/mcp-surface.test.mjs:20,25,666-668`
- Test: each file's own suite

**Interfaces:**
- Consumes: the `parse()` shape from Task 2 — `rules: Array<{ paths: string[], headers: Record<string,string> }>`; to look up a CSP for a source path, use `rules.find((r) => r.paths.includes(source)).headers['Content-Security-Policy']`.
- Produces: eight suites with zero `vercel.json` reads.

The rewrite rule is identical in all eight files: replace the `vercel.headers` map lookup with a `rules.find` lookup on the parsed `_headers`. The CSP string content is unchanged — same policy, new home. Work them one file at a time, running that file's suite after each.

- [ ] **Step 1: `landing-auth.test.mjs` — lines 16, 42-49**

Replace line 16 (`const vercel = JSON.parse(...)`) with a local `parse` + `rules` (copy the 15-line helper from `landing-hosting.test.mjs:20-36` — do not import across test files; each suite stays self-contained the way the repo already does it).

Replace lines 37-53:

```javascript
test('the landing page itself stays network-free while auth may reach only Supabase', () => {

  const sources = rules.flatMap((r) => r.paths);
  for (const source of ['/(.*)', '/', '/index.html', '/beranda', '/beranda.html', '/akun', '/akun/:path*', '/akun.html', '/dashboard', '/dashboard/:path*', '/dashboard.html', '/oauth/consent', '/oauth/consent.html', '/robots.txt', '/sitemap.xml']) {
    assert.ok(sources.includes(source), `_headers defines ${source}`);
  }
  const rootRule = rules.find((r) => r.paths.includes('/(.*)'));
  const rootCsp = rootRule.headers['Content-Security-Policy'];
  assert.match(rootCsp, /connect-src 'none'/, 'the marketing page still connects nowhere');

  const authSources = ['/', '/index.html', '/oauth/consent', '/oauth/consent.html'];
  for (const source of authSources) {
    const rule = rules.find((r) => r.paths.includes(source));
    assert.ok(rule, `_headers must define a header entry for ${source}`);
    const csp = rule.headers['Content-Security-Policy'];
    assert.match(csp, /connect-src https:\/\/\*\.supabase\.co/, `${source} may reach only Supabase`);
    assert.doesNotMatch(csp, /connect-src[^;]*https?:\/\/(?!\*\.supabase\.co)/, 'no second origin rides along');
  }
  assert.doesNotMatch(html, /src="https?:/, 'even the auth page loads no external script');
});
```

Run: `node --test tests/landing-auth.test.mjs` Expected: PASS.

- [ ] **Step 2: `landing-dashboard.test.mjs` — lines 21-22, 215-217**

Same helper copy. Replace lines 214-221:

```javascript
test('the dashboard may reach only Supabase like the auth page', () => {
  for (const source of ['/dashboard', '/dashboard/:path*', '/dashboard.html']) {
    const rule = rules.find((r) => r.paths.includes(source));
    assert.ok(rule, `_headers must define a header entry for ${source}`);
    const csp = rule.headers['Content-Security-Policy'];
    assert.match(csp, /connect-src https:\/\/\*\.supabase\.co/, `${source} may reach only Supabase`);
  }
});
```

Run: `node --test tests/landing-dashboard.test.mjs` Expected: PASS.

- [ ] **Step 3: `landing-consent.test.mjs` — lines 77-83**

```javascript
  const sources = rules.flatMap((r) => r.paths);
  assert.ok(sources.includes('/oauth/consent'), 'and the CSP covers it on the single host');
  assert.doesNotMatch(sources.join(' '), /^\/consent$/m, 'no stale entry for the path nothing requested');
```

Run: `node --test tests/landing-consent.test.mjs` Expected: PASS.

- [ ] **Step 4: `landing-page.test.mjs` — lines 120-123**

```javascript
test('the site has no build step and no external origin', () => {
  const rule = rules.find((r) => r.paths.includes('/(.*)'));
  const csp = rule.headers['Content-Security-Policy'];
  assert.match(csp, /connect-src 'none'/, 'the page must be forbidden from connecting anywhere');
  assert.doesNotMatch(html, /src="https?:/, 'no external script or stylesheet');
  assert.doesNotMatch(html, /<link[^>]+href="https?:/, 'no external stylesheet');
});
```

Run: `node --test tests/landing-page.test.mjs` Expected: PASS.

- [ ] **Step 5: `landing-not-found.test.mjs` — whole file**

```javascript
// @last-edited: 2026-11-04 UTC+7.
// @title: landing-not-found — a lost visitor gets the site, not a host error page.
// @state: the 404 page exists, and Cloudflare serves it for unknown paths.
// @dependencies: test, assert, fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const html = fs.readFileSync(new URL('landing/404.html', root), 'utf8');
const headers = fs.readFileSync(new URL('landing/_headers', root), 'utf8');

test('a wrong path lands on the site instead of a host error page', () => {
  // WHY THERE IS NO REWRITE TO PIN: Cloudflare Pages serves landing/404.html for unknown paths by convention, with no rule to write — so the claim lives on the file existing, and on _headers covering only real paths.
  assert.ok(fs.existsSync(new URL('landing/404.html', root)), 'the 404 page ships');
  const paths = headers.split('\n').filter((l) => l && !l.startsWith('#') && !/^\s/.test(l));
  assert.doesNotMatch(paths.join(' '), /\*/, 'no wildcard claims paths that do not exist');
});
```

Keep the second test (`the 404 page helps instead of apologising`) unchanged.

Run: `node --test tests/landing-not-found.test.mjs` Expected: PASS.

- [ ] **Step 6: `landing-unduh-hub.test.mjs` — lines 106-120**

```javascript
test('the hub needs no script hash, and the shared policy still names the merged script', () => {

  assert.doesNotMatch(hub, /<script type="module">/, 'the hub carries no inline module to name');
  const rule = rules.find((r) => r.paths.includes('/(.*)'));
  const csp = rule.headers['Content-Security-Policy'];
  const headers = read('_headers');
  const body = /<script type="module">([\s\S]*?)<\/script>/.exec(berkas)[1];
  const hash = "'sha256-" + createHash('sha256').update(body, 'utf8').digest('base64') + "'";
  assert.ok(csp.includes(hash), 'the single host still names the unduh-berkas.html script');
  for (const path of ['/unduh-berkas.html', '/unduh-berkas']) {
    const block = headers.split('\n\n').find((b) => b.startsWith(`${path}\n`));
    assert.ok(block && block.includes(hash), `_headers still names it for ${path}`);
  }
});
```

This file needs the `rules` helper too — copy the same 15-line `parse` block, with `read` already defined in the file (check: the file uses `read('vercel.json')` at line 109, so a `read` helper exists; keep it and add `parse` + `rules`).

Run: `node --test tests/landing-unduh-hub.test.mjs` Expected: PASS.

- [ ] **Step 7: `landing-unduhswap.test.mjs` — lines 90-103**

```javascript
test('the merged script is named by a hash on the one host', () => {

  const rule = rules.find((r) => r.paths.includes('/(.*)'));
  const csp = rule.headers['Content-Security-Policy'];
  const headers = read('_headers');
  const body = /<script type="module">([\s\S]*?)<\/script>/.exec(berkas)[1];
  const hash = "'sha256-" + createHash('sha256').update(body, 'utf8').digest('base64') + "'";
  assert.ok(csp.includes(hash), 'the single host names the unduh-berkas.html script');
  for (const path of ['/unduh-berkas.html', '/unduh-berkas']) {
    const block = headers.split('\n\n').find((b) => b.startsWith(`${path}\n`));
    assert.ok(block && block.includes(hash), `_headers names it for ${path}`);
  }
});
```

Same helper copy. Run: `node --test tests/landing-unduhswap.test.mjs` Expected: PASS.

- [ ] **Step 8: `mcp-surface.test.mjs` — lines 20, 25, 666-668**

Delete line 20 (`siteVercelConfigUrl`) and line 25 (`siteVercelConfig`). Add after line 19:

```javascript
const siteHeadersUrl = new URL('../landing/_headers', import.meta.url);
```

Replace lines 666-668:

```javascript
  const siteHeaders = await readFile(siteHeadersUrl, 'utf8');
  const consentBlock = siteHeaders.split('\n\n').find((b) => b.startsWith('/oauth/consent\n'));
  assert.ok(consentBlock, 'and the site serves it under its own policy block');
  assert.match(consentBlock, /connect-src https:\/\/\*\.supabase\.co/, 'the consent page reaches Supabase and nothing else');
```

Run: `node --test tests/mcp-surface.test.mjs` Expected: PASS.

- [ ] **Step 9: Commit the eight rewrites**

```bash
git add tests/landing-auth.test.mjs tests/landing-dashboard.test.mjs tests/landing-consent.test.mjs tests/landing-page.test.mjs tests/landing-not-found.test.mjs tests/landing-unduh-hub.test.mjs tests/landing-unduhswap.test.mjs tests/mcp-surface.test.mjs
git commit -q -m "Read the header policy from _headers, not the retired file"
```

### Task 6: Remove the dead origin everywhere it still answers

**Files:**
- Modify: `supabase/config.toml:14`, `supabase/functions/_shared/cors.js:7,13`, `docs/handoff.md:76,81`, `docs/security.md` (only the line that names the deploy invocation if it mentions Vercel — check first), `tests/edge-cors.test.mjs:18-24,31-35`, `tests/landing-execution.test.mjs:92`
- Test: `tests/edge-cors.test.mjs`, `tests/landing-execution.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks (independent file edits, but land after Task 5's commit so the suite is green at each step).
- Produces: zero `vercel.app` strings outside history and the spec's own record of the removal.

- [ ] **Step 1: Write the failing test first (extend the Task 2 guard)**

Append to the `no part of the repo still points at the retired host` test in `tests/landing-hosting.test.mjs`:

```javascript
  for (const file of ['supabase/config.toml', 'supabase/functions/_shared/cors.js', 'docs/handoff.md']) {
    const text = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /vercel\.app/, `${file} names no dead host`);
  }
```

Run: `node --test tests/landing-hosting.test.mjs` Expected: FAIL (all three files still name it).

- [ ] **Step 2: `supabase/config.toml` line 14**

```toml
redirect_urls = ["https://opera-agent.pages.dev"]
```

- [ ] **Step 3: `supabase/functions/_shared/cors.js` lines 7, 13**

```javascript
// WHY one site origin: Cloudflare Pages at opera-agent.pages.dev is the product's front door, and there is no second host to keep answering while installs migrate — the migration already happened when the backup died.
```

```javascript
const FALLBACK_ORIGINS = Object.freeze([
  'chrome-extension://ofgemipoobcnbjkfanmofjbdonjapmgl',
  'chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick',
  'https://opera-agent.pages.dev'
]);
```

- [ ] **Step 4: `tests/edge-cors.test.mjs` lines 18-24, 31-35**

```javascript
  assert.deepEqual(CORS_DEFAULT_ORIGINS, [
    'chrome-extension://ofgemipoobcnbjkfanmofjbdonjapmgl',
    'chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick',
    'https://opera-agent.pages.dev'
  ]);
```

Line 33: delete the `vercel.app.evil.com` line — the lookalike test keeps `pages.dev.evil.com` and `evil.com`, which still prove suffix-matching is exact.

- [ ] **Step 5: `tests/landing-execution.test.mjs` line 92**

Replace `href: \`https://opera-agent.vercel.app/${page}\`` with `href: \`https://opera-agent.pages.dev/${page}\``. This is the stub browser location in the VM harness; it must name the live host.

- [ ] **Step 6: `docs/handoff.md` lines 75-76, 81**

Replace line 75-76's `Vercel is the backup` sentence with: `Cloudflare Pages at opera-agent.pages.dev serves the site; there is no second host, so there is nothing to drift against.` Line 81's `landing/_headers restates the vercel.json policy per path` becomes: ``landing/_headers` states the policy per path, with HSTS, a locked-down ... `` (keep the rest of the sentence).

- [ ] **Step 7: Check `docs/security.md` for a Vercel mention before touching it**

Run: `node -e "const s=require('fs').readFileSync('docs/security.md','utf8');console.log((s.match(/vercel/gi)||[]).length)"`. If zero, skip. If nonzero, update only the exact line that names the deploy invocation, mirroring the handoff wording.

- [ ] **Step 8: Run the affected suites**

Run: `node --test tests/landing-hosting.test.mjs tests/edge-cors.test.mjs tests/landing-execution.test.mjs`
Expected: PASS all three.

- [ ] **Step 9: Commit**

```bash
git add supabase/config.toml supabase/functions/_shared/cors.js docs/handoff.md docs/security.md tests/edge-cors.test.mjs tests/landing-execution.test.mjs tests/landing-hosting.test.mjs
git commit -q -m "Answer only the live host, in config, code, and docs"
```

### Task 7: Full verification and live header check

**Files:** none (verification only).

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all green, zero failures.

- [ ] **Step 2: Runtime check**

Run: `npm run check`
Expected: `check ok: 31 allowlisted browser primitives, 183 runtime safety files`.

- [ ] **Step 3: Formatter**

Run: `node scripts/format-comments.mjs`
Expected: `comment format ok`.

- [ ] **Step 4: Browser gate**

Run: `py tests/browser_extension_test.py`
Expected: exit 0.

- [ ] **Step 5: Live header check against production**

Run:
```bash
curl -sI https://opera-agent.pages.dev/beranda | grep -i "^content-security-policy"
```
Expected: the exact CSP from the `/beranda` block in `landing/_headers`, including `connect-src 'none'` and the beranda inline-script hash. Then the same for `/` (Supabase origin allowed) and `/oauth/consent` (Supabase origin allowed).

- [ ] **Step 6: Commit the ledger only (no code changes in this task)**

Record results in the SDD ledger. No commit needed if nothing changed.
