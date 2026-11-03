# Situs gelap benchmark opencode — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memindahkan 12 halaman `landing/` ke satu kanvas gelap dengan token terukur, mengikuti pola opencode.ai, tanpa mengubah isi, angka, nav, atau klaim.

**Architecture:** `landing/site.css` memegang seluruh token dan komponen bersama. Enam lembar halaman hanya menyimpan komposisi dan wajib memakai `var(--…)`, nol literal warna. `app.css` kehilangan blok `body.app-dark` karena tidak ada lagi kanvas terang untuk dibedakan. Tes visual ditulis ulang agar mengunci kontras dan aksen, bukan nama warna.

**Tech Stack:** CSS murni (tanpa preprocessor), Node test runner (`node:test`), formatter komentar `scripts/format-comments.mjs`, gate browser Python.

**Spec:** `docs/superpowers/specs/2026-11-03-dark-opencode-benchmark-design.md`

## Global Constraints

- Token persis dari spec: `--bg: #0a0a0a`, `--surface: #141414`, `--surface-2: #1c1c1c`, `--ink: #ededed`, `--muted: #a1a1a1`, `--line: rgba(255,255,255,.12)`, `--line-strong: rgba(255,255,255,.22)`, `--accent: #3ecf8e`, `--accent-strong: #5fe0a5`, `--accent-soft: rgba(62,207,142,.12)`, `--danger: #ff6b6b`, `--warn: #f6c969`, `--radius: 8px`, `--radius-sm: 6px`.
- Kontras terukur: `--ink`/`--bg` ≥ 7, `--muted`/`--bg` ≥ 4.5, `--accent`/`--bg` ≥ 4.5.
- Token yang dihapus: `--paper`, `--surface-strong`, `--ink-panel`, `--panel-text`, `--shadow`, `--shadow-lift`, `--pill`, `--lime`, `--text`, `--bg` sebagai alias. `--surface-soft` dan `--brand` tetap sebagai alias ke `--surface-2` dan `--accent`, karena keduanya dibaca 38 aturan di enam lembar dan mengganti namanya tidak mengubah satu piksel.
- Nol literal `#rrggbb` atau `rgba(` di `beranda.css`, `auth.css`, `app.css`, `dashboard.css`, `download.css`, `features.css`. Satu pengecualian: `dashboard.css` boleh memakai `var(--on-fill, …)` dengan fallback.
- Tidak ada `box-shadow` untuk memisahkan permukaan; pemisah adalah `1px solid var(--line)`.
- Tidak ada perubahan teks Indonesia, kunci `data-i18n`, nav, footer, `landing/_worker.js`, `_headers`, `vercel.json`, `extension/`, `supabase/`.
- Setiap tugas diakhiri `npm test` hijau dan commit.
- Formatter komentar: `node scripts/format-comments.mjs` harus melaporkan 443 file ok sebelum commit.

## Review Focus

1. **Halaman yang memuat dua lembar CSS** — `dashboard.html` memuat `site.css` + `app.css` + `dashboard.css`; token yang dihapus dari `site.css` tetapi masih dibaca `dashboard.css` akan jatuh ke nilai kosong dan membuat teks tak terlihat. Harapan: setiap token yang dihapus sudah tidak dibaca siapa pun.
2. **Tombol terisi di atas kanvas gelap** — latar `--ink` (`#ededed`) dengan teks `--bg` (`#0a0a0a`) = 16.9:1. Harapan: tidak ada yang mewarisi `color: #fff` dari aturan lama, yang akan menjadi 1.17:1.
3. **`prefers-color-scheme: light`** — pengguna dengan mode terang di OS tetap harus melihat situs gelap, karena tidak ada stylesheet terang lagi. Harapan: tidak ada `@media (prefers-color-scheme: light)` yang membalik token.
4. **`<details>` accordion tanpa JavaScript** — FAQ dan dukungan harus terbuka dengan keyboard dan pembaca layar. Harapan: `<summary>` adalah elemen pertama di dalam `<details>`, dan `data-i18n` ada di `<summary>`, bukan di `<div>`.
5. **Halaman yang mencetak** — `@media print` memasang latar putih dan teks hitam. Harapan: aturan cetak tetap menang atas token gelap, dan `.reveal` tetap `opacity: 1`.

---

### Task 1: Token gelap dan reset di `site.css`

**Files:**
- Modify: `landing/site.css:21-55` (blok `:root`)
- Modify: `landing/site.css:71-119` (body, `::selection`, aturan `body:has`)
- Test: `tests/landing-visual.test.mjs` (tes baru ditambahkan di Task 13; tugas ini diverifikasi dengan `npm test` yang sudah ada)

**Interfaces:**
- Produces: token `--bg`, `--surface`, `--surface-2`, `--ink`, `--muted`, `--line`, `--line-strong`, `--accent`, `--accent-strong`, `--accent-soft`, `--danger`, `--warn`, `--radius`, `--radius-sm`, `--wrap`, `--prose`, `--font`, `--mono`, `--ease`, `--on-fill`.

- [ ] **Step 1: Ganti blok `:root`**

Ganti seluruh isi `:root` di `landing/site.css` (baris 23–55) dengan:

```css
:root {
  --bg: #0a0a0a;
  --surface: #141414;
  --surface-2: #1c1c1c;
  --ink: #ededed;
  --muted: #a1a1a1;
  --line: rgba(255, 255, 255, .12);
  --line-strong: rgba(255, 255, 255, .22);
  --accent: #3ecf8e;
  --accent-strong: #5fe0a5;
  --accent-soft: rgba(62, 207, 142, .12);
  --danger: #ff6b6b;
  --warn: #f6c969;
  --danger-line: rgba(255, 107, 107, .28);
  --on-fill: #0a0a0a;
  --focus: #3ecf8e;
  --radius: 8px;
  --radius-sm: 6px;
  --ease: cubic-bezier(.22, .61, .24, 1);
  --font: "Instrument Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --wrap: 1160px;
  --prose: 680px;
  --surface-soft: var(--surface-2);
  --brand: var(--accent);
}
```

Dua baris terakhir adalah alias, bukan token baru: `--surface-soft` dibaca 31 aturan dan `--brand` 7 aturan di enam lembar, dan memindahkan semuanya ke nama baru tidak mengubah satu piksel. Alias membuat satu sumber tetap satu, dan nama lama hilang bersama pemakai terakhirnya.

- [ ] **Step 2: Ganti latar body dan pilih teks**

Ganti `background: var(--paper);` di blok `body` dengan `background: var(--bg);` dan tambahkan `color-scheme: dark;` di dalam `body` supaya kontrol bawaan browser (scrollbar, `<select>`) ikut gelap.

- [ ] **Step 3: Ganti `::selection`**

```css
::selection { background: var(--accent); color: var(--on-fill); }
```

- [ ] **Step 4: Hapus 18 baris `body:has(...)`**

Hapus seluruh blok mulai dari `body:has(main.console),` sampai baris `body:has(main.account) header .lang .on { color: #fff; }` (baris 97–117 di file sekarang). Aturan header gelap itu naik menjadi aturan dasar dan ditulis ulang di Task 2.

- [ ] **Step 5: Jalankan tes untuk melihat apa yang pecah**

Run: `npm test`
Expected: FAIL pada `landing-dashboard` (`--paper` tidak lagi didefinisikan) dan `landing-company` (`theme-color` masih `#f7f5ef`). Ini diharapkan; Task 2–3 menutupnya.

- [ ] **Step 6: Commit**

```bash
git add landing/site.css
git commit -m "Paint the site on one dark canvas, and drop the paper tokens"
```

Catatan: `--pill` dihapus di Task 2 Step 10, bukan di sini, karena `.navCta` dan `.chip` masih membacanya sampai Step 4 dan Step 7 tugas itu selesai.

---

### Task 2: Chrome, kontrol, dan komponen `site.css`

**Files:**
- Modify: `landing/site.css:127-230` (tautan, code, pre, hr)
- Modify: `landing/site.css:316-481` (header, footer)
- Modify: `landing/site.css:483-660` (btn, card, tile, grid, chip, dot)
- Modify: `landing/site.css:834-848` (`.panelDark` → `.panelLight`)

**Interfaces:**
- Consumes: token dari Task 1.
- Produces: `.btn`, `.btn.primary`, `.card`, `.tile`, `.chip`, `.panelLight` yang membaca token gelap; `header` dan `footer` tanpa aturan `body:has`.

- [ ] **Step 1: Ganti aturan tautan**

```css
a {
  color: var(--accent);
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
}

a:hover { color: var(--accent-strong); }
```

- [ ] **Step 2: Ganti `code`, `pre`, `hr`**

```css
code,
kbd,
samp {
  font-family: var(--mono);
  font-size: .86em;
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--ink);
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  overflow-wrap: anywhere;
}

pre {
  margin: 0 0 18px;
  padding: 16px 18px;
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--ink);
  font: 13px/1.7 var(--mono);
}

hr {
  height: 1px;
  margin: 36px 0;
  border: 0;
  background: var(--line);
}
```

- [ ] **Step 3: Ganti header**

```css
header {
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: 1px solid var(--line);
  background: rgba(10, 10, 10, .86);
  -webkit-backdrop-filter: saturate(180%) blur(18px);
  backdrop-filter: saturate(180%) blur(18px);
}
```

Dan di dalam `header nav a:not(.brand):not(.navCta)` ganti `color: var(--muted);` tetap, tetapi `header nav a:not(.brand):not(.navCta):hover` dan `[aria-current="page"]` memakai `color: var(--ink);`. Hapus aturan `@media (max-width: 980px) { header nav a.nav-sec { display: none; } }` — kelas `nav-sec` sudah tidak dipakai di 12 halaman.

- [ ] **Step 4: Ganti aksi terisi di nav**

```css
header nav .navCta,
header nav .navCta[aria-current="page"] { color: var(--on-fill); }

header nav .navCta {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 17px;
  border: 1px solid var(--ink);
  border-radius: var(--radius-sm);
  background: var(--ink);
  color: var(--on-fill);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition: background .2s var(--ease), border-color .2s var(--ease);
}

header nav .navCta:hover {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-fill);
}
```

- [ ] **Step 5: Ganti footer**

```css
footer {
  border-top: 1px solid var(--line);
  background: var(--surface);
  padding: 54px 0 max(36px, calc(36px + env(safe-area-inset-bottom)));
  color: var(--muted);
  font-size: 13.5px;
}
```

Ganti setiap `rgba(239, 242, 236, …)` di dalam blok footer dengan `var(--muted)` atau `var(--ink)` sesuai peran, dan `footer .doors a:hover { color: #fff; }` menjadi `{ color: var(--ink); }`.

- [ ] **Step 6: Ganti `.btn`**

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 22px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1;
  text-align: center;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: background .2s var(--ease), border-color .2s var(--ease), color .2s var(--ease);
}

.btn:hover {
  border-color: var(--ink);
  color: var(--ink);
}

.btn.primary {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--on-fill);
}

.btn.primary:hover {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-fill);
}

.btn.danger {
  border-color: rgba(255, 107, 107, .32);
  background: transparent;
  color: var(--danger);
}

.btn.danger:hover {
  border-color: var(--danger);
  background: var(--danger);
  color: var(--on-fill);
}
```

- [ ] **Step 7: Ganti `.card`, `.tile`, `.chip`**

```css
.card {
  padding: 28px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.tile {
  display: block;
  padding: 22px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: inherit;
  text-decoration: none;
  transition: border-color .2s var(--ease);
}

.tile:hover {
  border-color: var(--line-strong);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .01em;
  white-space: nowrap;
}

.chip.good {
  border-color: rgba(62, 207, 142, .24);
  background: var(--accent-soft);
  color: var(--accent);
}

.chip.warn {
  border-color: rgba(246, 201, 105, .24);
  background: rgba(246, 201, 105, .12);
  color: var(--warn);
}
```

- [ ] **Step 8: Ganti `.panelDark` menjadi `.panelLight`**

```css
.panelLight {
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--ink);
}

.panelLight code {
  border-color: var(--line-strong);
  background: var(--bg);
  color: var(--ink);
}

.panelLight a { color: var(--accent); }
```

Periksa pemakai: `grep -rn "panelDark" landing/` harus kosong. Kalau ada, ganti kelasnya di HTML.

- [ ] **Step 9: Ganti `--ink-panel` dan `--panel-text` di enam lembar**

Token itu dipakai `beranda.css` (baris 109, 110, 421, 422, 556, 557), `features.css` (102, 103, 192, 193), dan `site.css`. Setiap `background: var(--ink-panel)` → `background: var(--surface)`, setiap `color: var(--panel-text)` → `color: var(--ink)`. Setelah itu hapus definisinya dari `:root`.

- [ ] **Step 10: Hapus `--pill`**

Dipakai tiga tempat: `site.css:399` (`.navCta`), `site.css:626` (`.chip`), `beranda.css:166`. Task 2 Step 4 dan Step 7 sudah menggantinya dengan `var(--radius-sm)`; `beranda.css:166` diganti di Task 4. Setelah ketiganya, hapus `--pill` dari `:root`.

- [ ] **Step 11: Ganti input dan select**

```css
input,
select,
textarea {
  width: 100%;
  min-height: 46px;
  margin: 0 0 16px;
  padding: 11px 14px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: 15px;
  transition: border-color .2s var(--ease), box-shadow .2s var(--ease);
}

input::placeholder,
textarea::placeholder { color: #6f6f6f; }

input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
```

- [ ] **Step 10: Jalankan tes**

Run: `npm test`
Expected: FAIL tersisa hanya pada `landing-dashboard` dan `landing-company` yang menyebut `theme-color` dan `--paper`.

- [ ] **Step 11: Commit**

```bash
git add landing/site.css
git commit -m "Answer every control in the dark canvas, and light the exception panel"
```

---

### Task 3: `theme-color` dan peleburan `app-dark`

**Files:**
- Modify: 11 file `landing/*.html` dan `landing/oauth/consent.html` (baris `<meta name="theme-color">`)
- Modify: `landing/app.css:10-108` (hapus blok `body.app-dark`)
- Modify: `landing/akun.html`, `landing/dashboard.html` (`<body class="app-dark">` → `<body>`)
- Test: `tests/landing-company.test.mjs:67`, `tests/landing-dashboard.test.mjs:747-801`

**Interfaces:**
- Consumes: token dari Task 1–2.
- Produces: 12 halaman dengan `theme-color` `#0a0a0a`; `app.css` tanpa blok `body.app-dark`; `<body>` tanpa kelas.

- [ ] **Step 1: Ganti `theme-color` di 12 halaman**

```bash
node -e "const fs=require('fs');for(const f of ['404.html','akun.html','beranda.html','dashboard.html','dukungan.html','fitur.html','index.html','privasi.html','syarat.html','unduh-berkas.html','unduh.html','oauth/consent.html']){const p='landing/'+f;const t=fs.readFileSync(p,'utf8').replace('<meta name=\"theme-color\" content=\"#f7f5ef\" />','<meta name=\"theme-color\" content=\"#0a0a0a\" />');fs.writeFileSync(p,t)}"
```

- [ ] **Step 2: Hapus kelas `app-dark` dari dua halaman**

```bash
node -e "const fs=require('fs');for(const f of ['landing/akun.html','landing/dashboard.html']){const t=fs.readFileSync(f,'utf8').replace('<body class=\"app-dark\">','<body>');fs.writeFileSync(f,t)}"
```

- [ ] **Step 3: Hapus blok `body.app-dark` dari `app.css`**

Hapus baris 10–108 di `landing/app.css` — seluruh komentar penjelas, blok token `body.app-dark { … }`, dan semua aturan `body.app-dark …`. Yang tersisa di `app.css` hanya `.appHead`, `.accountGrid`, `.accountAside`, `.accountMain`, `.profileCard`, `.profile`, `.avatar`, `.identity`, `.profileFoot`, `.accountNav`, `.appCard`, dan media query-nya.

- [ ] **Step 4: Ganti `--on-fill` fallback yang sudah tidak perlu**

Di `app.css:182` dan `dashboard.css` (baris 265, 466, 568, 835), `var(--on-fill, #fff)` menjadi `var(--on-fill)` karena tokennya sekarang selalu ada.

- [ ] **Step 5: Jalankan tes untuk melihat klaim lama yang pecah**

Run: `npm test`
Expected: FAIL pada `landing-dashboard` — tes "the console declares its own dark scale" dan "the shell is squared to the benchmark" membaca `body.app-dark` yang sudah tidak ada. Ini ditutup di Task 14.

- [ ] **Step 6: Commit**

```bash
git add landing/app.css landing/akun.html landing/dashboard.html landing/*.html landing/oauth/consent.html
git commit -m "One canvas for every page, so the console stops re-pointing tokens"
```

---

### Task 4: Literal `beranda.css` menjadi token

**Files:**
- Modify: `landing/beranda.css:105-261` (panel demo)
- Modify: `landing/beranda.css:427-458` (kartu model)
- Modify: `landing/beranda.css:564-570` (FAQ)

**Interfaces:**
- Consumes: token Task 1–2.
- Produces: `beranda.css` dengan nol literal `#rrggbb` dan nol `rgba(`.

- [ ] **Step 1: Ganti panel demo**

Setiap `rgba(255, 255, 255, 0.08)` → `var(--line)`.
Setiap `rgba(255, 255, 255, 0.035)` → `var(--surface-2)`.
`background: #ff8a7a` → `var(--danger)`.
`background: #f6c969` → `var(--warn)`.
`background: rgba(0, 0, 0, 0.18)` → `var(--bg)`.
`color: rgba(239, 242, 236, 0.56)` → `var(--muted)`.
`color: rgba(239, 242, 236, 0.6)` → `var(--muted)`.
`color: rgba(239, 242, 236, 0.72)` → `var(--ink)`.
`color: rgba(239, 242, 236, 0.55)` → `var(--muted)`.
`color: rgba(239, 242, 236, 0.4)` → `var(--muted)`.
`color: rgba(239, 242, 236, 0.62)` → `var(--muted)`.
`color: rgba(239, 242, 236, 0.42)` → `var(--muted)`.
`color: rgba(239, 242, 236, 0.8)` → `var(--ink)`.
`color: #fff` → `var(--ink)`.
`border-color: rgba(255, 255, 255, 0.1)` → `var(--line)`.
`background: rgba(255, 255, 255, 0.06)` → `var(--surface-2)`.
`background: rgba(62, 207, 142, 0.1)` → `var(--accent-soft)`.
`color: #a9edd0` → `var(--accent)`.
`color: #cfe9dd` → `var(--ink)`.
`color: #9fe6c8` → `var(--accent)`.
`color: #f0b394` → `var(--danger)`.
`color: #b9f0d8` → `var(--accent)`.
`border-top: 1px solid rgba(255, 255, 255, 0.07)` → `1px solid var(--line)`.
`box-shadow: 0 0 0 3px rgba(62, 207, 142, 0.14)` → `0 0 0 3px var(--accent-soft)`.
`box-shadow: var(--shadow-lift)` → hapus (tidak ada bayangan).

- [ ] **Step 2: Ganti `--ink-panel` dan `--panel-text`**

Di `beranda.css`, `.demo { background: var(--ink-panel); color: var(--panel-text); }` menjadi `{ background: var(--surface); color: var(--ink); }`.

- [ ] **Step 3: Verifikasi nol literal**

Run: `node -e "const t=require('fs').readFileSync('landing/beranda.css','utf8');const m=t.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)||[];console.log(m.length, m.slice(0,10))"`
Expected: `0 []`

- [ ] **Step 4: Commit**

```bash
git add landing/beranda.css
git commit -m "Let the home sheet read every colour from the canvas it sits on"
```

---

### Task 5: Literal `features.css`, `download.css`, `auth.css` menjadi token

**Files:**
- Modify: `landing/features.css:104-206`
- Modify: `landing/download.css:53,76,198,362,366,436`
- Modify: `landing/auth.css:75,88,144`

**Interfaces:**
- Consumes: token Task 1–2.
- Produces: tiga lembar dengan nol literal.

- [ ] **Step 1: `features.css`**

`border-color: rgba(255, 255, 255, .08)` → `var(--line)`.
`border-color: rgba(255, 255, 255, .12)` → `var(--line-strong)`.
`background: rgba(255, 255, 255, .06)` → `var(--surface-2)`.
`color: #9fe6c8` → `var(--accent)`.
`color: #fff` → `var(--ink)`.
`color: rgba(239, 242, 236, .62)` → `var(--muted)`.
Hapus setiap `box-shadow: var(--shadow-lift)`.

- [ ] **Step 2: `download.css`**

Setiap `color: #fff` di dalam `.btn.primary` atau `.btn.primary:hover` → `var(--on-fill)`.
Setiap `color: #fff` pada elemen lain → `var(--ink)`.
`background: var(--accent-strong)` pada `.browser .btn:hover` tetap, tetapi `color: #fff` → `var(--on-fill)`.
Hapus setiap `box-shadow: var(--shadow-lift)`.

- [ ] **Step 3: `auth.css`**

`background: var(--brand)` → `var(--accent)`.
`box-shadow: var(--shadow)` → hapus.
`color: #fff` → `var(--on-fill)` bila latarnya terisi, `var(--ink)` bila tidak.

- [ ] **Step 4: Verifikasi nol literal di tiga lembar**

Run: `node -e "for(const f of ['features','download','auth']){const t=require('fs').readFileSync('landing/'+f+'.css','utf8');const m=t.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)||[];console.log(f, m.length)}"`
Expected: `features 0`, `download 0`, `auth 0`

- [ ] **Step 5: Commit**

```bash
git add landing/features.css landing/download.css landing/auth.css
git commit -m "Take the last hand-picked colours out of the page sheets"
```

---

### Task 6: Literal `dashboard.css` menjadi token

**Files:**
- Modify: `landing/dashboard.css:27-31,265,466,560,568,704,759,835,981`

**Interfaces:**
- Consumes: token Task 1–3.
- Produces: `dashboard.css` dengan nol literal selain fallback `var(--on-fill, …)` yang dihapus.

- [ ] **Step 1: Ganti latar konsol**

`body:has(main.console) { … background: #0c0e11; }` → `background: var(--bg);`

- [ ] **Step 2: Ganti `--on-fill` fallback**

Baris 265, 466, 568, 835: `var(--on-fill, #fff)` → `var(--on-fill)`.

- [ ] **Step 3: Ganti `--lift` dan `--zebra`**

`box-shadow: var(--lift, 0 1px 2px rgba(22, 21, 19, .06))` → hapus (tidak ada bayangan).
`background: var(--zebra, rgba(22, 21, 19, .018))` → `background: var(--surface)` pada baris genap.

- [ ] **Step 5: Ganti `--danger` border**

`border-color: rgba(179, 38, 30, .28)` → `border-color: var(--danger-line)`, memakai token yang ditambahkan di Task 1.

- [ ] **Step 6: Hapus `--zebra` dan `--lift` dari `app.css`**

Di `landing/app.css`, hapus baris `--zebra: rgba(255, 255, 255, .028);` dan `--lift: 0 1px 2px rgba(0, 0, 0, .45);` — keduanya sudah tidak dibaca.

- [ ] **Step 6: Verifikasi**

Run: `node -e "const t=require('fs').readFileSync('landing/dashboard.css','utf8');const m=t.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)||[];console.log(m.length, m)"`
Expected: `0 []`

- [ ] **Step 7: Commit**

```bash
git add landing/dashboard.css landing/app.css
git commit -m "Let the console read the canvas tokens like every other page"
```

---

### Task 6b: `--surface-strong` dan `--lime`

**Files:**
- Modify: `landing/site.css:27,54`

**Interfaces:**
- Consumes: Task 1–6.
- Produces: `:root` tanpa token yang tidak dibaca.

- [ ] **Step 1: Konfirmasi tidak ada pembaca**

Run: `node -e "const fs=require('fs');const d='D:/GitHub/opera-agent/landing/';for(const f of fs.readdirSync(d).filter(x=>x.endsWith('.css'))){const t=fs.readFileSync(d+f,'utf8');for(const tok of ['--surface-strong','--lime']){const n=(t.match(new RegExp('var\\\\('+tok+'\\\\)','g'))||[]).length;if(n)console.log(f,tok,n)}}"`
Expected: tidak ada keluaran.

- [ ] **Step 2: Hapus dua baris dari `:root`**

Hapus `--surface-strong: #e9e6dc;` dan `--lime: var(--brand);`.

- [ ] **Step 3: Commit**

```bash
git add landing/site.css
git commit -m "Drop the two tokens nothing ever read"
```

---

### Task 7: `beranda.html` — hero satu kolom dan FAQ accordion

**Files:**
- Modify: `landing/beranda.html` (hero, FAQ)
- Modify: `landing/beranda.css` (`.heroGrid`)
- Test: `tests/landing-visual.test.mjs:25-48,130-149`

**Interfaces:**
- Consumes: token dan komponen Task 1–4.
- Produces: `.heroGrid` satu kolom; `<dl class="facts faq">` diganti `<div class="faqList">` berisi `<details>`.

- [ ] **Step 1: Satu kolom untuk hero**

Di `landing/beranda.css`, ganti:

```css
.heroGrid {
  display: grid;
  grid-template-columns: minmax(0, 1.02fr) minmax(0, 0.98fr);
  gap: clamp(32px, 5vw, 72px);
  align-items: center;
}
```

menjadi:

```css
.heroGrid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: clamp(32px, 4vw, 56px);
  align-items: start;
  max-width: 900px;
}
```

Dan `.heroCopy h1 { max-width: 15ch; }` menjadi `max-width: 20ch;`.

- [ ] **Step 2: FAQ menjadi accordion**

Ganti blok `<dl class="facts faq">…</dl>` di `landing/beranda.html` dengan:

```html
      <div class="faqList">
        <details>
          <summary data-i18n="faq.cost.dt">Biaya</summary>
          <p data-i18n="faq.cost.dd">Opera Agent gratis. Model ditagih penyedianya.</p>
        </details>
        <details>
          <summary data-i18n="faq.model.dt">Model</summary>
          <p data-i18n="faq.model.dd">Gunakan endpoint cloud atau lokal.</p>
        </details>
        <details>
          <summary data-i18n="faq.data.dt">Data</summary>
          <p data-i18n="faq.data.dd">Konten pergi ke endpoint model Anda.</p>
        </details>
        <details>
          <summary data-i18n="faq.offline.dt">Offline</summary>
          <p data-i18n="faq.offline.dd">Model lokal bisa offline. Relay tetap membutuhkan koneksi.</p>
        </details>
        <details>
          <summary data-i18n="faq.stop.dt">Berhenti</summary>
          <p data-i18n="faq.stop.dd">Keluar atau cabut pairing kapan saja.</p>
        </details>
      </div>
```

Kunci `data-i18n` tidak berubah, jadi kamus Inggris tetap cocok.

- [ ] **Step 3: Tambahkan aturan accordion di `beranda.css`**

```css
.faqList {
  display: grid;
  border-top: 1px solid var(--line);
}

.faqList details {
  border-bottom: 1px solid var(--line);
}

.faqList summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 0;
  color: var(--ink);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}

.faqList summary::-webkit-details-marker { display: none; }

.faqList summary::after {
  content: "+";
  flex: 0 0 auto;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 16px;
}

.faqList details[open] summary::after { content: "−"; }

.faqList details p {
  margin: 0 0 18px;
  max-width: 62ch;
  color: var(--muted);
  font-size: 15px;
}
```

- [ ] **Step 4: Jalankan tes**

Run: `npm test`
Expected: PASS untuk `landing-visual` kecuali tes `theme-color` (sudah beres di Task 3) dan tes radius/pill yang masih mengunci `--pill` (ditutup Task 13).

- [ ] **Step 5: Commit**

```bash
git add landing/beranda.html landing/beranda.css
git commit -m "Let the home page speak in one column, and answer questions in place"
```

---

### Task 8: `fitur.html` — kartu menjadi baris bernomor

**Files:**
- Modify: `landing/fitur.html:56-77`
- Modify: `landing/features.css` (`.featureGrid`, `.featureCard` → `.featureList`, `.featureRow`)

**Interfaces:**
- Consumes: token Task 1–5.
- Produces: `.featureList` berisi `<article class="featureRow">` dengan `<h2>` dan `<p>`; tidak ada `.featureCard`.

- [ ] **Step 1: Ganti markup grid**

Ganti `<section class="featureGrid" aria-label="Kemampuan utama">…</section>` dengan:

```html
    <section class="featureList" aria-label="Kemampuan utama">
      <article class="featureRow">
        <h2 data-i18n="s1.title">34 tool, 31 primitive</h2>
        <p data-i18n="s1.body">Baca halaman, isi formulir, navigasi, dan verifikasi hasil. Google Maps, YouTube, dan Docs adalah contoh awal.</p>
      </article>
      <article class="featureRow">
        <h2 data-i18n="s2.title">Enam izin, dijelaskan satu per satu</h2>
        <p data-i18n="s2.body">Tabs, scripting, storage, alarms, debugger, dan downloads. Setiap izin dijelaskan dan dapat ditolak.</p>
      </article>
      <article class="featureRow">
        <h2 data-i18n="s3.title">Model milik Anda</h2>
        <p data-i18n-html="s3.body">Endpoint dan kunci tetap di browser Anda. Konten halaman hanya pergi ke model yang Anda pilih. <a href="./privasi.html">Privasi</a>.</p>
      </article>
      <article class="featureRow">
        <h2 data-i18n="s4.title">Pairing device</h2>
        <p data-i18n-html="s4.body">Kode sekali pakai mengikat device baru ke akun Anda dalam sepuluh menit. Kelola di <a href="./dashboard.html">Dashboard</a>.</p>
      </article>
      <article class="featureRow">
        <h2 data-i18n="s5.title">Baca halaman tanpa eksploitasi</h2>
        <p data-i18n="s5.body">Password, kode sekali pakai, token, dan kolom pembayaran selalu ditolak.</p>
      </article>
    </section>
```

- [ ] **Step 2: Ganti aturan di `features.css`**

```css
.featureList {
  display: grid;
  border-top: 1px solid var(--line);
}

.featureRow {
  display: grid;
  grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr);
  gap: 24px 48px;
  align-items: start;
  padding: 32px 0;
  border-bottom: 1px solid var(--line);
}

.featureRow h2 {
  margin: 0;
  font-size: 20px;
  letter-spacing: -.025em;
}

.featureRow p {
  margin: 0;
  max-width: 60ch;
  color: var(--muted);
  font-size: 15px;
}

@media (max-width: 760px) {
  .featureRow { grid-template-columns: 1fr; gap: 8px; padding: 24px 0; }
}
```

Hapus `.featureGrid`, `.featureCard`, `.featureCard.wide`, dan media query-nya.

- [ ] **Step 3: Jalankan tes**

Run: `npm test`
Expected: PASS. `landing-i18n` harus tetap hijau karena kunci `data-i18n` tidak berubah.

- [ ] **Step 4: Commit**

```bash
git add landing/fitur.html landing/features.css
git commit -m "Read the features as one numbered column, not as cards"
```

---

### Task 9: `unduh.html` dan `unduh-berkas.html`

**Files:**
- Modify: `landing/unduh.html`
- Modify: `landing/unduh-berkas.html`
- Modify: `landing/download.css`

**Interfaces:**
- Consumes: token Task 1–5.
- Produces: `download.css` tanpa `.shot*` dan `.stat-dot`; tabel berkas memakai `--line` dan mono.

- [ ] **Step 1: Ganti `.shot` dan `.stat` di `download.css`**

Hapus seluruh aturan `.shot`, `.shotBar`, `.shotFile`, `.shotIcon`, `.shotMeta`, `.shotList`, `.shotFoot`, `.stat-dot`, `.stat-label`, `.stat-num`. Panel itu tidak lagi dipakai setelah markup Task ini.

- [ ] **Step 2: Ganti markup `unduh.html`**

Ganti `<div class="hero">…</div>` dengan:

```html
    <section class="downloadHead">
      <h1 data-i18n="page.title">Unduh Opera Agent.</h1>
      <p class="lede" data-i18n="page.sub">Satu arsip, satu langkah, dan browser Anda jadi alat kerja.</p>
      <div class="row">
        <a class="btn primary" href="./unduh-berkas.html" data-i18n="cta.get">Ambil berkas</a>
      </div>
    </section>
```

Pertahankan `dl.facts`, `.chips`, dan blok langkah yang sudah ada, tetapi ganti kelas `.shot` menjadi `.card` dan hapus `.stat` di sekitarnya.

- [ ] **Step 3: Ganti markup `unduh-berkas.html`**

Bungkus daftar berkas dalam tabel:

```html
    <table class="fileTable">
      <thead>
        <tr><th scope="col">Berkas</th><th scope="col">Ukuran</th><th scope="col">SHA-256</th></tr>
      </thead>
      <tbody>
        <!-- satu <tr> per berkas yang sudah ada di halaman ini -->
      </tbody>
    </table>
```

- [ ] **Step 4: Tambahkan aturan tabel**

```css
.fileTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.fileTable th {
  padding: 12px 0;
  border-bottom: 1px solid var(--line-strong);
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .04em;
  text-align: left;
  text-transform: uppercase;
}

.fileTable td {
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
  color: var(--ink);
  vertical-align: top;
}

.fileTable td code {
  background: none;
  border: 0;
  padding: 0;
  color: var(--muted);
  font-size: 12.5px;
  overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .fileTable thead { display: none; }
  .fileTable tr { display: grid; gap: 4px; padding: 14px 0; border-bottom: 1px solid var(--line); }
  .fileTable td { padding: 0; border: 0; }
}
```

- [ ] **Step 5: Jalankan tes**

Run: `npm test`
Expected: PASS. `landing-visual` "the checksum command wraps inside its box" tetap hijau karena `pre { white-space: pre-wrap }` tidak disentuh.

- [ ] **Step 6: Commit**

```bash
git add landing/unduh.html landing/unduh-berkas.html landing/download.css
git commit -m "Let the download pages read as a list of steps and files"
```

---

### Task 10: `dukungan`, `privasi`, `syarat`, `404`

**Files:**
- Modify: `landing/dukungan.html`
- Modify: `landing/privasi.html`
- Modify: `landing/syarat.html`
- Modify: `landing/404.html`
- Modify: `landing/site.css` (`.prose`, `.toc`)

**Interfaces:**
- Consumes: token Task 1–2.
- Produces: prose gelap dengan TOC sticky; 404 satu kalimat.

- [ ] **Step 1: TOC sticky di `site.css`**

```css
.toc {
  margin: 0 0 32px;
  padding: 18px 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  list-style: none;
  font-size: 14px;
  columns: 2;
  column-gap: 30px;
}

@media (min-width: 900px) {
  main.prose:has(.toc) {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 48px;
    max-width: var(--wrap);
    align-items: start;
  }
  main.prose:has(.toc) .toc {
    position: sticky;
    top: 92px;
    columns: 1;
    margin: 0;
  }
  main.prose:has(.toc) > :not(.toc) { grid-column: 2; }
}
```

- [ ] **Step 2: `dukungan.html` accordion**

Ubah setiap pasangan `<dt>`/`<dd>` pertanyaan di `dukungan.html` menjadi `<details><summary>…</summary><p>…</p></details>` di dalam `<div class="faqList">`, sama seperti Task 7 Step 2. Kunci `data-i18n` dipertahankan.

- [ ] **Step 3: `404.html` satu kalimat**

Ganti `<p class="lede">` menjadi `<h1>` berisi kalimat yang sudah ada, dan bungkus empat tautan `.tile` dalam `<ul class="exitList">` dengan `<li><a>`. Pertahankan hitungan "Empat jalan keluar" yang sudah ada.

- [ ] **Step 4: Aturan `.exitList`**

```css
.exitList {
  display: grid;
  gap: 0;
  margin: 32px 0 0;
  padding: 0;
  border-top: 1px solid var(--line);
  list-style: none;
}

.exitList li { border-bottom: 1px solid var(--line); }

.exitList a {
  display: block;
  padding: 18px 0;
  color: var(--ink);
  font-size: 16px;
  text-decoration: none;
}

.exitList a:hover { color: var(--accent); }
```

- [ ] **Step 5: Jalankan tes**

Run: `npm test`
Expected: FAIL pada `landing-visual` "the 404 exits are real doors" karena selector `a class="tile"` berubah. Perbarui tes itu di Task 13.

- [ ] **Step 6: Commit**

```bash
git add landing/dukungan.html landing/privasi.html landing/syarat.html landing/404.html landing/site.css
git commit -m "Give the reading pages a still map and the 404 one plain sentence"
```

---

### Task 11: `index.html`, `akun.html`, `oauth/consent.html`

**Files:**
- Modify: `landing/index.html`
- Modify: `landing/akun.html`
- Modify: `landing/oauth/consent.html`
- Modify: `landing/auth.css`

**Interfaces:**
- Consumes: token Task 1–5.
- Produces: satu kartu tengah di `index.html`; `akun.html` memakai `.appCard` yang sudah ada; consent memakai `.panelLight`.

- [ ] **Step 1: `index.html` satu kartu**

Di `auth.css`, ubah `.gate` supaya kartunya satu kolom penuh:

```css
.gate {
  max-width: 460px;
  margin: 0 auto;
  padding: 32px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
```

Hapus `.split` dari `index.html` bila ia hanya membungkus brand dan gate; brand pindah ke atas kartu sebagai satu baris.

- [ ] **Step 2: `akun.html` tanpa border ganda**

`akun.html` sudah memakai `.appCard` dari `app.css`. Setelah Task 3 menghapus `body.app-dark`, `.appCard` membaca `--surface` dan `--line` global — tidak ada perubahan markup yang dibutuhkan. Verifikasi dengan membaca `landing/akun.html` dan memastikan tidak ada kelas `app-dark`.

- [ ] **Step 3: Consent memakai `.panelLight`**

Di `landing/oauth/consent.html`, ganti setiap `class="card"` yang membungkus daftar scope menjadi `class="card panelLight"` bila panelnya perlu dibedakan, atau biarkan `.card` bila tidak. Tidak ada perubahan wajib di sini; pastikan tidak ada `panelDark` tersisa.

- [ ] **Step 4: Jalankan tes**

Run: `npm test`
Expected: PASS untuk `landing-auth` dan `landing-consent`.

- [ ] **Step 5: Commit**

```bash
git add landing/index.html landing/akun.html landing/oauth/consent.html landing/auth.css
git commit -m "Stand the sign-in and the account on the same canvas as the rest"
```

---

### Task 12: Verifikasi `dashboard.html`

**Files:**
- Read: `landing/dashboard.html`, `landing/dashboard.css`
- Modify: `landing/dashboard.css` bila ada token yang masih hilang

**Interfaces:**
- Consumes: token Task 1–6.
- Produces: konsol yang tidak lagi mendefinisikan paletnya sendiri.

- [ ] **Step 1: Cari token yang hilang**

Run: `node -e "const fs=require('fs');const site=fs.readFileSync('landing/site.css','utf8');const defs=new Set([...site.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map(m=>m[1]));for(const f of ['app','dashboard','beranda','auth','download','features']){const t=fs.readFileSync('landing/'+f+'.css','utf8');for(const m of t.matchAll(/var\((--[a-z0-9-]+)/g)){if(!defs.has(m[1]))console.log(f,'reads undefined',m[1])}}"`
Expected: tidak ada baris keluaran.

- [ ] **Step 2: Cari literal yang tersisa**

Run: `node -e "const t=require('fs').readFileSync('landing/dashboard.css','utf8');console.log((t.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)||[]).length)"`
Expected: `0`

- [ ] **Step 3: Commit bila ada perubahan**

```bash
git add landing/dashboard.css
git commit -m "Close the last token the console still read from the old palette"
```

---

### Task 13: Tulis ulang `landing-visual.test.mjs`

**Files:**
- Modify: `tests/landing-visual.test.mjs` (seluruh isi)

**Interfaces:**
- Consumes: `landing/site.css` dengan token Task 1.
- Produces: 18 tes yang mengunci kontras, aksen, dan struktur — bukan nama warna.

- [ ] **Step 1: Ganti header dan helper**

```javascript
// @last-edited: 2026-11-03 UTC+7.
// @title: landing-visual — the site is one dark canvas, and it looks finished on every screen.
// @state: 18 locks; contrast is computed from the tokens, not matched as a string.
// @dependencies: test, assert, fs, helpers/mcp-surface-source.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mcpSurfaceSourceSync } from './helpers/mcp-surface-source.mjs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');
const cssOf = (name) => {
  const html = read(name);
  const links = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/([^"]+)"/g)].map((match) => match[1]);
  return `${html}\n${links.map((file) => read(file)).join('\n')}`;
};
const pages = ['beranda.html', 'akun.html', 'index.html', 'dashboard.html', 'unduh.html', 'unduh-berkas.html', 'privasi.html', 'syarat.html', '404.html', 'oauth/consent.html', 'fitur.html', 'dukungan.html'];

const token = (name) => {
  const value = new RegExp(`^\\s*${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, 'm').exec(read('site.css'))?.[1];
  assert.ok(value, `site.css defines ${name}`);
  return value;
};

const luminance = (hex) => {
  const [r, g, b] = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
```

- [ ] **Step 2: Tes kanvas dan kontras**

```javascript
test('every page sits on one dark canvas', () => {
  const bg = token('--bg');
  assert.ok(luminance(bg) < 0.05, `--bg is dark, and measures ${luminance(bg).toFixed(3)}`);
  for (const page of pages) {
    const css = cssOf(page);
    assert.match(css, /body \{[^}]*background: var\(--bg\)/s, `${page} paints the shared canvas`);
    assert.doesNotMatch(css, /body \{[^}]*background: #f/s, `${page} paints no light canvas of its own`);
  }
});

test('every pair of text and ground clears its contrast floor', () => {
  const bg = token('--bg');
  assert.ok(contrast(token('--ink'), bg) >= 7, 'body ink clears AAA');
  assert.ok(contrast(token('--muted'), bg) >= 4.5, 'second-rank ink clears AA');
  assert.ok(contrast(token('--accent'), bg) >= 4.5, 'the accent clears AA as text');
  assert.ok(contrast(token('--on-fill'), token('--ink')) >= 7, 'the filled action reads on its own fill');
});
```

- [ ] **Step 3: Tes satu aksen dan tanpa bayangan**

```javascript
test('one accent, and every other surface is neutral', () => {
  const neutral = ['--bg', '--surface', '--surface-2', '--ink', '--muted'];
  for (const name of neutral) {
    const [r, g, b] = token(name).replace('#', '').match(/../g).map((x) => parseInt(x, 16));
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 3, `${name} carries no hue`);
  }
  const [r, g, b] = token('--accent').replace('#', '').match(/../g).map((x) => parseInt(x, 16));
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) > 100, 'the accent is the only saturated colour');
});

test('no page separates two surfaces with a shadow', () => {
  const sheet = read('site.css');
  assert.doesNotMatch(sheet, /--shadow/, 'the shadow token is gone');
  for (const page of pages) {
    assert.doesNotMatch(cssOf(page), /\.card \{[^}]*box-shadow/, `${page} separates cards with a line`);
  }
});
```

- [ ] **Step 4: Tes lembar halaman tidak menulis warna**

```javascript
test('a page sheet names no colour of its own', () => {
  for (const sheet of ['beranda.css', 'auth.css', 'app.css', 'dashboard.css', 'download.css', 'features.css']) {
    const css = read(sheet);
    const literals = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].map((m) => m[0]);
    assert.deepEqual(literals, [], `${sheet} reads every colour from a token`);
  }
});
```

- [ ] **Step 5: Pertahankan tes yang tidak berubah**

Salin apa adanya dari file lama: "the hero sells the product", "the hero stats equal live source counts", "every section closes before the next one opens", "the nav answers a visitor in one row", "the nav survives a 390px phone", "the header is never squeezed", "a code pill never crosses its card border", "the marked nav item is visible", "the phone nav hints that it scrolls", "the hero carries exactly one filled action", "the hero states each number once", "no script renames a link that is not there", "the provider buttons show their marks", "the legal pages open with a map", "home after sign-in is a console door", "the hero carries its footnote", "motion is an enhancement", "nothing spills out of a 320px screen".

- [ ] **Step 6: Perbarui empat tes yang berubah**

- "the 404 exits are real doors": ganti selector `a class="tile"` menjadi `\.exitList a` dan hitung `href`.
- "display type sets the page apart": ganti `clamp\(38px, 4\.6vw, 62px\)` menjadi `clamp\(40px, 6vw, 76px\)`.
- "marketing controls round with the shared radius": hapus, digantikan tes `--radius: 8px` di Step 2.
- "the hero carries its footnote": tetap.

- [ ] **Step 7: Jalankan**

Run: `node --test tests/landing-visual.test.mjs`
Expected: PASS, 18 tes.

- [ ] **Step 8: Commit**

```bash
git add tests/landing-visual.test.mjs
git commit -m "Judge the site by its contrast, not by the names it once gave its colours"
```

---

### Task 14: Selaraskan `landing-dashboard` dan `landing-company`

**Files:**
- Modify: `tests/landing-dashboard.test.mjs:448-452,634-640,743-801`
- Modify: `tests/landing-company.test.mjs:67`

**Interfaces:**
- Consumes: `site.css` tanpa `--paper`, `app.css` tanpa `body.app-dark`.
- Produces: dua suite hijau tanpa melemahkan klaimnya.

- [ ] **Step 1: `theme-color`**

`tests/landing-company.test.mjs:67`:

```javascript
    assert.match(full, /<meta name="theme-color" content="#0a0a0a"/, `${page} tints the browser chrome`);
```

- [ ] **Step 2: Footer bukan lagi satu-satunya gelap**

`tests/landing-dashboard.test.mjs:448-452` — ganti tes "the marketing pages close on a dark band, the way the console opens" menjadi:

```javascript
test('the footer closes on the same ground every page sits on', () => {
  const sheet = read('site.css');
  assert.match(sheet, /footer \{[^}]*background: var\(--surface\)/, 'the footer is a surface, not a second palette');
  assert.match(sheet, /footer \{[^}]*color: var\(--muted\)/, 'and its links read on that surface');
});
```

- [ ] **Step 3: Token yang tidak lagi ditulis ulang**

`tests/landing-dashboard.test.mjs:634-640` — ganti daftar token:

```javascript
  for (const token of ['--bg', '--surface', '--ink', '--accent', '--radius']) {
    assert.doesNotMatch(css, new RegExp(`${token}\\s*:`), `the page does not restate ${token}`);
  }
```

- [ ] **Step 4: Hapus tes `body.app-dark`**

Hapus tes `the console declares its own dark scale, and the site keeps its own` (baris 747–761), `the chrome of an app page answers in the same ink as its canvas` (763–771), dan `a primary action on a dark canvas carries dark ink` (773–776). Ketiganya menguji mekanisme yang sudah tidak ada. Ganti dengan satu tes:

```javascript
test('the console declares no palette of its own', () => {
  assert.doesNotMatch(app, /body\.app-dark/, 'the shell reads the shared canvas');
  assert.doesNotMatch(app, /--paper\s*:/, 'and redefines no core token');
  assert.doesNotMatch(read('dashboard.html'), /class="app-dark"/, 'the page names no dark scale');
});
```

- [ ] **Step 5: Radius**

`tests/landing-dashboard.test.mjs:795-801` — ganti `10px`/`6px` menjadi `var(--radius)`/`var(--radius-sm)`:

```javascript
test('the shell is squared to the shared radius', () => {
  assert.match(css, /main\.console \{[^}]*--app-radius: var\(--radius\)/, 'a card reads the shared radius');
  assert.match(css, /main\.console \{[^}]*--app-radius-sm: var\(--radius-sm\)/, 'and so does a control');
});
```

- [ ] **Step 6: Jalankan**

Run: `node --test tests/landing-dashboard.test.mjs tests/landing-company.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/landing-dashboard.test.mjs tests/landing-company.test.mjs
git commit -m "Retire the tests that guarded a second palette nobody needs"
```

---

### Task 15: Verifikasi menyeluruh

**Files:**
- Tidak ada file baru.

- [ ] **Step 1: Suite penuh**

Run: `npm test`
Expected: semua hijau, termasuk 18 tes visual baru.

- [ ] **Step 2: Pemeriksaan runtime**

Run: `npm run check`
Expected: `check ok: 31 allowlisted browser primitives, 183 runtime safety files, version 1.6.27`

- [ ] **Step 3: Formatter komentar**

Run: `node scripts/format-comments.mjs`
Expected: `comment format ok: 443 files`

- [ ] **Step 4: Gate browser**

Run: `python tests/browser_extension_test.py`
Expected: exit 0.

- [ ] **Step 5: Verifikasi di browser, 1440px**

Buka `landing/beranda.html` lewat server lokal. Periksa: latar `#0a0a0a`, teks `#ededed`, satu aksi terisi di hero, band angka terbaca, FAQ terbuka dengan klik dan dengan `Tab` + `Enter`, footer satu baris.

- [ ] **Step 6: Verifikasi di browser, 390px**

Ulangi untuk `beranda.html`, `fitur.html`, `unduh.html`, `unduh-berkas.html`, `404.html`. Periksa: tidak ada scroll horizontal, tabel berkas menjadi kartu bertumpuk, nav tetap satu baris dan bisa digeser.

- [ ] **Step 7: Verifikasi kontras di browser**

Buka DevTools, pilih elemen `h1` dan `p.lede`. Periksa angka kontras yang dilaporkan DevTools: `h1` ≥ 15:1, `p.lede` ≥ 7:1.

- [ ] **Step 8: Commit bila ada perbaikan**

```bash
git add -A
git commit -m "Fix what the browser showed that the tests could not"
```
