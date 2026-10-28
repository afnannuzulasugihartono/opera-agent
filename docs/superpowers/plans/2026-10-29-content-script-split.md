# Content Script Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pecah `extension/content.js` (1945 baris, 90 fungsi, satu IIFE) jadi entry tipis ~200 baris plus delapan modul content script, tanpa satu pun perubahan perilaku.

**Architecture:** Delapan modul baru flat di `extension/`, masing-masing IIFE klasik dengan guard `globalThis` dan namespace beku — persis pola `role-reconcile.js` yang sudah terbukti, karena `manifest.content_scripts` tidak mendukung `type: module`. `content.js` tetap dispatcher dan membaca namespace lewat destructuring satu baris per modul, sehingga tidak ada satu pun call site yang di-rename. Urutan muat = urutan pemindahan = urutan topologis.

**Tech Stack:** MV3 content scripts (classic scripts, isolated world bersama), Node `node:test` suite, `py tests/browser_extension_test.py` sebagai bukti halaman hidup.

**Spec:** [`../specs/2026-10-29-content-script-split-design.md`](../specs/2026-10-29-content-script-split-design.md)

## Global Constraints

- `extension/content.js` harus berakhir di bawah **300 baris**.
- Delapan modul baru masing-masing di bawah **550 baris** (plafon worker yang sudah ada).
- Urutan muat dikunci persis: `lib/agent-log.js, semantic-identity.js, semantic-views.js, role-reconcile.js, hover-settle.js, page-kit.js, action-refs.js, element-facts.js, page-wait.js, semantic-page.js, page-actions.js, page-scroll.js, page-media.js, content.js`.
- `manifest.json` `content_scripts[0].js` dan `extension/worker/tab-content.js:92` wajib identik byte-per-byte — dijaga tes `the ensureContent script list still matches the manifest`.
- Nol fungsi di-rename. Nol asersi tes dihapus. Fungsi dipindah **verbatim**.
- Tujuh modul baru bebas `chrome.*` sebagai kode; `page-media.js` adalah kecualian tertulis (dua `chrome.runtime.sendMessage`: chunk listen dan watch.facts).
- Setiap berkas baru memakai header empat field: `@last-edited`, `@title`, `@state`, `@dependencies`.
- 59 berkas milik sesi lain (`extension/lib/`, `extension/worker/`, `local/`, `docs/` selain spec ini, `supabase/functions/_shared/billing.js`) tidak disentuh.

## Review Focus

Lima masukan yang paling mungkin menggigit orang yang memakai perangkat lunak ini, dan tes yang menguncinya:

1. **Namespace dipanggil sebelum modulnya dimuat** (urutan muat salah) — kegagalan **sunyi**: `globalThis.OperaAgentPageKit` `undefined`, helper hilang, halaman setengah mati tanpa lempar. Tes: Task 1 gate *manifest loads the modules in dependency order* (deep-equal terhadap daftar persis), dan Task 1 gate chrome-free yang ikut gagal kalau path-nya tidak ada.
2. **Daftar injeksi runtime dan manifest menyimpang** — `ensureContent` tidak menemukan file, konten pingsan diam-diam. Tes: `tests/extension-source.test.mjs` *the ensureContent script list still matches the manifest* (byte-identity), yang sudah ada dan harus hijau di setiap task.
3. **Degradasi hilang** — helper yang tidak ada kini melempar dan menjatuhkan seluruh content script, bukan satu fitur. Tes: `tests/efficiency.test.mjs` asersi `doesNotMatch` "Role reconcile runtime"; wajib hijau setiap task.
4. **State terduplikasi dua salinan yang menyimpang** — `refs`/`refCounter`/`watchState` dipindah ke modul sementara `content.js` masih memakai salinan lama. Tes: Task 1 gate *no state is declared twice across the bundle* (sudah ada di `extension-source.test.mjs`), plus Task 10 verifikasi manual: `grep -c` setiap nama state di `content.js` harus 0 setelah modulnya pindah.
5. **`doesNotMatch` jadi lebih longgar karena bundel** — sebelas berkas kini membaca 14 berkas; pola yang dulu "tidak ada" kini diperiksa terhadap kode baru. Tes: Task 1 langkah 6 mencatat keluaran `npm test` sebelum dan sesudah re-point; yang boleh berubah hanya tiga gate baru.

---

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `extension/content.js` | bootstrap, wiring mesin semantik, `mutationObserver`, dispatcher `handle`/`onMessage` (~200 baris) |
| `extension/page-kit.js` | **baru** — helper murni + batas yang dipakai lintas modul |
| `extension/action-refs.js` | **baru** — ref, revalidasi, `resetActionRefs` |
| `extension/element-facts.js` | **baru** — nama, identitas stabil, geometri, hit-test, actionability |
| `extension/page-wait.js` | **baru** — `key`, `stateMatches`, `waitFor` |
| `extension/semantic-page.js` | **baru** — serialize, collect, observe, read, query, find, links |
| `extension/page-actions.js` | **baru** — jalur tulis + bukti pasca-aksi |
| `extension/page-scroll.js` | **baru** — pointer target, capture policy, scroll |
| `extension/page-media.js` | **baru** — listen, media, watch (kecualian `chrome.*` tertulis) |
| `extension/manifest.json` | `content_scripts[0].js` bertambah 8 path |
| `extension/worker/tab-content.js:92` | daftar injeksi runtime, identik byte-per-byte dengan manifest |
| `tests/helpers/content-source.mjs` | **baru** — bundel semua content script, sumber kebenarannya manifest |
| `tests/code-standard.test.mjs` | gate baru: plafon entry, plafon modul, urutan muat |
| `tests/structure-gates.test.mjs` | gate baru: content script module bebas `chrome.*` (satu kecualian tertulis) |
| 11 berkas tes | satu baris per berkas: `readFile(content.js)` → `contentSource()` |

---

## Task 1: Cabut klaim palsu, dan bangun alat yang membuktikan pemindahan

**Files:**
- Create: `tests/helpers/content-source.mjs`
- Modify: `tests/code-standard.test.mjs` (tambah 3 gate, hapus 1 kecualikan)
- Modify: `tests/structure-gates.test.mjs` (tambah 1 gate)
- Modify: `tests/action-pipeline.test.mjs:64`, `tests/ax-observation.test.mjs:14`, `tests/burst-atomic-actions.test.mjs:116`, `tests/efficiency.test.mjs:14`, `tests/efficiency.test.mjs:25`, `tests/focus-and-keyboard.test.mjs:248`, `tests/hover-settle.test.mjs:124`, `tests/role-reconcile.test.mjs:192`, `tests/landing-claims.test.mjs:23`, `tests/landing-dashboard.test.mjs:114`, `tests/ref-reacquire.test.mjs:19`

**Interfaces:**
- Consumes: `extension/manifest.json` (satu-satunya sumber kebenaran urutan muat).
- Produces: `contentSource()` dan `contentScriptFiles()` dari `tests/helpers/content-source.mjs` — dipakai sebelas berkas tes di task ini dan seluruh task berikutnya.

- [ ] **Step 1: Tulis helper bundel**

Create `tests/helpers/content-source.mjs`:

```js
// @last-edited: 2026-10-29 UTC+7.
// @title: content-source — every content script the manifest loads, in load order, in one string.
// @state: the manifest is the source of truth, so this helper reads it instead of repeating it.
// @dependencies: node:fs/promises.

import { readFile } from 'node:fs/promises';

// WHY THE MANIFEST AND NOT A LIST HERE.
// A second list is a list that drifts: the injection order is already written twice in the tree (manifest and worker/tab-content.js), and a third copy in the tests would be a third thing to keep true.
// Reading the manifest makes the helper follow whatever the product actually loads.

export async function contentScriptFiles() {
  const manifest = JSON.parse(
    await readFile(new URL('../../extension/manifest.json', import.meta.url), 'utf8')
  );
  return manifest.content_scripts.flatMap((entry) => entry.js ?? []);
}

export async function contentSource() {
  const files = await contentScriptFiles();
  const parts = await Promise.all(files.map(
    (rel) => readFile(new URL(`../../extension/${rel}`, import.meta.url), 'utf8')
  ));
  return parts.join('\n');
}
```

- [ ] **Step 2: Jalankan helper terhadap pohon hari ini — baseline, bukan asumsi**

Run: `node --input-type=module -e "import { contentSource } from './tests/helpers/content-source.mjs'; const s = await contentSource(); console.log('files:', (await import('./tests/helpers/content-source.mjs')).contentScriptFiles ? '' : ''); console.log('chars:', s.length); console.log('has collectInteractiveNodes:', /function collectInteractiveNodes\(/.test(s));"`
Expected: `chars:` sekitar 20000, dan `has collectInteractiveNodes: true`.

Kalau `false`, berhenti — helper salah baca, jangan lanjut.

- [ ] **Step 3: Tambahkan tiga gate ke `tests/code-standard.test.mjs`**

Sisipkan setelah `const FILE_LINE_EXCEPTIONS = new Map([...]);` (baris 44-46):

```js
// WHY THE CONTENT SCRIPT ENTRY HAS A CEILING OF ITS OWN.
// The file was 1,945 lines and held every page primitive in one IIFE: refs, geometry, the semantic layer, the write path, scroll, wait, media and watch.
// The manifest loads content scripts as a list, so one entry was never a platform requirement — it was a habit, and the cap below is what ends it.

const CONTENT_ENTRY_CEILING = 300;

// WHY THE LOAD ORDER IS PINNED AS A WHOLE LIST.
// A module read before it loads answers undefined, and the failure is silent: the helper is simply missing and the page keeps working with half its features.
// Pinning the whole list means a new file added in the wrong place fails here instead of in a user's browser.

const CONTENT_SCRIPT_LOAD_ORDER = [
  'lib/agent-log.js', 'semantic-identity.js', 'semantic-views.js', 'role-reconcile.js', 'hover-settle.js',
  'page-kit.js', 'action-refs.js', 'element-facts.js', 'page-wait.js', 'semantic-page.js',
  'page-actions.js', 'page-scroll.js', 'page-media.js', 'content.js'
];
```

Tambahkan di akhir berkas:

```js
test('the content script entry stays thin, and its modules stay under the worker ceiling', () => {
  const entry = lines('extension/content.js').length;
  assert.ok(entry < CONTENT_ENTRY_CEILING,
    `content.js is the dispatcher, not the product: ${entry} lines`);
  for (const name of CONTENT_SCRIPT_LOAD_ORDER) {
    if (name === 'content.js' || name.startsWith('lib/')) continue;
    if (!tracked().includes(`extension/${name}`)) continue; // not moved yet
    assert.ok(lines(`extension/${name}`).length < 550,
      `extension/${name} is ${lines(`extension/${name}`).length} lines`);
  }
});

test('the manifest loads the content scripts in dependency order', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.deepEqual(manifest.content_scripts[0].js, CONTENT_SCRIPT_LOAD_ORDER,
    `the load order is the topological order; a file added out of place loads before its namespace exists:\n  got ${JSON.stringify(manifest.content_scripts[0].js)}`);
});
```

- [ ] **Step 4: Tambahkan gate `chrome.*` ke `tests/structure-gates.test.mjs`**

`tests/structure-gates.test.mjs` **dipin** `gates.lock`, jadi langkah ini butuh `npm run gates:refresh` di Step 7 — dengan alasan yang ditulis di commit.

Tambahkan setelah tes `extension/lib is free of chrome.*` (sekitar baris 56):

```js
// WHY THE CONTENT SCRIPTS ARE CHECKED TOO.
// The page half of a primitive touches the DOM, never the extension API, so a chrome.* inside one is a sign the code belongs in a worker.
// One file is excepted and named: page-media speaks to the service worker for the listen chunks and the watch facts, which is the one job a content script legitimately does through chrome.*.

test('the content script modules reach for no chrome.* as code, with one named exception', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', root), 'utf8'));
  const CONTENT_CHROME_EXCEPTIONS = new Set(['page-media.js']);
  const offenders = [];
  for (const rel of manifest.content_scripts[0].js) {
    const name = rel.split('/').pop();
    if (name === 'content.js' || name === 'agent-log.js') continue;
    if (CONTENT_CHROME_EXCEPTIONS.has(name)) continue;
    const hits = chromeCodeLines(await readFile(new URL(`../extension/${rel}`, root), 'utf8'));
    if (hits.length) offenders.push(`${rel}: ${hits.join(', ')}`);
  }
  assert.deepEqual(offenders, [],
    `the page half of a primitive touches the DOM, not chrome.*:\n${offenders.join('\n')}`);
});
```

- [ ] **Step 5: Cabut kecualikan yang salah, dan perbaiki komentarnya**

Ganti blok baris 40-46 di `tests/code-standard.test.mjs`:

```js
// WHY ONE FILE IS NAMED INSTEAD OF FIXED HERE.
// Chrome loads a content script as one unit, so splitting extension/content.js means separate manifest entries and separate isolated worlds, which is a project of its own and not a line count.
// The exception is named, counted and visible, and the rest of the tree has no exceptions.

const FILE_LINE_EXCEPTIONS = new Map([
  ['extension/content.js', 'Chrome loads a content script as one unit; splitting it means separate manifest entries.']
]);
```

menjadi:

```js
// WHY NO FILE IS NAMED ANY MORE.
// content.js was excepted here with the claim that Chrome loads a content script as one unit, so splitting it would need separate manifest entries and separate isolated worlds.
// The claim was false, and the tree proved it: manifest.content_scripts[0].js has always loaded six files through one entry, in one isolated world, in order.
// What actually kept the file large was that sentence, not the platform — so the exception is gone and the ceiling in the content-script gate below is what holds the line now.
```

- [ ] **Step 6: Re-point sebelas berkas tes — satu baris per berkas**

Setiap berkas: tambahkan `import { contentSource } from './helpers/content-source.mjs';` bila belum ada, lalu ganti pembacaan `content.js` dengan `await contentSource()`.

| berkas | baris | sebelum | sesudah |
|---|---|---|---|
| `tests/action-pipeline.test.mjs` | 64 | `const src = read('extension/content.js');` | `const src = await contentSource();` (di dalam `test` async; kalau di top-level, `let src;` + `before`) |
| `tests/ax-observation.test.mjs` | 14 | `const content = read('../extension/content.js');` | `let content;` + di `before()`: `content = await contentSource();` |
| `tests/burst-atomic-actions.test.mjs` | 116 | `const content = fs.readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');` | `const content = await contentSource();` |
| `tests/efficiency.test.mjs` | 14, 25 | dua `fs.readFileSync(...content.js...)` | `const content = await contentSource();` sekali, dipakai dua asersi |
| `tests/focus-and-keyboard.test.mjs` | 248 | `const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');` | `const source = await contentSource();` |
| `tests/hover-settle.test.mjs` | 124, 141 | `readFile(...content.js...)` dan pembacaan `manifest.content_scripts[0].js` | yang 124 → `await contentSource()`; yang 141 **tidak disentuh** (ia sudah membaca manifest) |
| `tests/ref-reacquire.test.mjs` | 19 | `const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');` | `const source = await contentSource();` |
| `tests/role-reconcile.test.mjs` | 192 | `const source = await readFile(...)` | `const source = await contentSource();` |
| `tests/landing-claims.test.mjs` | 23 | `const content = read('extension/content.js');` | `const content = await contentSource();` |
| `tests/landing-dashboard.test.mjs` | 114 | `const content = fs.readFileSync(new URL('extension/content.js', root), 'utf8');` | `const content = await contentSource();` |

Aturan yang mengikat: **nol asersi dihapus**. Kalau sebuah asersi ternyata membaca berkas lain (`hover-settle.test.mjs:141` membaca manifest), ia tidak disentuh.

- [ ] **Step 7: Refresh pin, lalu jalankan suite**

Run: `npm run gates:refresh`
Expected: `gates.lock` bertambah hash baru untuk `tests/structure-gates.test.mjs`.

Run: `npm test 2>&1 | Select-String -Pattern "^# (tests|pass|fail)|^not ok"`
Expected: **tiga** gate baru gagal, sisanya hijau:
- `the content script entry stays thin...` → `content.js is the dispatcher, not the product: 1945 lines`
- `the manifest loads the content scripts in dependency order` → daftar manifesto masih 6 berkas
- `the content script modules reach for no chrome.*...` → lolos (keenam berkas yang ada bersih)

Kalau yang gagal lebih dari dua gate baru, atau ada gate lama yang gagal: **berhenti dan perbaiki**, jangan lanjut.

Run: `npm run check`
Expected: `check ok`.

- [ ] **Step 8: Commit**

```bash
git add tests/helpers/content-source.mjs tests/code-standard.test.mjs tests/structure-gates.test.mjs gates.lock tests/action-pipeline.test.mjs tests/ax-observation.test.mjs tests/burst-atomic-actions.test.mjs tests/efficiency.test.mjs tests/focus-and-keyboard.test.mjs tests/hover-settle.test.mjs tests/ref-reacquire.test.mjs tests/role-reconcile.test.mjs tests/landing-claims.test.mjs tests/landing-dashboard.test.mjs
git commit -m "Cabut kecualikan content.js yang beralasan salah, dan bangun alat yang membuktikan pemindahannya

code-standard.test.mjs membebaskan content.js dari plafon 1200 baris dengan
klaim: Chrome memuat content script sebagai satu unit, jadi memecahnya butuh
manifest entry terpisah dan isolated world terpisah.

Klaim itu salah dan repo ini sendiri sudah membuktikannya:
content_scripts[0].js selalu memuat ENAM file lewat SATU entri, SATU isolated
world, berurutan. Yang menahan ukuran file itu kalimat tersebut, bukan platform.

Jadi kecualikan dicabut, dan tiga gate baru yang mengunci hasil akhirnya:
content.js di bawah 300 baris, modul-modulnya di bawah 550, dan urutan muat
dipin sebagai satu daftar - karena namespace yang dipanggil sebelum modulnya
dimuat gagal SUNYI, bukan lempar.

Sebelas berkas yang membaca content.js sebagai teks kini membaca bundel
manifest lewat tests/helpers/content-source.mjs. Sumber kebenarannya manifest,
bukan daftar ketiga yang bisa menyimpang. Nol asersi dihapus.

Suite sengaja merah di dua gate baru setelah commit ini: itu bukti langkah
berikutnya wajib, bukan kerusakan.

gates.lock di-refresh untuk tests/structure-gates.test.mjs, yang menambah gate
chrome-free untuk content script dengan satu kecualikan tertulis (page-media,
satu-satunya yang berbicara ke service worker)."
```

---

## Task 2: `page-kit.js` — helper murni dan batas bersama

**Files:**
- Create: `extension/page-kit.js`
- Modify: `extension/content.js` (hapus 6 fungsi + 6 konstanta, tambah 1 baris destructuring)
- Modify: `extension/worker/tab-content.js:92` (tambah `'page-kit.js',` sebelum `'content.js'`)
- Modify: `extension/manifest.json` (`content_scripts[0].js`)

**Interfaces:**
- Consumes: tidak ada — modul daun.
- Produces: `globalThis.OperaAgentPageKit` dengan `clamp, clean, normalizeObservableText, normalizeText, currentRouteKey, MAX_TEXT_CHUNK, MAX_ELEMENTS, MAX_QUERY, MAX_LINKS, PUA_GLYPH_RE, VISITED_SUFFIX_RE`.

- [ ] **Step 1: Buat `extension/page-kit.js`**

```js
// @last-edited: 2026-10-29 UTC+7.
// @title: page-kit — the pure helpers and the limits every page module shares.
// @state: clamp, clean, normalizeObservableText, normalizeText and currentRouteKey, plus the four MAX_* caps and the two text regexes; no DOM of its own.
// @dependencies: none.

// WHY THIS FILE EXISTS.
// Every module below the entry needs the same six helpers, and a helper that lives in the entry is a helper eight files reach into the dispatcher for.
// This is the leaf, like lib/log.js was for the worker split: it imports nothing and is imported by everything.

(() => {
  'use strict';
  if (globalThis.OperaAgentPageKit) return;

  const MAX_TEXT_CHUNK = 12000;
  const MAX_ELEMENTS = 200;
  const MAX_QUERY = 100;
  const MAX_LINKS = 500;

  const PUA_GLYPH_RE = /[\uE000-\uF8FF\u200B\u200C\uFEFF]|\u200D/g;
  const VISITED_SUFFIX_RE = /\s*visited link\s*$/i;

  function clamp(value, min, max, fallback = min) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function clean(value, max = 500) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function normalizeObservableText(value, max = 500) {
    const text = clean(value, max + 40).replace(PUA_GLYPH_RE, ' ').replace(/\s+/g, ' ').trim();
    const untagged = VISITED_SUFFIX_RE.test(text) ? text.replace(VISITED_SUFFIX_RE, '').trim() : text;
    return untagged.slice(0, max);
  }

  function normalizeText(value) {
    return String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\t\f\v ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function currentRouteKey() {
    return globalThis.OperaAgentSemanticIdentity.stableHash(
      `${location.origin}${location.pathname}${location.search}`
    );
  }

  globalThis.OperaAgentPageKit = Object.freeze({
    MAX_TEXT_CHUNK,
    MAX_ELEMENTS,
    MAX_QUERY,
    MAX_LINKS,
    PUA_GLYPH_RE,
    VISITED_SUFFIX_RE,
    clamp,
    clean,
    normalizeObservableText,
    normalizeText,
    currentRouteKey
  });
})();
```

- [ ] **Step 2: Hapus yang pindah dari `content.js`, dan baca namespace-nya**

Hapus dari `extension/content.js`: baris 49-52 (`MAX_TEXT_CHUNK` … `MAX_LINKS`), baris 80-111 (`clamp`, `clean`, `PUA_GLYPH_RE`, `VISITED_SUFFIX_RE`, `normalizeObservableText`, `normalizeText`, `currentRouteKey`).

Tambahkan satu baris setelah baris 47 (setelah blok `hoverSettle`):

```js
  const { clamp, clean, normalizeObservableText, normalizeText, currentRouteKey, MAX_TEXT_CHUNK, MAX_ELEMENTS, MAX_QUERY, MAX_LINKS } = globalThis.OperaAgentPageKit;
```

Kenapa destructuring dan bukan rename call site: tidak ada satu pun call site yang berubah, jadi tidak ada tempat bagi perilaku untuk menyimpang. `extension-source.test.mjs` menganggap nama itu **dideklarasikan** di berkas ini, jadi gate lintas-modul tetap lolos.

- [ ] **Step 3: Daftarkan ke kedua daftar injeksi**

`extension/manifest.json`, `content_scripts[0].js`: sisipkan `"page-kit.js",` setelah `"hover-settle.js"`.

`extension/worker/tab-content.js:92`: ganti

```js
files: ['lib/agent-log.js', 'semantic-identity.js', 'semantic-views.js', 'role-reconcile.js', 'hover-settle.js', 'content.js']
```

menjadi

```js
files: ['lib/agent-log.js', 'semantic-identity.js', 'semantic-views.js', 'role-reconcile.js', 'hover-settle.js', 'page-kit.js', 'content.js']
```

- [ ] **Step 4: Jalankan**

Run: `node --input-type=module -e "import {readFileSync} from 'node:fs'; const n=(f)=>((readFileSync(f,'utf8').match(/^\s*(?:async )?function \w+/gm))||[]).length; console.log('module', n('extension/page-kit.js'), '| content', n('extension/content.js'));"`
Expected: `module 5 | content 85` — `markInstalled` tetap di `content.js` karena ia bagian dari bootstrap.

Run: `npm test 2>&1 | Select-String -Pattern "^# (tests|pass|fail)|^not ok"`
Expected: yang gagal tinggal **satu** gate baru (`content.js is the dispatcher, not the product:` dengan angka yang sudah turun) dan gate urutan muat. Gate chrome-free tetap lolos. Tidak ada gate lama yang gagal.

Run: `npm run check`
Expected: `check ok`.

- [ ] **Step 5: Commit**

```bash
git add extension/page-kit.js extension/content.js extension/manifest.json extension/worker/tab-content.js
git commit -m "Pindahkan helper murni content script ke extension/page-kit.js

Enam fungsi dan enam konstanta yang dipakai hampir semua region pindah verbatim
ke modul daun. content.js membacanya lewat satu baris destructuring, jadi tidak
ada satu pun call site yang berubah - tidak ada tempat bagi perilaku menyimpang.

Ini modul pertama dari delapan; sisanya mengikuti pola namespace yang sama,
sudah terbukti di role-reconcile.js."
```

---

## Task 3: `action-refs.js` — ref dan revalidasi

**Files:**
- Create: `extension/action-refs.js`
- Modify: `extension/content.js`
- Modify: `extension/worker/tab-content.js:92`, `extension/manifest.json`

**Interfaces:**
- Consumes: `globalThis.OperaAgentPageKit` (clamp, clean, normalizeObservableText).
- Produces: `globalThis.OperaAgentActionRefs` — `actionRefDescriptor, descriptorMatchesElement, documentRectOf, geometryMatchesMint, signatureRebindCandidates, revalidationCandidates, getRef, resolveRef, refStateFor, resolveActionRef, resetActionRefs`, plus state `refCounter, refs, reverseRefs, actionRefDescriptors`.

- [ ] **Step 1: Ekstrak region refs verbatim**

**Aturan ekstraksi, berlaku untuk Task 3 sampai Task 9.** Nomor baris di daftar
adalah posisi di `content.js` **sebelum** pemindahan — pemeriksaan silang, bukan
yang mengikat. Yang mengikat adalah **nama fungsinya**, karena nomor baris
bergeser setiap kali sebuah region pindah. Isi setiap fungsi disalin **verbatim**
dari `content.js`; kalau rencana ini dan berkasnya berbeda, yang benar adalah
berkasnya. Step 4 di setiap task memeriksa jumlah fungsinya, jadi fungsi yang
terlewat tidak bisa lolos.

Pindahkan **sebelas fungsi ini beserta isinya, tanpa mengubah satu karakter pun**:

```
actionRefDescriptor      (dulu baris 113)
descriptorMatchesElement (133)
documentRectOf           (155)
geometryMatchesMint      (160)
signatureRebindCandidates(172)
revalidationCandidates   (195)
getRef                   (223)
resolveRef               (236)
refStateFor              (242)
resolveActionRef         (252)
resetActionRefs          (716)
```

Berserta **empat state**: `refCounter`, `refs`, `reverseRefs`, `actionRefDescriptors` (dulu baris 58-61).

Bingkai berkasnya:

```js
// @last-edited: 2026-10-29 UTC+7.
// @title: action-refs — the element handle: how a ref is minted, remembered and re-acquired.
// @state: eleven functions moved verbatim from content.js, plus the four maps that hold the ref table; no chrome.* as code.
// @dependencies: ./page-kit.js (namespace only).

// WHY A REF IS RE-ACQUIRED AND NOT JUST REMEMBERED.
// A page redraws the same element, so a ref held by identity alone goes stale. These eleven functions carry the geometry and signature drift that lets a ref find its element again, which is what page.action_state reports on when it cannot.

(() => {
  'use strict';
  if (globalThis.OperaAgentActionRefs) return;

  let refCounter = 0;
  let refs = new WeakMap();
  let reverseRefs = new Map();
  let actionRefDescriptors = new Map();

  // <-- sebelas fungsi, verbatim, di sini

  globalThis.OperaAgentActionRefs = Object.freeze({
    actionRefDescriptor,
    descriptorMatchesElement,
    documentRectOf,
    geometryMatchesMint,
    signatureRebindCandidates,
    revalidationCandidates,
    getRef,
    resolveRef,
    refStateFor,
    resolveActionRef,
    resetActionRefs
  });
})();
```

Ganti `const kit = ...` bila perlu: modul ini membaca helper lewat
`const { clamp, clean, normalizeObservableText } = globalThis.OperaAgentPageKit;`
di awal IIFE, **sebelum** fungsi-fungsinya.

- [ ] **Step 2: Hapus dari `content.js`, tambah satu baris**

Hapus kesebelas fungsi dan empat state itu. Tambahkan setelah baris destructuring `page-kit`:

```js
  const { actionRefDescriptor, descriptorMatchesElement, documentRectOf, geometryMatchesMint, signatureRebindCandidates, revalidationCandidates, getRef, resolveRef, refStateFor, resolveActionRef, resetActionRefs } = globalThis.OperaAgentActionRefs;
```

- [ ] **Step 3: Daftarkan ke kedua daftar injeksi**

Sisipkan `"action-refs.js",` setelah `"page-kit.js"` di `extension/manifest.json`, dan `'action-refs.js',` setelah `'page-kit.js',` di `extension/worker/tab-content.js:92`.

- [ ] **Step 4: Jalankan**

Run: `node --input-type=module -e "import {readFileSync} from 'node:fs'; const n=(f)=>((readFileSync(f,'utf8').match(/^\s*(?:async )?function \w+/gm))||[]).length; console.log('module', n('extension/action-refs.js'), '| content', n('extension/content.js'));"`
Expected: `module 11 | content 79`. Angka yang beda berarti sebuah fungsi tertinggal atau terbawa dua kali — perbaiki sebelum lanjut.

Run: `npm test 2>&1 | Select-String -Pattern "^# (tests|pass|fail)|^not ok"`
Expected: tidak ada gate baru gagal kecuali gate ukuran `content.js` (angkanya turun lagi) dan gate urutan muat. **Khusus perhatikan** `tests/ref-reacquire.test.mjs` — ia mencari blok `function resolveActionRef(ref) {` dan mengukur panjangnya; kalau gagal, batas bloknya pindah, dan itu yang harus diperiksa, bukan dihapus.

Run: `npm run check` → `check ok`.

- [ ] **Step 5: Commit**

```bash
git add extension/action-refs.js extension/content.js extension/manifest.json extension/worker/tab-content.js
git commit -m "Pindahkan region ref dan revalidasi ke extension/action-refs.js

Sebelas fungsi dan empat state pindah verbatim. State ikut karena seluruh
pemakaiannya ada di region ini - kalau tidak, dua salinan refs akan menyimpang
tanpa suara, dan refStateFor akan menjawab untuk tabel yang salah."
```

---

## Task 4: `element-facts.js` — fakta tentang sebuah elemen

**Files:**
- Create: `extension/element-facts.js`
- Modify: `extension/content.js`, kedua daftar injeksi

**Interfaces:**
- Consumes: `globalThis.OperaAgentPageKit`, `globalThis.OperaAgentActionRefs` (`actionRefDescriptor`, `descriptorMatchesElement`, `geometryMatchesMint`).
- Produces: `globalThis.OperaAgentElementFacts` — `getAssociatedLabel, isVisible, rectOf, composedHostChain, hitTestAcceptable, hitTestReachable, viewportFlags, isInViewport, actionabilityState, actionabilityRank, prioritizeActionableNodes, stableHash, stableElementIdentity, viewportState, userInputState, sensitiveDescriptor, assertEditableSafe`, plus state `SENSITIVE_RE, GEOMETRY_DRIFT_TOLERANCE_PX, lastUserInputAt`.

- [ ] **Step 1: Ekstrak region fakta elemen verbatim**

Pindahkan **tujuh belas fungsi** beserta isinya:

```
getAssociatedLabel(310)  isVisible(332)          rectOf(340)
composedHostChain(352)   hitTestAcceptable(364)  hitTestReachable(373)
viewportFlags(394)       isInViewport(432)       actionabilityState(436)
actionabilityRank(457)   prioritizeActionableNodes(467)
stableHash(474)          stableElementIdentity(489)
viewportState(504)       userInputState(526)
sensitiveDescriptor(533) assertEditableSafe(552)
```

Berserta **tiga state**: `SENSITIVE_RE` (78), `GEOMETRY_DRIFT_TOLERANCE_PX` (153), `lastUserInputAt` (521).

Bingkai berkasnya mengikuti Task 3, dengan:

```js
// @last-edited: 2026-10-29 UTC+7.
// @title: element-facts — what is true about one element: its name, its identity, its geometry, and whether it can act.
// @state: seventeen functions moved verbatim from content.js, plus SENSITIVE_RE, GEOMETRY_DRIFT_TOLERANCE_PX and lastUserInputAt; no chrome.* as code.
// @dependencies: ./page-kit.js and ./action-refs.js (namespaces only).
```

dan namespace `globalThis.OperaAgentElementFacts` berisi ketujuh belas nama itu.

- [ ] **Step 2: Hapus dari `content.js`, tambah satu baris**

```js
  const { getAssociatedLabel, isVisible, rectOf, composedHostChain, hitTestAcceptable, hitTestReachable, viewportFlags, isInViewport, actionabilityState, actionabilityRank, prioritizeActionableNodes, stableHash, stableElementIdentity, viewportState, userInputState, sensitiveDescriptor, assertEditableSafe } = globalThis.OperaAgentElementFacts;
```

- [ ] **Step 3: Daftarkan ke kedua daftar injeksi** — `"element-facts.js",` setelah `"action-refs.js"`.

- [ ] **Step 4: Jalankan, termasuk bukti halaman**

Run: `node --input-type=module -e "import {readFileSync} from 'node:fs'; const n=(f)=>((readFileSync(f,'utf8').match(/^\s*(?:async )?function \w+/gm))||[]).length; console.log('module', n('extension/element-facts.js'), '| content', n('extension/content.js'));"`
Expected: `module 17 | content 57`.

Run: `npm test 2>&1 | Select-String -Pattern "^# (tests|pass|fail)|^not ok"`
Expected: hanya gate ukuran `content.js` dan gate urutan muat yang gagal.

Run: `npm run check` → `check ok`.

Run: `py tests/browser_extension_test.py`
Expected: hijau. **Ini titik pertama bukti perilaku**: seluruh lapisan fakta elemen sudah pindah, dan halaman sungguhan harus tetap bisa baca, temukan, dan klik. Kalau merah, berhenti — jangan lanjut ke Task 5.

- [ ] **Step 5: Commit**

```bash
git add extension/element-facts.js extension/content.js extension/manifest.json extension/worker/tab-content.js
git commit -m "Pindahkan region fakta elemen ke extension/element-facts.js

Tujuh belas fungsi dan tiga state pindah verbatim. Ini region terbesar kedua,
dan titik pertama bukti perilaku: py tests/browser_extension_test.py hijau
setelahnya, jadi halaman sungguhan masih bisa baca, temukan, dan klik dengan
seluruh lapisan fakta elemen yang sudah tinggal di modul lain."
```

---

## Task 5: `page-wait.js` — tunggu dan tombol

**Files:**
- Create: `extension/page-wait.js`
- Modify: `extension/content.js`, kedua daftar injeksi

**Interfaces:**
- Consumes: `globalThis.OperaAgentPageKit`, `globalThis.OperaAgentElementFacts`.
- Produces: `globalThis.OperaAgentPageWait` — `key, stateMatches, waitFor`, plus state `NAV_KEYS`.

- [ ] **Step 1: Ekstrak verbatim**

Tiga fungsi — `key(1539)`, `stateMatches(1561)`, `waitFor(1579)` — dan satu state `NAV_KEYS(73)`.

```js
// @last-edited: 2026-10-29 UTC+7.
// @title: page-wait — the two things a page does over time: it takes a key, and it changes.
// @state: key, stateMatches and waitFor moved verbatim from content.js, plus NAV_KEYS; no chrome.* as code.
// @dependencies: ./page-kit.js and ./element-facts.js (namespaces only).
```

Namespace `globalThis.OperaAgentPageWait` berisi `key, stateMatches, waitFor`.

- [ ] **Step 2: Hapus dari `content.js`, tambah satu baris**

```js
  const { key, stateMatches, waitFor } = globalThis.OperaAgentPageWait;
```

- [ ] **Step 3: Daftarkan** — `"page-wait.js",` setelah `"element-facts.js"`. Modul ini **sebelum** `semantic-page`, `page-actions`, `page-scroll`, dan `page-media` karena keempatnya memanggilnya.

- [ ] **Step 4: Jalankan**

Run: `node --input-type=module -e "import {readFileSync} from 'node:fs'; const n=(f)=>((readFileSync(f,'utf8').match(/^\s*(?:async )?function \w+/gm))||[]).length; console.log('module', n('extension/page-wait.js'), '| content', n('extension/content.js'));"`
Expected: `module 3 | content 54`.

Run: `npm test` → hanya gate ukuran dan urutan muat yang gagal.
Run: `npm run check` → `check ok`.

- [ ] **Step 5: Commit**

```bash
git add extension/page-wait.js extension/content.js extension/manifest.json extension/worker/tab-content.js
git commit -m "Pindahkan tunggu dan tombol ke extension/page-wait.js

Tiga fungsi dan NAV_KEYS pindah verbatim. Modul ini sengaja mendahului
semantic-page, page-actions, page-scroll dan page-media: keempatnya memanggilnya,
dan urutan muat yang salah membuat namespace-nya undefined saat dipanggil -
kegagalan yang sunyi, bukan lempar."
```

---

## Task 6: `semantic-page.js` — lapisan baca, temukan, amati

**Files:**
- Create: `extension/semantic-page.js`
- Modify: `extension/content.js`, kedua daftar injeksi

**Interfaces:**
- Consumes: `globalThis.OperaAgentPageKit`, `globalThis.OperaAgentActionRefs`, `globalThis.OperaAgentElementFacts`, `globalThis.OperaAgentPageWait`.
- Produces: `globalThis.OperaAgentSemanticPage` — `serialize, collectInteractiveNodes, computeAccessibleName, semanticRegionObservation, syncSemanticScope, observeSemanticBounded, compactElementProjection, compactObservationElements, hoverSettleState, containsVisibleText, pageRead, pageQuery, findDisambiguationHint, findVisibleTextCandidate, pageFind, collectLinks`, plus state `semanticRouteKey, semanticRuntimeEpoch, INTERACTIVE_SELECTOR, MAX_SHADOW_ROOTS, MAX_COLLECTED_NODES`.

- [ ] **Step 1: Ekstrak verbatim**

Enam belas fungsi:

```
serialize(563)                  collectInteractiveNodes(623)
computeAccessibleName(648)      semanticRegionObservation(665)
syncSemanticScope(723)          observeSemanticBounded(744)
compactElementProjection(756)   compactObservationElements(787)
hoverSettleState(815)           containsVisibleText(853)
pageRead(867)                   pageQuery(922)
findDisambiguationHint(945)     findVisibleTextCandidate(954)
pageFind(982)                   collectLinks(1039)
```

Lima state: `semanticRouteKey(62)`, `semanticRuntimeEpoch(63)`, `INTERACTIVE_SELECTOR(615)`, `MAX_SHADOW_ROOTS(621)`, `MAX_COLLECTED_NODES(622)`.

```js
// @last-edited: 2026-10-29 UTC+7.
// @title: semantic-page — the read side of the page: serialize, observe, read, query, find, and the links between them.
// @state: sixteen functions moved verbatim from content.js, plus the five declarations that scope an observation; no chrome.* as code.
// @dependencies: ./page-kit.js, ./action-refs.js, ./element-facts.js, ./page-wait.js (namespaces only).
```

Namespace `globalThis.OperaAgentSemanticPage` berisi keenam belas nama itu.

- [ ] **Step 2: Hapus dari `content.js`, tambah satu baris**

```js
  const { serialize, collectInteractiveNodes, computeAccessibleName, semanticRegionObservation, syncSemanticScope, observeSemanticBounded, compactElementProjection, compactObservationElements, hoverSettleState, containsVisibleText, pageRead, pageQuery, findDisambiguationHint, findVisibleTextCandidate, pageFind, collectLinks } = globalThis.OperaAgentSemanticPage;
```

- [ ] **Step 3: Daftarkan** — `"semantic-page.js",` setelah `"page-wait.js"`.

- [ ] **Step 4: Jalankan**

Run: `node --input-type=module -e "import {readFileSync} from 'node:fs'; const n=(f)=>((readFileSync(f,'utf8').match(/^\s*(?:async )?function \w+/gm))||[]).length; console.log('module', n('extension/semantic-page.js'), '| content', n('extension/content.js'));"`
Expected: `module 16 | content 38`.

Run: `npm test 2>&1 | Select-String -Pattern "^# (tests|pass|fail)|^not ok"`
Expected: hanya gate ukuran dan urutan muat yang gagal. **Khusus perhatikan** `tests/ax-observation.test.mjs` — asersinya mencakup `shadowRoot` dan `MAX_SHADOW_ROOTS`; keduanya ikut pindah, dan bundel membuatnya tetap ketemu.

Run: `npm run check` → `check ok`.

- [ ] **Step 5: Commit**

```bash
git add extension/semantic-page.js extension/content.js extension/manifest.json extension/worker/tab-content.js
git commit -m "Pindahkan lapisan semantik halaman ke extension/semantic-page.js

Enam belas fungsi dan lima state pindah verbatim. Region ini yang membaca
semua modul di bawahnya, dan ia yang dipakai jalur tulis di task berikutnya -
karena itu ia pindah sebelum page-actions, bukan sesudah."
```

---

## Task 7: `page-actions.js` — jalur tulis dan bukti pasca-aksi

**Files:**
- Create: `extension/page-actions.js`
- Modify: `extension/content.js`, kedua daftar injeksi

**Interfaces:**
- Consumes: `globalThis.OperaAgentPageKit`, `globalThis.OperaAgentActionRefs`, `globalThis.OperaAgentElementFacts`, `globalThis.OperaAgentPageWait`, `globalThis.OperaAgentSemanticPage`.
- Produces: `globalThis.OperaAgentPageActions` — `nativeSetValue, preparePostAction, normalizeExpectSpec, evaluateExpectations, waitForPostActionSettle, waitForExpectVerification, summarizeSemanticDelta, postActionEvidence, clickSynthetic, fill, setFiles, fillInfo, focus, clickInfo, actionState`, plus state `EXPECT_VERIFY_WINDOW_MS`.

- [ ] **Step 1: Ekstrak verbatim**

Lima belas fungsi:

```
nativeSetValue(1059)        preparePostAction(1074)
normalizeExpectSpec(1088)   evaluateExpectations(1101)
waitForPostActionSettle(1122) waitForExpectVerification(1140)
summarizeSemanticDelta(1150) postActionEvidence(1164)
clickSynthetic(1213)        fill(1236)
setFiles(1255)              fillInfo(1270)
focus(1287)                 clickInfo(1296)
actionState(1307)
```

Satu state: `EXPECT_VERIFY_WINDOW_MS(1138)`.

```js
// @last-edited: 2026-10-29 UTC+7.
// @title: page-actions — the write side: fill, click, set files, and the evidence gathered after the page answers.
// @state: fifteen functions moved verbatim from content.js, plus EXPECT_VERIFY_WINDOW_MS; no chrome.* as code.
// @dependencies: ./page-kit.js, ./action-refs.js, ./element-facts.js, ./page-wait.js, ./semantic-page.js (namespaces only).
```

Namespace `globalThis.OperaAgentPageActions` berisi kelima belas nama itu.

- [ ] **Step 2: Hapus dari `content.js`, tambah satu baris**

```js
  const { nativeSetValue, preparePostAction, normalizeExpectSpec, evaluateExpectations, waitForPostActionSettle, waitForExpectVerification, summarizeSemanticDelta, postActionEvidence, clickSynthetic, fill, setFiles, fillInfo, focus, clickInfo, actionState } = globalThis.OperaAgentPageActions;
```

- [ ] **Step 3: Daftarkan** — `"page-actions.js",` setelah `"semantic-page.js"`.

- [ ] **Step 4: Jalankan**

Run: `node --input-type=module -e "import {readFileSync} from 'node:fs'; const n=(f)=>((readFileSync(f,'utf8').match(/^\s*(?:async )?function \w+/gm))||[]).length; console.log('module', n('extension/page-actions.js'), '| content', n('extension/content.js'));"`
Expected: `module 15 | content 23`.

Run: `npm test` → hanya gate ukuran dan urutan muat yang gagal.
Run: `npm run check` → `check ok`.

- [ ] **Step 5: Commit**

```bash
git add extension/page-actions.js extension/content.js extension/manifest.json extension/worker/tab-content.js
git commit -m "Pindahkan jalur tulis dan bukti pasca-aksi ke extension/page-actions.js

Lima belas fungsi dan EXPECT_VERIFY_WINDOW_MS pindah verbatim. Bukti pasca-aksi
ikut region ini karena ia membaca hasil observasi semantic-page: memisahkannya
akan memutus jalur yang paling sering dipakai orang."
```

---

## Task 8: `page-scroll.js` — pointer, kebijakan capture, scroll

**Files:**
- Create: `extension/page-scroll.js`
- Modify: `extension/content.js`, kedua daftar injeksi

**Interfaces:**
- Consumes: `globalThis.OperaAgentPageKit`, `globalThis.OperaAgentElementFacts`, `globalThis.OperaAgentPageWait`.
- Produces: `globalThis.OperaAgentPageScroll` — `pointerTarget, capturePolicy, isScrollable, findScrollTarget, scrollState, sameScrollPosition, settleScroll, scrollTargetBy, scroll`.

- [ ] **Step 1: Ekstrak verbatim**

Sembilan fungsi:

```
pointerTarget(1343)   capturePolicy(1383)     isScrollable(1398)
findScrollTarget(1406) scrollState(1413)      sameScrollPosition(1449)
settleScroll(1455)    scrollTargetBy(1493)    scroll(1515)
```

```js
// @last-edited: 2026-10-29 UTC+7.
// @title: page-scroll — where the pointer goes, what a capture may see, and how a scroll settles.
// @state: nine functions moved verbatim from content.js; no state of its own; no chrome.* as code.
// @dependencies: ./page-kit.js, ./element-facts.js, ./page-wait.js (namespaces only).
```

Namespace `globalThis.OperaAgentPageScroll` berisi kesembilan nama itu.

- [ ] **Step 2: Hapus dari `content.js`, tambah satu baris**

```js
  const { pointerTarget, capturePolicy, isScrollable, findScrollTarget, scrollState, sameScrollPosition, settleScroll, scrollTargetBy, scroll } = globalThis.OperaAgentPageScroll;
```

- [ ] **Step 3: Daftarkan** — `"page-scroll.js",` setelah `"page-actions.js"`.

- [ ] **Step 4: Jalankan**

Run: `node --input-type=module -e "import {readFileSync} from 'node:fs'; const n=(f)=>((readFileSync(f,'utf8').match(/^\s*(?:async )?function \w+/gm))||[]).length; console.log('module', n('extension/page-scroll.js'), '| content', n('extension/content.js'));"`
Expected: `module 9 | content 14`.

Run: `npm test` → hanya gate ukuran dan urutan muat yang gagal.
Run: `npm run check` → `check ok`.

- [ ] **Step 5: Commit**

```bash
git add extension/page-scroll.js extension/content.js extension/manifest.json extension/worker/tab-content.js
git commit -m "Pindahkan pointer, kebijakan capture, dan scroll ke extension/page-scroll.js

Sembilan fungsi pindah verbatim, tanpa state: seluruh state-nya sudah berada di
region lain. Kebijakan capture ikut region ini karena ia menjawab pertanyaan
yang sama dengan scroll - apa yang boleh terlihat."
```

---

## Task 9: `page-media.js` — listen, media, watch

**Files:**
- Create: `extension/page-media.js`
- Modify: `extension/content.js`, kedua daftar injeksi

**Interfaces:**
- Consumes: `globalThis.OperaAgentPageKit`, `globalThis.OperaAgentPageWait`.
- Produces: `globalThis.OperaAgentPageMedia` — `mediaElement, listenArmedRecorder, listenStart, listenStop, mediaState, mediaAction, watchFacts, adShowingNow, mediaTimeNow, checkWatches, scheduleWatchCheck`, plus state `LISTEN_WINDOW_MS, listenCapture, watchRules, watchState, watchChecking, watchCheckQueued`.

- [ ] **Step 1: Ekstrak verbatim**

Sebelas fungsi:

```
mediaElement(1626)       listenArmedRecorder(1634)
listenStart(1680)        listenStop(1740)
mediaState(1755)         mediaAction(1776)
watchFacts(1807)         adShowingNow(1827)
mediaTimeNow(1834)       checkWatches(1839)
scheduleWatchCheck(1863)
```

Enam state: `LISTEN_WINDOW_MS(1630)`, `listenCapture(1632)`, `watchRules(1802)`, `watchState(1803)`, `watchChecking(1804)`, `watchCheckQueued(1805)`.

```js
// @last-edited: 2026-10-29 UTC+7.
// @title: page-media — the page's own media: listen, the media element, and the watches that report on both.
// @state: eleven functions moved verbatim from content.js, plus the six declarations that hold the recorder and the watch table.
// @dependencies: ./page-kit.js, ./page-wait.js (namespaces only).

// WHY THIS FILE CARRIES chrome.* AND THE OTHERS DO NOT.
// The listen chunks and the watch facts are reported to the service worker, and chrome.runtime.sendMessage is the only door from a page to its extension.
// That is one job, done in two places, and it is written down as the exception in tests/structure-gates.test.mjs rather than hidden by moving the calls somewhere they do not belong.
```

Namespace `globalThis.OperaAgentPageMedia` berisi kesebelas nama itu.

- [ ] **Step 2: Hapus dari `content.js`, tambah satu baris**

```js
  const { mediaElement, listenArmedRecorder, listenStart, listenStop, mediaState, mediaAction, watchFacts, adShowingNow, mediaTimeNow, checkWatches, scheduleWatchCheck } = globalThis.OperaAgentPageMedia;
```

Perhatian: `mutationObserver` (baris 67-71) memanggil `scheduleWatchCheck()`. Setelah pindah, pemanggilan itu tetap bekerja karena nama itu kini berasal dari destructuring namespace — **tidak ada baris yang perlu diubah**.

- [ ] **Step 3: Daftarkan** — `"page-media.js",` setelah `"page-scroll.js"`.

- [ ] **Step 4: Jalankan, termasuk bukti halaman**

Run: `node --input-type=module -e "import {readFileSync} from 'node:fs'; const n=(f)=>((readFileSync(f,'utf8').match(/^\s*(?:async )?function \w+/gm))||[]).length; console.log('module', n('extension/page-media.js'), '| content', n('extension/content.js'));"`
Expected: `module 11 | content 3` — tiga itu `markInstalled`, `handle`, `onMessage`: bootstrap dan dispatcher, yang memang tidak pindah.

Run: `npm test 2>&1 | Select-String -Pattern "^# (tests|pass|fail)|^not ok"`
Expected: **hijau penuh.** Gate ukuran lolos karena `content.js` kini di bawah 300 baris; gate urutan muat lolos karena keempatabelas path sudah pada tempatnya.

Run: `npm run check` → `check ok`.

Run: `py tests/browser_extension_test.py`
Expected: hijau. Ini bukti kedua dan terakhir: media, listen, dan watch bekerja di halaman sungguhan setelah modul terakhir pindah.

- [ ] **Step 5: Commit**

```bash
git add extension/page-media.js extension/content.js extension/manifest.json extension/worker/tab-content.js
git commit -m "Pindahkan listen, media, dan watch ke extension/page-media.js

Sebelas fungsi dan enam state pindah verbatim. Modul ini satu-satunya yang
membawa chrome.*: dua chrome.runtime.sendMessage untuk chunk listen dan
watch.facts, karena itu satu-satunya pintu dari halaman ke extension-nya.
Kecualikan itu tertulis di gerbang, bukan disembunyikan.

Suite hijau penuh setelah commit ini: content.js di bawah 300 baris, urutan
muat lengkap, dan py tests/browser_extension_test.py membuktikan listen, media,
dan watch masih hidup di halaman sungguhan."
```

---

## Task 10: Tutup lubang antara rencana dan kenyataan

**Files:**
- Modify: `docs/superpowers/specs/2026-10-29-content-script-split-design.md` (tabel angka)

**Interfaces:**
- Consumes: hasil Task 1-9.
- Produces: tabel angka di spec yang benar untuk pohon setelah pemindahan.

- [ ] **Step 1: Hitung ulang, dan perbaiki tabelnya**

Run:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const files = ['extension/content.js','extension/page-kit.js','extension/action-refs.js','extension/element-facts.js','extension/page-wait.js','extension/semantic-page.js','extension/page-actions.js','extension/page-scroll.js','extension/page-media.js'];
for (const f of files) console.log(f.padEnd(30), readFileSync(f,'utf8').split('\n').length, 'baris');
const manifest = JSON.parse(readFileSync('extension/manifest.json','utf8'));
console.log('content_scripts:', manifest.content_scripts[0].js.length, 'file');
"
```

Perbarui tabel *Fakta terverifikasi* dan bagian *Arsitektur* di spec dengan angka yang keluar — **bukan** angka yang ditulis saat spec disusun. Kalau berbeda, yang diperbaiki tabelnya dan alasannya dicatat, seperti spec 2026-10-09 minta.

- [ ] **Step 2: Buktikan tidak ada sisa nama state di `content.js`**

Run:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const c = readFileSync('extension/content.js','utf8');
const moved = ['refCounter','refs','reverseRefs','actionRefDescriptors','semanticRouteKey','semanticRuntimeEpoch','SENSITIVE_RE','GEOMETRY_DRIFT_TOLERANCE_PX','lastUserInputAt','NAV_KEYS','INTERACTIVE_SELECTOR','MAX_SHADOW_ROOTS','MAX_COLLECTED_NODES','EXPECT_VERIFY_WINDOW_MS','LISTEN_WINDOW_MS','listenCapture','watchRules','watchState','watchChecking','watchCheckQueued','PUA_GLYPH_RE','VISITED_SUFFIX_RE','MAX_TEXT_CHUNK','MAX_ELEMENTS','MAX_QUERY','MAX_LINKS'];
const bad = moved.filter(n => new RegExp('(?<![.\\\\w\$])'+n+'\\\\b').test(c));
console.log(bad.length ? 'MASIH ADA: ' + bad.join(', ') : 'bersih: tidak ada nama state modul yang tertinggal di content.js');
"
```

Expected: `bersih: tidak ada nama state modul yang tertinggal di content.js`.

Kalau ada yang tertinggal, itu **bukan** nama yang harus dihapus dari daftar — itu state yang masih dipakai dispatcher, dan tempatnya benar di `content.js`. Catat mana, dan perbarui tabel state di spec dengan alasannya.

- [ ] **Step 3: Jalankan suite penuh sekali lagi, dari nol**

Run: `npm test 2>&1 | Select-String -Pattern "^# (tests|pass|fail)"`
Run: `npm run check`

Expected: `# fail 0` dan `check ok`. Catat angka `# tests` — ia harus **lebih besar** dari 1634 karena tiga gate baru ditambah di Task 1.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-29-content-script-split-design.md
git commit -m "Perbarui angka spec setelah pemindahan selesai

Tabel fakta terverifikasi ditulis sebelum satu baris pun pindah; sekarang ia
menunjuk pohon yang sudah terpecah. Angka yang berbeda diperbaiki di tabel,
bukan langkahnya - itu aturan spec 2026-10-09 dan tetap berlaku di sini."
```

---

## Setelah rencana ini

Dua area berikutnya adalah rencana terpisah, bukan kelanjutan:

- `landing/dashboard.html` — 917 baris JS inline menjadi `landing/dashboard.js`, dan CSP halaman itu tidak lagi butuh hash karena `script-src 'self'` sudah ada.
- Sembilan edge function — 147 kemunculan setup yang sama menjadi satu `supabase/functions/_shared/edge-runtime.ts`.
