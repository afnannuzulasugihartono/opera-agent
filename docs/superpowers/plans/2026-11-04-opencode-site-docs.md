@last-edited: 2026-11-04 UTC+7.
@related: [`../../../AGENTS.md`](../../../AGENTS.md) - [`../specs/2026-11-03-dark-opencode-benchmark-design.md`](../specs/2026-11-03-dark-opencode-benchmark-design.md) - [`../../../docs/product/billing.md`](../../../docs/product/billing.md)

# Plan: Situs benchmark opencode.ai, diet teks, halaman /docs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menarik situs publik satu langkah lebih dekat ke opencode.ai (token, tipografi mono-first, gerak 150–200ms), memangkas teks yang berulang dan salah, dan menambah halaman `/docs` yang memuat panduan pasang, pairing, tugas, saldo, MCP, dan batas.

**Architecture:** `landing/site.css` tetap satu-satunya sumber token dan komponen bersama; enam lembar halaman hanya menyimpan komposisi. Halaman baru `landing/docs.html` memakai kelas prose yang sudah ada (`toc`, `copybox`, `details`) tanpa lembar CSS baru. Logika tombol salin pindah dari skrip inline `landing/dukungan.html` ke `landing/copy.js` yang dipakai dua halaman, sehingga CSP cukup memuat `script-src 'self'`.

**Tech Stack:** HTML statis, CSS kustom, Node test runner (`node:test`), Cloudflare Pages + Vercel (dua host harus seragam).

**Spec:** `docs/superpowers/specs/2026-11-03-dark-opencode-benchmark-design.md` (sudah ada di `main`) plus keputusan 2026-11-04: aksen tetap hijau `#3ecf8e`, /docs berisi 6 bagian Bahasa Indonesia, implementasi langsung di sesi ini.

## Global Constraints

- `--bg #000000`, `--surface #17181c`, `--surface-2 #23262f`, `--line-strong #353841` (nilai opencode.ai docs).
- `--radius 6px`, `--radius-sm 4px`; `--ease cubic-bezier(.25,.46,.45,.94)`; durasi 150–200ms.
- Aksen satu: `--accent #3ecf8e`; tidak ada warna literal di enam lembar halaman.
- Tidak ada `box-shadow` sebagai pemisah permukaan; pemisah `--line`.
- Semua gerak mati dengan rapi di `prefers-reduced-motion`; tidak ada keyframe berulang kecuali kursor demo.
- Bahasa pertama Indonesia; /docs memakai catatan bahasa yang sama seperti `harga.html`.
- Angka di situs harus dibaca dari kode: 34 tool MCP, 31 primitive, 6 izin.
- Facts of money: prabayar, harga tetap disetujui sebelum mulai, gagal = refund penuh, tahan 30 menit = refund otomatis, top-up QRIS mulai Rp10.000, saldo tidak kedaluwarsa.
- Dua host harus sama: `landing/_headers` dan `landing/vercel.json`.
- Gerbang: `npm test`, `npm run check`, `node scripts/format-comments.mjs`.

## Review Focus

- Pengunjung di `/docs` pada 320px: tidak ada luapan horizontal, setiap blok kode bisa disalin.
- Pembaca yang datang dari nav di halaman mana pun: `/docs` bisa dicapai, dan CSP halaman itu masih menyalin hash skripnya sendiri.
- Klaim "gratis" yang tersisa di mana pun setelah dompet prabayar: setiap kemunculan harus benar atau dihapus.
- Dua host: satu path baru tanpa rule = policy hilang di salah satu host.
- Angka yang didokumentasikan berubah (jumlah tool): /docs mengulang angka, jadi harus dihitung dari sumber, bukan diketik.

---

### Task 1: Token, tipografi mono-first, dan gerak opencode

**Files:**
- Modify: `landing/site.css` (blok `:root`, aturan heading, `--ease`)
- Modify: `landing/beranda.css` (ukuran h1/h2 yang mengikuti token, bukan literal)
- Test: `tests/landing-visual.test.mjs`

**Interfaces:**
- Consumes: token lama (`--bg`, `--surface`, `--surface-2`, `--ink`, `--muted`, `--line`, `--line-strong`, `--accent`, `--radius`, `--radius-sm`, `--ease`).
- Produces: token final yang dipakai Task 2–5; semua variabel token lama tetap ada.

- [ ] **Step 1: Tulis tes gagal**

Tambah ke `tests/landing-visual.test.mjs`:

```js
test('the canvas is opencode black, with its own greys', () => {
  assert.equal(token('--bg'), '#000000', 'the canvas is black, like opencode.ai');
  assert.equal(token('--surface'), '#17181c', 'a panel is opencode gray-1');
  assert.equal(token('--surface-2'), '#23262f', 'a raised panel is opencode gray-2');
});

test('the accent is the only saturated colour, and the greys may breathe blue', () => {
  // WHY THE SPAN MOVED FROM 3 TO 12: opencode's greys are blue-tinted neutrals (#23262f spans 12).
  // The claim being kept is the one that matters: no surface competes with the accent.
  for (const name of ['--bg', '--surface', '--surface-2', '--ink', '--muted']) {
    const [r, g, b] = token(name).replace('#', '').match(/../g).map((x) => parseInt(x, 16));
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 12, `${name} stays a near-neutral grey`);
  }
  const [r, g, b] = token('--accent').replace('#', '').match(/../g).map((x) => parseInt(x, 16));
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) > 100, 'the accent is the only saturated colour');
});

test('the controls carry opencode radii and opencode motion', () => {
  const sheet = read('site.css');
  assert.match(sheet, /--radius:\s*6px/, 'a card is 6px, like opencode');
  assert.match(sheet, /--radius-sm:\s*4px/, 'a control is 4px');
  assert.match(sheet, /--ease:\s*cubic-bezier\(\.25, \.46, \.45, \.94\)/, 'the easing is opencode own');
});

test('the display type is mono, like opencode headings', () => {
  const sheet = read('site.css');
  assert.match(sheet, /h1,\s*\n?h2 \{[^}]*font-family:\s*var\(--mono\)/s, 'h1 and h2 speak in mono');
});
```

- [ ] **Step 2: Jalankan tes, lihat gagal**

Run: `node --test tests/landing-visual.test.mjs`
Expected: FAIL pada empat tes baru (token lama `#0a0a0a`, radius `8px`, ease lama, heading sans).

- [ ] **Step 3: Implementasi minimum**

Di `landing/site.css`, blok `:root`:

```css
  --bg: #000000;
  --surface: #17181c;
  --surface-2: #23262f;
  --ink: #ededed;
  --muted: #a1a1a1;
  --line: #23262f;
  --line-strong: #353841;
  --radius: 6px;
  --radius-sm: 4px;
  --ease: cubic-bezier(.25, .46, .45, .94);
```

Perhatikan: `--line` berubah dari rgba ke hex, jadi test `token('--line')` tidak ada — hanya `--bg`, `--surface`, `--surface-2`, `--ink`, `--muted`, `--accent` yang dibaca helper `token()`, dan semuanya tetap hex.

Tambahkan mono ke heading:

```css
h1,
h2 {
  font-family: var(--mono);
  letter-spacing: -.04em;
}
```

`h3` tetap Instrument Sans (subjudul pendek, sans lebih terbaca).

Kontras di kanvas baru: `--ink #ededed` di `#000000` = 18.4:1; `--muted #a1a1a1` = 8.0:1; `--accent #3ecf8e` = 12.6:1. Semua lolos.

- [ ] **Step 4: Jalankan tes, lihat hijau**

Run: `node --test tests/landing-visual.test.mjs`
Expected: PASS (tes lain di file yang sama tetap hijau).

- [ ] **Step 5: Commit**

```bash
git add landing/site.css landing/beranda.css tests/landing-visual.test.mjs
git commit -m "style: borrow opencode black, greys, mono headings and easing"
```

---

### Task 2: Diet teks dan klaim uang yang jujur

**Files:**
- Modify: `landing/beranda.html`, `landing/fitur.html`, `landing/unduh.html`, `landing/dukungan.html`
- Test: `tests/landing-claims.test.mjs`, `tests/landing-visual.test.mjs`

**Interfaces:**
- Consumes: kunci i18n `hero.note`, `faq.cost.dd`, `final.title`, `final.sub`, `page.value` per halaman.
- Produces: satu kalimat uang yang sama di mana-mana; blok config MCP pindah ke Task 3.

- [ ] **Step 1: Tulis tes gagal**

Tambah ke `tests/landing-claims.test.mjs`:

```js
test('no page calls the product free while jobs are prepaid', () => {
  assert.doesNotMatch(site, /Gratis dipakai/i, 'a prepaid job is not free');
  assert.doesNotMatch(site, /Opera Agent gratis/i, 'the extension is free to install; the job is not free');
  assert.match(site, /harga tetap/i, 'and the site says what the job costs');
});

test('the money facts live on one page', () => {
  const pricePages = sitePages.filter((page) => /Rp10\.000/.test(page));
  assert.deepEqual(pricePages, ['landing/harga.html'], 'only the price page names the smallest top-up');
});
```

`sitePages` dibangun dari array `site` yang sudah ada: ubah `const site = [...]` menjadi `const sitePages = [...].map(read); const site = sitePages.join('\n');`.

Di `tests/landing-visual.test.mjs`, ganti pin kaki hero:

```js
test('the hero carries its footnote instead of hiding the catch', () => {
  const html = read('beranda.html');
  assert.match(html, /class="footnote"/, 'the line has an element');
  assert.match(html, /Biaya model dibayar ke penyedia Anda/, 'stating the money that moves');
});
```

- [ ] **Step 2: Jalankan tes, lihat gagal**

Run: `node --test tests/landing-claims.test.mjs tests/landing-visual.test.mjs`
Expected: FAIL — "Gratis dipakai" masih ada di beranda, fitur, dan unduh.

- [ ] **Step 3: Implementasi minimum (teks)**

`landing/beranda.html`:
- kaki hero → `Harga tetap per pekerjaan selesai. Biaya model dibayar ke penyedia Anda.`
- band akhir → judul `Pasang. Pair. Kerja.` sub `Satu extension, satu akun, satu browser.`
- FAQ biaya → `Extension gratis dipasang. Setiap pekerjaan dibayar dari saldo; biaya model ke penyedia Anda.`
- kartu privasi 4 → 2 (Kunci API, Konten); sisanya pindah ke `privasi.html`.
- blok config MCP tidak ada di beranda; tidak ada perubahan lain.

`landing/fitur.html`:
- band akhir → sub `Harga tetap per pekerjaan selesai.` + tautan ke `./harga`.
- baris "Enam izin, dijelaskan satu per satu" → satu kalimat + tautan `./unduh.html`.
- "Enam izin. Tidak ada yang tersembunyi." hilang dari fitur (tetap ada di unduh).

`landing/unduh.html`:
- `page.value` → `Tanpa toko: satu arsip .zip untuk semua browser Chromium; mesin enterprise dapat memakai CRX bertanda tangan.`
- tambahkan satu baris: `Memasang tidak dipungut biaya. Setiap pekerjaan dibayar dari saldo prabayar.`

`landing/dukungan.html`:
- blok MCP (OpenCode, Kilo, Claude) dipindah ke `/docs`; dukungan menyimpan satu kalimat: `Cara menghubungkan AI harness ada di halaman Docs.` + tautan.

- [ ] **Step 4: Jalankan tes, lihat hijau**

Run: `node --test tests/landing-claims.test.mjs tests/landing-visual.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add landing/beranda.html landing/fitur.html landing/unduh.html landing/dukungan.html tests/landing-claims.test.mjs tests/landing-visual.test.mjs
git commit -m "docs: tell the money once, and cut the text that repeated it"
```

---

### Task 3: Halaman /docs

**Files:**
- Create: `landing/docs.html`
- Modify: `landing/dukungan.html` (blok config MCP pindah ke /docs; skrip inline tombol salin ikut dibuang)
- Test: `tests/landing-docs.test.mjs` (baru)

**Interfaces:**
- Consumes: `landing/site.css` (`.toc`, `.prose`, `.copybox`, `details`), `landing/i18n.js` (kunci nav bila perlu).
- Produces: `landing/docs.html` dengan enam seksi ber-id `pasang`, `pairing`, `tugas`, `saldo`, `mcp`, `batas`; satu skrip inline tombol salin, yang hash-nya ditulis di Task 4.

- [ ] **Step 1: Tulis tes gagal**

`tests/landing-docs.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mcpSurfaceSourceSync } from './helpers/mcp-surface-source.mjs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

test('the docs page carries six sections and one map', () => {
  const html = read('landing/docs.html');
  for (const id of ['pasang', 'pairing', 'tugas', 'saldo', 'mcp', 'batas']) {
    assert.match(html, new RegExp(`<h2 id="${id}"`), `${id} has a section`);
    assert.ok(html.includes(`href="#${id}"`), `${id} is reachable from the map`);
  }
  assert.match(html, /<ul class="toc"/, 'the map is a list');
});

test('the docs page states the counts the code proves', () => {
  const html = read('landing/docs.html');
  const mcp = mcpSurfaceSourceSync();
  const tools = (mcp.match(/registerTool\("/g) || []).length;
  assert.match(html, new RegExp(`\\b${tools} tool`), `the page states ${tools} tools`);
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.permissions.length, 6);
  assert.match(html, /enam izin/i, 'the page states six permissions');
});

test('the docs page states the money the wallet enforces', () => {
  const html = read('landing/docs.html');
  const wallet = read('supabase/functions/_shared/wallet.js');
  assert.match(wallet, /ACTION_CAP = 10/, 'the code caps a job at ten actions');
  assert.match(html, /10 aksi/, 'and the page says so');
  assert.match(wallet, /HOLD_MS = 30 \* 60 \* 1000/, 'the hold lasts thirty minutes');
  assert.match(html, /30 menit/, 'and the page says so');
  assert.match(html, /dikembalikan penuh|dikembalikan utuh/, 'a failed job is refunded in full');
});

test('the docs page links to the doors a reader needs', () => {
  const html = read('landing/docs.html');
  for (const href of ['./unduh.html', './dashboard.html', './harga', './dukungan.html']) {
    assert.ok(html.includes(`href="${href}"`), `the page reaches ${href}`);
  }
});
```

- [ ] **Step 2: Jalankan tes, lihat gagal**

Run: `node --test tests/landing-docs.test.mjs`
Expected: FAIL — `landing/docs.html` belum ada (ENOENT).

- [ ] **Step 3: Implementasi minimum**

`landing/docs.html`: satu halaman prose, `lang="id"`, isi enam seksi seperti disetujui (pasang, pairing, tugas, saldo, MCP dengan blok config OpenCode/Kilo/Claude, batas), setiap blok kode punya `id` dan `data-copy` tombol, dan satu skrip inline yang menyalin isi elemen `data-copy` (kode yang sama dengan skrip yang hari ini hidup di `landing/dukungan.html`).

`landing/dukungan.html`: blok config MCP (OpenCode, Kilo, Claude) dan tombol salinnya dipindah ke `/docs`; dukungan menyimpan satu kalimat: `Cara menghubungkan AI harness ada di halaman Docs.` + tautan. Skrip inline tombol salin ikut dibuang, karena tidak ada tombol salin yang tersisa di halaman itu.

- [ ] **Step 4: Jalankan tes, lihat hijau**

Run: `node --test tests/landing-docs.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add landing/docs.html landing/dukungan.html tests/landing-docs.test.mjs
git commit -m "feat: add the docs page, and move the MCP setup where it belongs"
```

---

### Task 4: Pintu, peta situs, dan dua host

**Files:**
- Modify: `landing/beranda.html`, `landing/fitur.html`, `landing/unduh.html`, `landing/unduh-berkas.html`, `landing/dukungan.html`, `landing/harga.html`, `landing/privasi.html`, `landing/syarat.html`, `landing/404.html`
- Modify: `landing/sitemap.xml`, `landing/_headers`, `landing/vercel.json`, `scripts/landingserve.mjs`
- Test: `tests/landing-hosting.test.mjs`, `tests/landing-company.test.mjs`, `tests/landing-consent.test.mjs`, `tests/landing-docs.test.mjs`

**Interfaces:**
- Consumes: `landing/docs.html` dari Task 3.
- Produces: `/docs` dan `/docs.html` punya rule sendiri di kedua host; sitemap menyebut `/docs`.

- [ ] **Step 1: Tulis tes gagal**

Tambah ke `tests/landing-docs.test.mjs`:

```js
test('the docs page is reachable from every public door', () => {
  for (const page of ['beranda.html', 'fitur.html', 'unduh.html', 'dukungan.html', 'harga.html']) {
    assert.match(read(`landing/${page}`), /href="\.\/docs\.html"/, `${page} carries the docs door`);
  }
});

test('both hosts cover the docs page with one policy each', () => {
  const headers = read('landing/_headers');
  const vercel = JSON.parse(read('landing/vercel.json'));
  for (const path of ['/docs', '/docs.html']) {
    assert.ok(headers.includes(`\n${path}\n`), `_headers covers ${path}`);
    assert.ok(vercel.headers.some((h) => h.source === path), `vercel.json covers ${path}`);
  }
  assert.match(read('landing/sitemap.xml'), /opera-agent\.pages\.dev\/docs</, 'the map names the docs page');
});
```

- [ ] **Step 2: Jalankan tes, lihat gagal**

Run: `node --test tests/landing-docs.test.mjs`
Expected: FAIL — belum ada pintu `/docs`, rule host, atau entri sitemap.

- [ ] **Step 3: Implementasi minimum**

- Tambah `<a href="./docs.html">Docs</a>` di nav sembilan halaman publik (tanpa `data-i18n`: "Docs" valid di dua bahasa).
- `landing/sitemap.xml`: tambah `<url><loc>https://opera-agent.pages.dev/docs</loc></url>`.
- `landing/_headers` dan `landing/vercel.json`: rule untuk `/docs` dan `/docs.html` dengan CSP yang meniru halaman statis lain (`default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self' 'sha256-<hash skrip inline docs.html>'; connect-src 'none'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'`). Hash dihitung dari isi skrip: `node -e "const {createHash}=require('node:crypto');const fs=require('node:fs');const html=fs.readFileSync('landing/docs.html','utf8');for(const m of html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g))console.log('sha256-'+createHash('sha256').update(m[1],'utf8').digest('base64'))"`.
- `scripts/landingserve.mjs`: tambahkan `docs.html` ke `FILES`.
- Hapus hash skrip inline `dukungan.html` dari kedua host (skrip inline sudah dibuang bersama tombol salinnya), dan tambahkan `script-src 'self'` bila belum ada.

- [ ] **Step 4: Jalankan tes, lihat hijau**

Run: `node --test tests/landing-docs.test.mjs tests/landing-hosting.test.mjs tests/landing-company.test.mjs tests/landing-consent.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add landing tests scripts/landingserve.mjs
git commit -m "feat: open the docs door on every public page and both hosts"
```

---

### Task 5: Gerbang dan pemeriksaan visual

**Files:**
- Modify: apa pun yang gagal (tanpa perluasanCss baru).

- [ ] **Step 1: Jalankan seluruh gerbang**

Run: `npm test` → semua hijau.
Run: `npm run check` → ok.
Run: `node scripts/format-comments.mjs` → tidak mengubah apa pun.

- [ ] **Step 2: Periksa halaman di browser**

Buka `http://127.0.0.1:4173/docs.html` dari dev server lokal pada 1440px dan 390px: satu kolom, peta di kiri ≥900px, blok kode tidak meluber, tombol salin berfungsi, tidak ada scroll horizontal.

- [ ] **Step 3: Perbaiki yang terlihat, lalu ulangi gerbang**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: answer what the browser showed"
```

---

### Task 6: Kirim ke produksi

**Files:**
- Create: PR ke `main`.

- [ ] **Step 1: Buka PR**

```bash
gh pr create --base main --title "Borrow opencode's black, mono and motion, cut the repeated text, and add /docs" --body "..."
```

- [ ] **Step 2: Gabung**

```bash
gh pr merge <n> --squash --delete-branch
```

- [ ] **Step 3: Deploy situs**

```bash
gh workflow run deploy-site.yml --ref main
```

- [ ] **Step 4: Buktikan live**

Buka `https://opera-agent.pages.dev/docs` di browser: halaman ada, CSP berlaku, `/docs` ada di sitemap yang di-fetch.
