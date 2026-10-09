# Pecah `extension/background.js` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memecah `extension/background.js` (2647 baris) menjadi entry tipis ±460 baris plus 12 file baru, tanpa satu pun perubahan perilaku.

**Architecture:** Setiap region dideklarasikan dipindahkan utuh ke satu file baru, dengan kriteria tunggal yang terukur: `chrome.*` sebagai kode = 0 → `extension/lib/`, selain itu → `extension/worker/`. Impor bersiklus diterima (ESM mengizinkan selama pembacaan ada di dalam badan fungsi), dan celahnya ditutup oleh satu tes yang benar-benar mengimport `background.js`.

**Tech Stack:** Node.js 22 ESM, `node --test`, MV3 service worker (`manifest.background.type: "module"`), tanpa dependensi eksternal.

**Spec:** `docs/superpowers/specs/2026-10-09-background-modularization-design.md` — rencana ini berargumen dari spec; keduanya dibaca bersama.

## Global Constraints

- **Tanpa perubahan perilaku.** Tiap perpindahan diakhiri `npm test` **dan** `npm run check` keduanya hijau, bukan cuma salah satu.
- **Jumlah tes naik dari 726 (baseline) karena rencana menambah tes baru; angka terkini dicatat di ledger.** Yang tidak boleh berkurang adalah tes yang sudah ada — tidak ada tes yang dihapus.
- **Tiap task yang mengubah `extension/background.js` wajib menempel ulang hashnya di `tests/helpers/boundary-locks.mjs`, pada commit yang sama.** Kunci itu dicek dua berkas (`tests/boundary-locks.test.mjs` dan `tests/delta-first-observation.test.mjs:556`). Blok komentar re-pin berlaku sekali untuk seluruh pemecahan — cukup ganti nilai hashnya, jangan tambah blok baru. Lihat Task 7b.
- **`dispatch` tidak disentuh isinya.** Fungsinya dideklarasikan di `background.js` mulai baris 1647 pada baseline 66b96f0 (kini bergeser karena ekstraksi) dan tetap di `background.js` sampai selesai.
- **Nomor baris di rencana adalah koordinat baseline.** Setiap task memotong `background.js` dan menggeser semua angka setelahnya — Task 7 sudah menggesernya 6 baris. **Baca selalu ulang dari berkas terkini, dan verifikasi rentang potong lewat isinya, bukan lewat angkanya.**
- **File tidak di-rename.** `background.js` disebut 23 file, `content.js` 21, keduanya dikunci manifest.
- **Fungsi tidak di-rename.** 24 dari 100 fungsi dirujuk sebagai deklarasi di dalam string/regex di tests+scripts.
- **`content.js` tidak disentuh.** Ia tetap IIFE klasik satu file.
- **Delapan path klasik tidak boleh diubah** — `lib/agent-log.js`, `semantic-identity.js`, `semantic-views.js`, `role-reconcile.js`, `hover-settle.js`, `content.js` (array `background.js:232`, identik dengan `manifest.content_scripts[0].js`), plus `loop-decide.js`, `state-bridge.js` (array `background.js:1743`, di region `dispatch`, ikut tetap).
- **Aturan penempatan state:** state pindah ke modul yang memakainya; modul lain mengimpor dari sana; **arah impor tidak boleh membalik kecuali siklus yang sudah terdaftar di bawah.**
- **`background.js` < 600 baris** (target ±460); tiap modul baru < 550.
- **`extension/lib/*.js` tidak boleh memuat `chrome.<prop>` sebagai kode**, kecuali `debugger-session.js` yang tercatat di daftar kecualian.

## Satu penyimpangan dari spec — baca sebelum memulai

Spec menyatakan pindahan `serialize` tidak mengubah asersi apa pun. Analisis rencana menemukan hal yang tidak ditangkap spec:

`serializedResult` dideklarasikan `let` di `background.js:2036` (region `serialize`), dan **ditulis ulang di `background.js:2272`** — di dalam `executeCommand()`, region `execute-pull`. Dua region, dua file setelah pemisahan.

ESM **melarang** menulis ke binding impor; ini diverifikasi empiris, bukan diasumsikan:

```
$ node b.js        # import { x } from './a.js'; x = {...};
TypeError: Assignment to constant variable.
```

Jadi `serializedResult` tidak bisa sekadar diekspor. Keputusannya:

1. `extension/lib/serialize.js` memegang `serializedResult` sebagai modul-private dan mengekspor fungsi reset `clearSerializedResult()`.
2. `executeCommand()` memanggil `clearSerializedResult();` alih-alih mengassign.
3. **Satu baris asersi di `tests/hygiene.test.mjs` diperbarui** dari `/serializedResult = \{ value: null, text: '' \};/` menjadi `/clearSerializedResult\(\);/` — niatnya identik: memastikan `executeCommand` membuang memo sebelum menjalankan perintah.

Perilaku identik, tidak ada asersi yang dihapus, dan aturan gerbang `lib/` tetap tegas. Ini dikerjakan di **Task 8**, dengan langkahnya sendiri dan verifikasinya sendiri.

## Review Focus

Lima kegagalan yang bisa ditimbulkan rencana ini tetapi tidak diuji oleh tes yang sudah ada. Tiap baris ditanamkan tesnya di task yang memiliki kodenya.

1. **Listener tidak terdaftar.** Modul diekspor dengan benar tetapi tidak diimpor dari `background.js`, sehingga `chrome.runtime.onMessage` tak pernah mendaftar dan service worker tampak hidup padahal bisu. → Task 4 menghitung jumlah listener yang benar-benar terdaftar, bukan cuma "tidak melempar".
2. **TDZ saat load.** Sebuah modul worker membaca binding `const`/`let` milik `background.js` di top level → `ReferenceError` hanya saat startup, bukan saat `npm test` biasa. → Task 4 mengimport `background.js` yang asli dengan mock `chrome` dan membuktikan seluruh graf termuat.
3. **Referensi tak terpensi — dan tidak tertangkap saat load.** Sebuah modul memakai nama milik modul lain **di dalam badan fungsi** tanpa mengimpornya. Ini yang paling berbahaya: `npm test` hijau, `background-load.test.mjs` hijau (karena `import` hanya dievaluasi saat dibaca, bukan saat deklarasi), tapi `TypeError: X is not defined` muncul tepat saat orang pertama memakai fitur itu. Kelas ini **bukan teori** — penyusunan rencana ini baru menemukan tiga contohnya dengan memindai ulang kode:
   - `listen` membaca `HTTP_URL_RE` di `:480` tapi rencana awal tidak mengimpornya.
   - `capture-page` membaca `HTTP_URL_RE` di `:553`, celah yang sama.
   - `action-focus` membaca `loopSessions` di `:810` dan `stateSessions` di `:813`, sedangkan rencana awal hanya mengalihkan `finishLoop`/`finishStateLoop`.
   
   Kebalikannya juga gagal dengan cara yang sama diam: satu nama **didefinisikan dua kali**, lalu nilainya menyimpang. → Task 19 memeriksa arah yang ganda: tiap nama yang diekspor lintas-modul wajib muncul di blok impor setiap file yang memakainya, dan tiap nama didefinisikan **tepat sekali** di seluruh bundel.
4. **Anchor `indexOf` patah.** Sebuah slice jadi `indexOf → -1`, asersinya tetap lulus tapi tidak memeriksa apa pun — kejadian nyata di `hygiene.test.mjs:303`, menutupi 74% file. → Task 5 memeriksa daftar anchor yang diketahui lintas-modul terpecahkan dan berurutan.
5. **Daftar injeksi `content.js` bergeser.** Array enam file di `ensureContent` tak lagi sama dengan `manifest.content_scripts[0].js`, sehingga injeksi runtime berhenti menemukan file dan konten pingsan diam-diam. → Task 5 membandingkan keduanya secara langsung.

---

### Task 1: Perbaiki anchor mati di `hygiene.test.mjs`

**Files:**
- Modify: `tests/hygiene.test.mjs:303`

**Interfaces:**
- Consumes: `extension/background.js:749` — satu-satunya komentar `// Action Pipeline:` di seluruh file.
- Produces: anchor yang valid untuk slice `withForegroundFocusGate`; dipakai ulang oleh Task 5 saat sumber teks berganti ke bundel.

- [ ] **Step 1: Tulis tes yang membuktikan bloknya benar**

Tambahkan di `tests/hygiene.test.mjs`, tepat sebelum test `the focus gate loop is bounded by construction`:

```js
test('the focus-gate slice is a real block, not the whole file', () => {
  const start = background.indexOf('async function withForegroundFocusGate');
  const end = background.indexOf('// Action Pipeline');
  assert.ok(start > 0, 'withForegroundFocusGate must exist');
  assert.ok(end > start, 'the section marker must come after the function');
  const block = background.slice(start, end);
  assert.ok(block.split('\n').length >= 30 && block.split('\n').length <= 40,
    `expected a single function, got ${block.split('\n').length} lines`);
});
```

- [ ] **Step 2: Jalankan dan lihat GAGAL**

Run: `node --test tests/hygiene.test.mjs`
Expected: FAIL — `// U-V Action Pipeline` tidak ada, `end` jadi `-1`, `assert.ok(end > start)` melempar.

- [ ] **Step 3: Perbaiki anchor**

Di `tests/hygiene.test.mjs:303`, ganti:

```js
    background.indexOf('// U-V Action Pipeline')
```

menjadi:

```js
    background.indexOf('// Action Pipeline')
```

- [ ] **Step 4: Jalankan dan lihat LULUS**

Run: `node --test tests/hygiene.test.mjs`
Expected: PASS. Tes blok baru melapor 33 baris (diverifikasi terhadap pohon bersih: `slice(30759, 32073)` = 1314 karakter, 33 baris, dan ketiga asersi `doesNotMatch /for \([^;]*;\s*;/`, `match` loop `attempt <= FOCUS_GATE_ATTEMPTS`, `match` `FOCUS_GATE_SETTLE_MS` bernilai true atas blok itu).

- [ ] **Step 5: Commit**

```bash
git add tests/hygiene.test.mjs
git commit -m "test: point the focus-gate slice at a marker that exists"
```

---

### Task 2: Hidupkan verifikasi `boundary-locks`

**Files:**
- Create: `tests/boundary-locks.test.mjs`
- Modify: `tests/helpers/boundary-locks.mjs` (4 hash + komentar re-pin)

**Interfaces:**
- Consumes: `PUBLIC_SURFACE_LOCKS`, `OBSERVATION_STACK_LOCKS`, `RELEVANCE_STACK_LOCKS` — sudah diekspor, belum pernah dipakai untuk dua yang terakhir.
- Produces: tes yang menjaga sembilan hash tetap segar setiap kali berkasnya berubah.

Konteks yang harus dipahami sebelum menyentuh file ini, karena menyesatkan kalau tidak:

- Ada **3 array, 9 entri** total: `PUBLIC_SURFACE_LOCKS` (4), `OBSERVATION_STACK_LOCKS` (3), `RELEVANCE_STACK_LOCKS` (2).
- Hanya `PUBLIC_SURFACE_LOCKS` yang diimpor (oleh `delta-first-observation.test.mjs`) — dan keempat hash-nya **masih segar**.
- Dua array lain **tidak diimpor siapa pun**, jadi kelima hash di dalamnya tak pernah diperiksa, dan **4 di antaranya basi**: `../lib/reactive-vm.js`, `../lib/reactive-vm-control-flow.js`, `../lib/reactive-vm-collect.js`, `../lib/multi-signal-relevance.js`.
- **Path di-resolve relatif ke file pemanggil**, bukan relatif helper: `delta-first-observation.test.mjs:560` memakai `new URL(relativePath, import.meta.url)` dari `tests/`. Karena itu pemeriksaan baru harus berada di `tests/`, bukan `tests/helpers/`.
- Hash dihitung sebagai **git blob SHA1 atas byte LF**; checkout Windows ber-CRLF harus dinormalkan dulu, kalau tidak hasilnya menyesatkan (verifikasi: tanpa normalisasi, `manifest.json` dan 4 file lain terlihat basi padahal segar).

- [ ] **Step 1: Tulis tesnya dan jalankan — 4 hash akan GAGAL**

Buat `tests/boundary-locks.test.mjs`:

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: boundary-locks — every frozen hash is checked, not just the public surface.
// @state: pins the three lock arrays exported by helpers/boundary-locks.mjs; a stale hash fails here instead of drifting silently.
// @dependencies: node:test, strict, node:crypto, promises, helpers/boundary-locks.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  PUBLIC_SURFACE_LOCKS,
  OBSERVATION_STACK_LOCKS,
  RELEVANCE_STACK_LOCKS,
} from './helpers/boundary-locks.mjs';

function sha1Blob(bytes) {
  // git blob hash of the committed LF bytes; strip checkout-added CR so
  // autocrlf checkouts hash identically to CI.
  const content = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha1').update(Buffer.from(`blob ${content.length}\0`)).update(content).digest('hex');
}

for (const [label, locks] of [
  ['public surface', PUBLIC_SURFACE_LOCKS],
  ['observation stack', OBSERVATION_STACK_LOCKS],
  ['relevance stack', RELEVANCE_STACK_LOCKS],
]) {
  test(`${label} pins stay byte-for-byte unchanged`, async () => {
    for (const [relativePath, expected] of new Map(locks)) {
      const bytes = await readFile(new URL(relativePath, import.meta.url));
      assert.equal(sha1Blob(bytes), expected, `${relativePath} must remain byte-for-byte unchanged`);
    }
  });
}
```

Run: `node --test tests/boundary-locks.test.mjs`
Expected: FAIL — 4 kasus `AssertionError` dengan `must remain byte-for-byte unchanged` untuk `reactive-vm.js`, `reactive-vm-control-flow.js`, `reactive-vm-collect.js`, `multi-signal-relevance.js`.

- [ ] **Step 2: Ambil ulang empat hash**

Run perintah berikut dan catat hasilnya:

```bash
node -e "
const {createHash}=require('crypto'),fs=require('fs');
for (const p of ['lib/reactive-vm.js','lib/reactive-vm-control-flow.js','lib/reactive-vm-collect.js','lib/multi-signal-relevance.js']) {
  const b=fs.readFileSync(p);
  const c=Buffer.from(b.toString('utf8').replace(/\r\n/g,'\n'),'utf8');
  console.log(p, createHash('sha1').update('blob '+c.length+'\0').update(c).digest('hex'));
}"
```

- [ ] **Step 3: Tempel hash baru dan tulis catatan re-pin**

Di `tests/helpers/boundary-locks.mjs`, ganti keempat hash lama dengan hasil Step 2, lalu tambahkan blok komentar berikut setelah blok `Re-pinned 2026-10-09` yang sudah ada (sebaris sebelum `export const PUBLIC_SURFACE_LOCKS`):

```
// Re-pinned 2026-10-09 for the background.js split spec. No contract moved:
// the observation and relevance stacks had never been asserted — nothing
// imported their two arrays — and four of their five pins had gone stale
// unnoticed. This test now checks all nine entries, so a drift fails here.
// Hashes are git blob SHA1 over LF bytes; a CRLF checkout normalizes first.
```

- [ ] **Step 4: Jalankan dan lihat LULUS**

Run: `node --test tests/boundary-locks.test.mjs`
Expected: PASS — 3 tes.

- [ ] **Step 5: Jalankan suite penuh dan commit**

```bash
npm test
npm run check
git add tests/boundary-locks.test.mjs tests/helpers/boundary-locks.mjs
git commit -m "test: assert all nine boundary locks, re-pin four stale hashes"
```

Expected: `# pass 729` (726 baseline + 3 tes baru), `# fail 0`, `check ok`.

Yang wajib diperiksa bukan angka itu sendiri, melainkan dua hal: tidak ada tes yang **berkurang** dari baseline 726, dan `tests/boundary-locks.test.mjs` melapor PASS untuk ketiga array. Kalau keluaran `npm test` menunjukkan angka lain, catat angka sebenarnya — keluaran mesin mengalahkan angka di halaman ini.

---

### Task 3: Ganti sebelas baris boilerplate `@state`/`@title`

**Files:**
- Modify: `extension/lib/` — 11 file
- Test: `tests/hygiene.test.mjs` (tambahkan satu tes)

**Interfaces:**
- Consumes: tidak ada.
- Produces: tidak ada; murni komentar. Satu-satunya tugasnya membuat header file menyatakan isi file.

Kesalahan fakta yang harus diketahui: spec menyebut "sembilan baris `@state` identik" — hitungannya salah, dan rencana ini awalnya mengulanginya. Hitungan sebenarnya **20 baris di 11 file**, dalam dua pola berbeda:

| file | baris | field yang kena |
|---|---|---|
| `agent-log.js`, `ax-summary.js`, `endpoints.js`, `external-origins.js`, `focus-gate.js`, `keyboard.js`, `popup-events.js`, `protocol.js`, `watch.js` (9 file) | 2 **dan** 3 | `@title` (sebagai akhiran setelah `"nama — "`) **dan** `@state` (murni boilerplate) |
| `action-pipeline.js`, `options-store.js` (2 file) | 2 | `@title` **saja** — `@state` keduanya sudah berisi keterangan yang benar |

Teks yang dihapus: `MV3 runtime library, shared with the Node suite..` (perhatikan titik ganda). Tesnya berbasis file (`text.includes(...)`), jadi ia melaporkan 11 nama file meski barisnya 20 — itu memang benar untuk tes ini.

- [ ] **Step 1: Tulis tesnya dan jalankan — 11 file akan GAGAL**

Tambahkan ke `tests/hygiene.test.mjs`:

```js
test('every lib header states what is actually in the file', async () => {
  const boilerplate = 'MV3 runtime library, shared with the Node suite..';
  const dir = new URL('../extension/lib/', import.meta.url);
  const names = (await readdir(dir)).filter((n) => n.endsWith('.js')).sort();
  assert.ok(names.length >= 17, 'the lib directory must not be empty');
  const offenders = [];
  for (const name of names) {
    const text = await readFile(new URL(name, dir), 'utf8');
    if (text.includes(boilerplate)) offenders.push(name);
  }
  assert.deepEqual(offenders, [],
    `boilerplate header must be replaced with a description of the file: ${offenders.join(', ')}`);
});
```

Tambahkan impor yang belum ada di berkas itu:

```js
import { readdir } from 'node:fs/promises';
```

Run: `node --test tests/hygiene.test.mjs`
Expected: FAIL — 11 nama file terdaftar.

- [ ] **Step 2: Ganti dua puluh baris boilerplate di sebelas file**

**Aturan yang tidak boleh dilanggar: ganti hanya teks yang memuat boilerplate.** `@state` yang sudah berisi keterangan benar harus dibiarkan persis apa adanya — menulis ulangnya akan memasukkan keterangan salah ke dalam kode.

Baca tiap file sebelum menulis. Jangan mengarang isi dari nama filenya.

**Sembilan file (kedua baris berganti).** Contoh `extension/lib/agent-log.js`:

```js
// @title: agent-log — the no-export logger that classic scripts and the worker share.
// @state: level-aware console sink published on globalThis; deliberately has no export so manifest content_scripts can load it as a classic script.
```

**Dua file (`action-pipeline.js`, `options-store.js`: hanya `@title` yang diganti).** `@state` mereka sudah benar dan tidak disentuh. Sebagai pembanding, `options-store.js:3` kini berbunyi *"The bridge URL, log level, and the user's own model endpoint, name and key, kept in local storage"* — dan itu akurat karena file ini memakai `chrome.storage.local`, bukan `sync`. Keterangan seperti itu yang harus bertahan.

Sisanya mengikuti pola yang sama: satu kalimat judul, satu kalimat isi. Jangan mengulang "shared with the Node suite", dan pastikan tidak ada `..` ganda yang tersisa di baris mana pun.

- [ ] **Step 3: Jalankan dan lihat LULUS**

Run: `node --test tests/hygiene.test.mjs`
Expected: PASS.

- [ ] **Step 4: Verifikasi tidak ada yang merusak**

Run: `npm test`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add extension/lib tests/hygiene.test.mjs
git commit -m "docs: make every lib header say what the file contains"
```

---

### Task 4: Tes load `background.js` dengan mock `chrome`

**Files:**
- Create: `tests/background-load.test.mjs`

**Interfaces:**
- Consumes: `extension/background.js` apa adanya, diimpor sebagai modul ESM sungguhan.
- Produces: baseline bahwa graf modul termuat. Tes ini menjadi **kondisi selamat** untuk semua Task 7-18 — kalau ia gagal setelah sebuah pemindahan, pemindahan itu salah.

Inilah celah yang ditutup rencana ini: saat ini **nol** tes mengimport `background.js`; ke-17 yang membacanya memakai `readFileSync`. Ekspor yang salah tempat, impor yang putus, atau siklus yang gagal lolos dari seluruh suite dan baru meledak di browser.

Mock harus menutup **12 pernyataan `chrome.*` top-level** — ini daftar lengkapnya, diverifikasi dengan pemindai kedalaman-0:

```
69    chrome.debugger.onDetach.addListener
793   chrome.tabs.onCreated.addListener
803   chrome.tabs.onRemoved.addListener
2516  chrome.runtime.onMessageExternal?.addListener
2535  chrome.runtime.onMessage.addListener
2595  chrome.runtime.onInstalled.addListener
2604  chrome.runtime.onStartup.addListener
2610  chrome.alarms.onAlarm.addListener
2615  chrome.storage.onChanged.addListener
2622  chrome.tabs.onUpdated.addListener
2632  chrome.tabs.onRemoved.addListener
2645  chrome.alarms.create(...)  -> harus mengembalikan Promise dengan .catch
```

Jalur unpaired sudah diverifikasi, jadi tidak ada jaringan dan tidak ada loop menggantung: `pullLoop` (`:2434`) menguji `!cfg.paired || !cfg.deviceToken` lalu `return` sebelum `try`; `ensurePullLoop().finally` (`:2461-2465`) hanya memanggil `setTimeout` kalau `cfg.paired && cfg.deviceToken`. Dengan `get → {}`, keduanya tidak pernah memicu apa pun.

- [ ] **Step 1: Tulis mock dan tesnya**

Buat `tests/background-load.test.mjs`:

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: background-load — the service worker graph actually loads.
// @state: imports the real extension/background.js under a chrome mock; the only test that can catch a broken export, a severed import, or an import cycle that will not evaluate.
// @dependencies: node:test, strict, extension/background.js.

import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = { counts: {} };
function event(name) {
  const fns = [];
  listeners[name] = fns;
  return { addListener: (fn) => fns.push(fn), removeListener: (fn) => {
    const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1);
  } };
}

globalThis.chrome = {
  debugger: { onDetach: event('debugger.onDetach') },
  tabs: {
    onCreated: event('tabs.onCreated'),
    onRemoved: event('tabs.onRemoved'),
    onUpdated: event('tabs.onUpdated'),
  },
  runtime: {
    onMessage: event('runtime.onMessage'),
    onMessageExternal: event('runtime.onMessageExternal'),
    onInstalled: event('runtime.onInstalled'),
    onStartup: event('runtime.onStartup'),
  },
  alarms: {
    onAlarm: event('alarms.onAlarm'),
    create: async () => {},
  },
  storage: {
    onChanged: event('storage.onChanged'),
    local: { get: async () => ({}), set: async () => {} },
    sync: { get: async () => ({}), set: async () => {} },
  },
  scripting: { executeScript: async () => [] },
  windows: { getCurrent: async () => ({ id: 1 }) },
};

test('the service worker module graph evaluates without throwing', async () => {
  await assert.doesNotReject(() => import('../extension/background.js'),
    'importing background.js must not throw');
});

test('the load-time listeners actually registered', () => {
  // Dua listener tabs.onRemoved: action-focus (popupLog) dan execute-pull (screenshotCache).
  assert.equal(listeners['runtime.onMessage'].length, 1, 'exactly one onMessage handler');
  assert.equal(listeners['tabs.onRemoved'].length, 2, 'both tabs.onRemoved handlers register');
  assert.equal(listeners['debugger.onDetach'].length, 1, 'the debugger detach handler registers');
  assert.equal(listeners['alarms.onAlarm'].length, 1, 'the wake alarm handler registers');
  assert.ok(listeners['tabs.onCreated'].length >= 1, 'the tab-drag gate registers');
  assert.ok(listeners['runtime.onInstalled'].length >= 1, 'onInstalled registers');
});
```

- [ ] **Step 2: Jalankan dan lihat LULUS**

Run: `node --test tests/background-load.test.mjs`
Expected: PASS — 2 tes.

Kalau gagal dengan `ReferenceError: X is not defined`, berarti sebuah binding dibaca saat load; kalau `does not provide an export named`, berarti ekspor salah. Keduanya adalah temuan nyata — perbaiki `background.js`, jangan kendurkan tes.

- [ ] **Step 3: Pastikan mock tidak bocor ke tes lain**

Run: `npm test`
Expected: `# fail 0`. `node --test` menjalankan tiap berkas dalam proses terpisah, jadi `globalThis.chrome` tidak menyeberang.

- [ ] **Step 4: Commit**

```bash
git add tests/background-load.test.mjs
git commit -m "test: import the real background.js and prove its listeners register"
```

---

### Task 5: Bundle helper + alihkan 17 pembaca

**Files:**
- Create: `tests/helpers/extension-source.mjs`
- Create: `tests/extension-source.test.mjs`
- Modify: 17 berkas — satu baris masing-masing (daftar lengkap di Step 3)

**Interfaces:**
- Consumes: `extension/background.js`; setelah Task 7-18, juga 12 modul baru.
- Produces: `extensionSource()` yang mengembalikan `Promise<string>` — seluruh sumber worker dalam urutan tetap. Semua asersi `indexOf`/`slice` berikutnya bekerja di atas string ini.

Urutan dibatasi oleh dua syarat, dan keduanya sudah diverifikasi terhadap pemakaian `indexOf` nyata di ke-17 berkas:

- `lib/serialize.js` **harus sebelum** `worker/watch-registry.js` — `hygiene.test.mjs:276` menyatukan `function boundedResult` → `// ---- Event-Triggered Workflows`, satu-satunya pasangan `indexOf` lintas modul di seluruh suite.
- `worker/execute-pull.js` **harus terakhir** — `hygiene.test.mjs:295` memotong `async function executeCommand` tanpa batas kedua, jadi harus menutup file.

Semua sisanya satu-anchor tunggal atau berada di dalam satu modul.

- [ ] **Step 1: Tulis helper**

Buat `tests/helpers/extension-source.mjs`:

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: extension-source — every source file the worker graph spans, in one string.
// @state: order is load-bearing — serialize before watch-registry, execute-pull last; both are asserted by extension-source.test.mjs.
// @dependencies: node:fs/promises.

import { readFile } from 'node:fs/promises';

const FILES = [
  'extension/background.js',
];

export async function extensionSource() {
  const parts = await Promise.all(FILES.map(
    (rel) => readFile(new URL(`../../${rel}`, import.meta.url), 'utf8'),
  ));
  return parts.join('\n');
}

export function extensionSourceFiles() {
  return [...FILES];
}
```

- [ ] **Step 2: Tulis tes helper — daftar urutan**

Buat `tests/extension-source.test.mjs`:

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: extension-source — the bundle order keeps every slice anchor valid.
// @state: pins the two ordering constraints and proves the bundle equals background.js exactly, before any module has moved.
// @dependencies: node:test, strict, node:fs/promises, helpers/extension-source.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extensionSource, extensionSourceFiles } from './helpers/extension-source.mjs';

test('the bundle equals background.js exactly while nothing has moved', async () => {
  const raw = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.equal(await extensionSource(), raw,
    'with only one file listed the bundle must be byte-identical to background.js');
});

test('the bundle order keeps every cross-module indexOf anchor valid', async () => {
  const src = await extensionSource();
  const files = extensionSourceFiles();
  const idx = (name) => files.indexOf(name);

  // serialize sebelum watch-registry: hygiene menyatukan pasangan ini.
  if (files.includes('extension/lib/serialize.js') && files.includes('extension/worker/watch-registry.js')) {
    assert.ok(idx('extension/lib/serialize.js') < idx('extension/worker/watch-registry.js'),
      'serialize must precede watch-registry');
    assert.ok(src.indexOf('function boundedResult') >= 0, 'boundedResult must be in the bundle');
    assert.ok(src.indexOf('// ---- Event-Triggered Workflows') > src.indexOf('function boundedResult'),
      'the watch section marker must follow boundedResult');
  }

  // execute-pull terakhir: hygiene memotong executeCommand tanpa batas kedua.
  if (files.includes('extension/worker/execute-pull.js')) {
    assert.equal(idx('extension/worker/execute-pull.js'), files.length - 1,
      'execute-pull must be last so its slice runs to the end of the bundle');
  }

  // Anchor yang selalu ada — menangkap kasus seperti U-V yang memotong -1.
  for (const anchor of [
    'async function executeCommand',
    'async function withForegroundFocusGate',
    '// Action Pipeline',
    'function boundedResult',
    'function oversized',
    '// ---- Event-Triggered Workflows',
  ]) {
    assert.ok(src.indexOf(anchor) > 0, `anchor must exist in the bundle: ${anchor}`);
  }
});
```

- [ ] **Step 3: Jalankan tes helper**

Run: `node --test tests/extension-source.test.mjs`
Expected: PASS — 2 tes (dengan satu file, kedua blok kondisional dilewati; daftar enam anchor tetap diperiksa).

- [ ] **Step 4: Alihkan 17 pembaca — satu baris per berkas**

Di tiap berkas berikut, ganti pembacaan langsung menjadi helper. Bentuknya selalu sama; hanya nama variabel yang berbeda.

| berkas | variabel | dari | menjadi |
|---|---|---|---|
| `scripts/check.mjs` | `background` | `fs.readFileSync(...)` | `await extensionSource()` |
| `tests/action-pipeline.test.mjs` | `background` | idem | idem |
| `tests/ax-observation.test.mjs` | `background` | idem | idem |
| `tests/burst-atomic-actions.test.mjs` | `src` | idem | idem |
| `tests/burst-tab-switching.test.mjs` | `background` | idem | idem |
| `tests/debugger-session-lifecycle.test.mjs` | `background` | idem | idem |
| `tests/efficiency.test.mjs` | `background` | idem | idem |
| `tests/endpoint-source.test.mjs` | `bg` | idem | idem |
| `tests/etw-watch-engine.test.mjs` | `bg` | idem | idem |
| `tests/focus-and-keyboard.test.mjs` | `source` | idem | idem |
| `tests/hover-settle.test.mjs` | `source` | idem | idem |
| `tests/hygiene.test.mjs` | `background` | idem | idem |
| `tests/landing-claims.test.mjs` | `background` | idem | idem |
| `tests/model-client.test.mjs` | `bg` | idem | idem |
| `tests/role-reconcile.test.mjs` | `background`, `source` | idem | idem (dua tempat) |
| `tests/timeout-retry-popup-parity.test.mjs` | `bg` | idem | idem |
| `tests/workflow-dsl.test.mjs` | `background` | idem | idem |

Pola untuk berkas yang memakai `fs.readFileSync` sinkron:

```js
import { extensionSource } from './helpers/extension-source.mjs';
// ...
const background = await extensionSource();
```

Pola untuk berkas yang sudah memakai `readFile` async:

```js
import { extensionSource } from './helpers/extension-source.mjs';
// ...
const source = await extensionSource();
```

`scripts/check.mjs` memakai `./helpers/extension-source.mjs` (satu tingkat naik dari `tests/`) — kalau path itu tidak cocok, salinan helper untuk skrip bukanlah jawabannya; pindahkan helper ke lokasi yang keduanya bisa jangkau dan sesuaikan impor kedua belah pihak dalam langkah yang sama.

`tests/role-reconcile.test.mjs` membaca `background.js` pada **dua** tempat (baris 185 dan 197) — keduanya harus dialihkan.

- [ ] **Step 5: Jalankan suite penuh**

Run: `npm test`
Expected: `# fail 0`, dan jumlah tes naik (Task 5 menambah 2).

Ini ujian penting: kalau ada asersi `doesNotMatch` yang berubah arti karena kini memeriksa lebih banyak kode, ia akan gagal **di sini**, belum setelah modul dipindah. Kegagalan berarti temuan nyata — perbaiki kodenya, jangan perkecil bundelnya.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/extension-source.mjs tests/extension-source.test.mjs scripts/check.mjs tests/*.test.mjs
git commit -m "test: read the worker source through one ordered bundle helper"
```

---

### Task 5b: Buat tes identitas bundel tahan lama

**Files:**
- Modify: `tests/extension-source.test.mjs` (satu tes)

**Interfaces:**
- Consumes: `extensionSource`, `extensionSourceFiles`.
- Produces: tidak ada.

**Kesalahan fakta yang ditemukan setelah Task 5:** tes pertama
`tests/extension-source.test.mjs` memakai `assert.equal(bundel, background.js)`
dengan pesan *"with only one file listed the bundle must be byte-identical"*.
Ia benar hari ini dan akan **salah pada Task 7** — begitu `extension/lib/log.js`
ditambahkan ke `FILES`, bundel menjadi `background.js + '\n' + log.js`, dan
tes itu merah selama dua belas task. Rencana ini tidak memberi tugas apa pun
kepada Task 7-18 untuk membetulkannya, jadi suite akan merah tanpa ada yang
tahu itu disengaja — cacat yang sama persis dengan gerbang ukuran Task 6, dan
sama-sama melanggar Global Constraints.

Nilai tes itu sebenarnya ada dua, dan keduanya bertahan lama bila dirumuskan
ulang: (a) helper membaca **file yang benar** dengan **encoding yang benar**,
(b) `background.js` selalu **urutan pertama** di `FILES`. Identitas byte penuh
hanya menguji keduanya selama array berisi satu entri.

- [ ] **Step 1: Ganti satu tes**

```js
test('the helper reads background.js itself, and lists it first', async () => {
  const raw = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  const files = extensionSourceFiles();
  assert.equal(files[0], 'extension/background.js',
    'background.js must stay the first entry; every anchor is measured from it');
  const bundle = await extensionSource();
  assert.ok(bundle.startsWith(raw),
    'the bundle must begin with background.js byte-for-byte — a wrong path, a '
    + 'wrong encoding, or a reordered FILES array all break this');
});
```

`startsWith` adalah bentuk dari klaim identitas byte yang tetap benar ketika
modul ditambahkan: ia gagal kalau helper menunjuk file lain, memakai encoding
lain, atau `FILES` dibalik — dan ia tidak pernah gagal hanya karena ada modul
kedua. Hapus tes `the bundle equals background.js exactly while nothing has
moved` dan baris `@state: ... before any module has moved.` di kepala berkas
(ubah menjadi keterangan yang sesuai dengan isi berkas sekarang).

- [ ] **Step 2: Jalankan**

```bash
node --test tests/extension-source.test.mjs
npm test
npm run check
```

Expected: PASS, `# fail 0`, `check ok`. Jumlah tes tidak berubah (satu tes
diganti satu tes) — 735 saat task ini dijalankan.

- [ ] **Step 3: Commit**

```bash
git add tests/extension-source.test.mjs
git commit -m "test: keep the bundle check true once a second file is listed"
```

---

### Task 6: Gerbang struktural

**Files:**
- Create: `tests/structure-gates.test.mjs`

**Interfaces:**
- Consumes: `extension/lib/*.js`, `extension/worker/*.js` (belum ada saat Task 6 berjalan — tesnya harus lulus dengan ketiadaan).
- Produces: tiga gerbang yang menolak pemindahan yang melanggar aturan: `lib/` bebas `chrome.*`, ukuran file, keberadaan modul.

Gerbang `lib/` harus **pecah komentar dan string** — kalau tidak, hitungannya salah dua arah. Terbukti: pemindai sembrono melaporkan `debugger-session.js:59` padahal itu baris JSDoc, `external-origins.js:2` dan `options-store.js:7` padahal itu teks kepala berkas, dan di `background.js` persis **satu** baris — `:455`, komentar `// WHY element capture and not tab capture: chrome.tabCapture refuses callers` — yang membuat hitungan sembrono jadi 107 alih-alih 106. Pemindai yang benar menghasilkan `background.js = 106` (persis angka spec) dan `lib = 1` di `debugger-session.js:51`.

Dua batas pemindai yang diketahui, supaya tidak dikira lolos tanpa diperiksa: ia mengenali `chrome.` dan `globalThis.chrome.`, tetapi **bukan** `chrome['storage']` maupun `const { storage } = chrome;` (hari ini tak ada satu pun di pohon). Sebuah literal regex yang memuat tanda kutip juga membuka status string yang tidak pernah ditutup sehingga sisa berkas jadi tak terlihat (hari ini pun tak ada yang begitu).

- [ ] **Step 1: Tulis gerbangnya**

Buat `tests/structure-gates.test.mjs`:

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: structure-gates — the split's rules are enforced, not remembered.
// @state: chrome-free lib with one written exception, size ceilings, and a complete worker module set.
// @dependencies: node:test, strict, node:fs/promises.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

// Buang komentar dan string, pertahankan jumlah baris supaya nomor baris akurat.

function stripCommentsAndStrings(text) {
  let out = '';
  let i = 0;
  const keep = (s) => (s.match(/\n/g) || ['']).join('');
  while (i < text.length) {
    const c = text[i];
    const c2 = text.slice(i, i + 2);
    if (c2 === '//') { const s = i; while (i < text.length && text[i] !== '\n') i++; out += keep(text.slice(s, i)); continue; }
    if (c2 === '/*') { const s = i; i += 2; while (i < text.length && text.slice(i, i + 2) !== '*/') i++; i += 2; out += keep(text.slice(s, i)); continue; }
    if (c === '"' || c === "'" || c === '`') { const q = c; const s = i; i++; while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; } i++; out += '""' + keep(text.slice(s, i)); continue; }
    out += c; i++;
  }
  return out;
}

function chromeCodeLines(text) {
  const clean = stripCommentsAndStrings(text);
  const hits = [];
  let idx = 0;
  while ((idx = clean.indexOf('chrome.', idx)) !== -1) {
    const m = clean.slice(idx + 7, idx + 67).match(/^[A-Za-z_$][\w$]*/);
    if (m) hits.push(clean.slice(0, idx).split('\n').length);
    idx += 7;
  }
  return hits;
}

const CHROME_FREE_EXCEPTIONS = new Set(['debugger-session.js']);

test('extension/lib is free of chrome.* as code, except the written exception', async () => {
  const dir = new URL('extension/lib/', root);
  const names = (await readdir(dir)).filter((n) => n.endsWith('.js')).sort();
  const offenders = [];
  for (const name of names) {
    if (CHROME_FREE_EXCEPTIONS.has(name)) continue;
    const hits = chromeCodeLines(await readFile(new URL(name, dir), 'utf8'));
    if (hits.length) offenders.push(`${name}:${hits.join(',')}`);
  }
  assert.deepEqual(offenders, [],
    'lib/ must stay testable without a browser; move the file to extension/worker/ instead');
});

test('the documented chrome.* exception is still real', async () => {
  // Kalau debugger-session.js berhenti memakai chrome, kecualiannya harus dihapus.
  const text = await readFile(new URL('extension/lib/debugger-session.js', root), 'utf8');
  assert.ok(chromeCodeLines(text).length > 0,
    'debugger-session.js no longer uses chrome.*; drop it from CHROME_FREE_EXCEPTIONS');
});

test('worker modules stay under their ceiling, and background.js does not grow', async () => {
  // Selama ekstraksi berjalan, background.js hanya boleh menyusut — bukan membesar.
  // Ambang < 600 dipasang di Task 18, pada saat ia bisa ditegakkan; memasangnya di
  // sini akan membuat suite merah selama dua belas task berturut-turut dan setiap
  // implementer tidak akan bisa membedakan kegagalan sendiri dari kegagalan ini.
  const bg = await readFile(new URL('extension/background.js', root), 'utf8');
  assert.ok(bg.split('\n').length <= 2647,
    `background.js grew to ${bg.split('\n').length} lines; the split must only remove code`);

  const worker = new URL('extension/worker/', root);
  let names = [];
  try { names = (await readdir(worker)).filter((n) => n.endsWith('.js')).sort(); } catch { names = []; }
  for (const name of names) {
    const text = await readFile(new URL(name, worker), 'utf8');
    assert.ok(text.split('\n').length < 550,
      `${name} exceeds 550 lines: ${text.split('\n').length}`);
  }
});
```

- [ ] **Step 2: Jalankan dan lihat SEMUA LULUS**

Run: `node --test tests/structure-gates.test.mjs`
Expected: PASS — 3 tes (17 file lib bebas `chrome.*` dengan satu kecualiannya yang nyata, tes kecualiannya sendiri, dan tes ukuran).

Tidak ada yang merah di sini, dan itu disengaja. Global Constraints menuntut `npm test` **dan** `npm run check` hijau setelah *setiap* perpindahan; suite yang merah selama dua belas task akan menghapuskan sinyal kegagalan itu.

- [ ] **Step 3: Commit**

```bash
git add tests/structure-gates.test.mjs
git commit -m "test: enforce the lib chrome-free rule and worker module ceilings"
```

---

### Task 7: `extension/lib/log.js`

**Files:**
- Create: `extension/lib/log.js`
- Modify: `extension/background.js:49-55`
- Modify: `tests/helpers/extension-source.mjs` (tambah satu entri)

**Interfaces:**
- Consumes: `extension/lib/agent-log.js` (side-effect, menerbitkan `globalThis.OperaAgentLog`).
- Produces: `export const log` — objek logger. Diimpor oleh hampir semua modul berikutnya.

- [ ] **Step 1: Buat modulnya**

Buat `extension/lib/log.js`:

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: log — one shared logger handle for every module in the worker graph.
// @state: re-exports the global agent-log.js publishes; chrome-free, so it belongs in lib/ beside its own source.
// @dependencies: agent-log.js.

import './agent-log.js';

export const log = globalThis.OperaAgentLog || {};
if (typeof log.warn !== 'function') throw new Error('Agent log runtime is unavailable.');
```

`agent-log.js` diverifikasi nol `chrome.*` dan nol `export` — pola itu yang membuatnya tidak boleh diberi `export` (akan jadi sintaks error di `manifest.content_scripts`). `lib/log.js` adalah pembungkus ESM yang tidak pernah dimuat sebagai skrip klasik.

- [ ] **Step 2: Ganti bootstrap di `background.js`**

Hapus baris 49-55 (empat baris komentar, `import './lib/agent-log.js';`, `const log = ...`, dan `if (typeof log.warn ...)`), lalu gantikan dengan satu baris:

```js
import { log } from './lib/log.js';
```

Baris 46 `import './role-reconcile.js';` dan baris 47 `const { axRoleIndex, reconcileElements, hasRoleGap } = ...` **tidak disentuh** — ketiganya hanya dipakai `dispatch` (baris 1919, 1931, 1933).

- [ ] **Step 3: Daftarkan di helper**

Di `tests/helpers/extension-source.mjs`, ubah:

```js
const FILES = [
  'extension/background.js',
];
```

menjadi:

```js
const FILES = [
  'extension/background.js',
  'extension/lib/log.js',
];
```

- [ ] **Step 4: Jalankan suite dan commit**

```bash
npm test
npm run check
git add extension/lib/log.js extension/background.js tests/helpers/extension-source.mjs
git commit -m "refactor: give the worker graph one importable logger handle"
```

Expected: `# pass 738` (task ini tidak menambah tes apa pun), `# fail 0`, `check ok`. Ketiga tes `structure-gates` tetap hijau — guard `<= 2647` masih terpenuhi setelah `background.js` menyusut, dan `lib/log.js` berada jauh di bawah langit-langit 550 baris. Kalau ada yang merah, itu kegagalanmu, bukan yang diharapkan; selidiki, jangan naikkan ambang.

---

### Task 7b: Dua perbaikan lintas-task yang membuka jalan bagi dua belas ekstraksi

Task 7 menemukan keduanya dan menaikkan eskalasi alih-alih menebak. Keduanya
mematahkan suite pada task yang jauh di depan, jadi diperbaiki sekali di sini.

**Files:**
- Modify: `tests/helpers/boundary-locks.mjs` (satu hash + satu blok komentar)
- Modify: `tests/burst-tab-switching.test.mjs` (7 pemanggilan)
- Modify: `tests/debugger-session-lifecycle.test.mjs` (1 pemanggilan)
- Commit: perubahan Task 7 yang masih terbuka (`extension/lib/log.js`,
  `extension/background.js`, `tests/helpers/extension-source.mjs`)

**Interfaces:**
- Consumes: `PUBLIC_SURFACE_LOCKS`, `sha1Blob` dari `tests/boundary-locks.test.mjs`.
- Produces: aturan bahwa setiap task yang menyentuh `background.js` ikut
  menempel ulang hashnya di commit yang sama.

**Perbaikan 1 — `background.js` dikunci hash, sehingga semua 12 ekstraksi
akan mematahkannya.**

`PUBLIC_SURFACE_LOCKS` memuat `['../extension/background.js', <sha1>]`, dan
dicek oleh **dua** berkas: `tests/boundary-locks.test.mjs` (baru, Task 2) dan
`tests/delta-first-observation.test.mjs:556` (lama, sudah ada sebelum rencana
ini). Setiap perubahan apa pun pada `background.js` membuat keduanya merah —
dan itu sudah terbukti: Task 7 merah sekarang, pada `dfe3e27… → e1e62cf…`.

Rencana dan spec sama-sama tidak pernah membahas ini; spec `:570` bahkan
mencatat `PUBLIC_SURFACE_LOCKS` di daftar "yang tidak berubah", yang kini
salah. Berkas kuncinya sendiri sudah punya jawabannya: ia penuh blok komentar
bertanggal berbunyi *"Re-pinned … No public contract moved: … background.js
moved on …"*, dan blok terakhirnya (`:62`) sudah ditulis untuk rencana ini.

**Ruling:** ikuti konvensi berkasnya. Tulis **satu** blok re-pin yang berlaku
untuk seluruh pemecahan; setiap task berikutnya hanya menempel ulang nilai
hashnya, tanpa blok komentar baru. Alasannya: `dispatch` — satu-satunya yang
di spec disebut "tidak disentuh isinya" — memang tidak berpindah, jadi
kontrak publik tidak bergerak; yang bergerak hanyalah berkas yang membungkusnya.

- [ ] **Step 1: Tempel ulang hash `background.js`**

Hitung dengan fungsi `sha1Blob` yang sudah ada di
`tests/boundary-locks.test.mjs:16-21` (git blob SHA1 atas byte LF; berkas
CRLF dinormalkan dulu). Jangan memakai `git hash-object` secara langsung
tanpa normalisasi — pada checkout CRLF hasilnya berbeda.

- [ ] **Step 2: Tulis blok re-pin sekali**

Tambahkan tepat sebelum `export const PUBLIC_SURFACE_LOCKS`:

```js
// Re-pinned 2026-10-09 for the background.js split. No public contract moved:
// dispatch keeps byte-identical content in background.js — only the code around
// it moves into worker/ and lib/ modules. Every extraction task re-pins the
// background.js hash below in the same commit, so the value tracks the file's
// current bytes; this comment stays as the single record of why it keeps
// changing. content.js, manifest.json and the MCP function are untouched by
// the split and are not re-pinned.
```

- [ ] **Step 3: Commit Task 7 bersama perbaikan ini**

```bash
npm test
npm run check
git add extension/lib/log.js extension/background.js tests/helpers/extension-source.mjs tests/helpers/boundary-locks.mjs
git commit -m "refactor: give the worker graph one importable logger handle"
```

Expected: `# pass 738`, `# fail 0`. `boundary-locks` dan
`delta-first-observation` kembali hijau; `background.js` kini 2640 baris.

**Perbaikan 2 — tujuh pemanggilan `sliceBetween` menyeberangi `dispatch`.**

`tests/burst-tab-switching.test.mjs` (7) dan
`tests/debugger-session-lifecycle.test.mjs` (1) memotong dari
`async function runBurst(` sampai `async function dispatch(`.

`dispatch` tetap di `background.js`, sedangkan `runBurst` ikut
`worker/loop-engine.js` pada Task 16 — dan `background.js` selalu menjadi
**entri pertama** bundel. Begitu Task 16 berjalan, `dispatch` mendahului
`runBurst` di dalam bundel, `indexOf(endMarker, start)` mengembalikan `-1`,
dan penjaga `assert.ok(end > start)` di `sliceBetween` gagal dengan pesan
*"`async function dispatch(` must follow `async function runBurst(`"*. Delapan
tes merah serempak, dan itu baru diketahui di Task 16.

Solusinya bukan mengubah bundel, melainkan memakai penanda yang hidup di
region yang sama. **Bukti bahwa ini aman:** semua pola yang di-assert positif
oleh kedelapan tes berada di baris `1115–1226` — seluruhnya di dalam
`runBurst` (`1114–1245`). Pernyataan `doesNotMatch` (`cannot switch tabs`,
`chrome.debugger.detach({ tabId })`) berada di luar `runBurst` dan tetap di
luar setelah irisan dipersempit, jadi keduanya tetap lulus.

- [ ] **Step 4: Ganti penanda akhir di 8 pemanggilan**

Ganti `'async function dispatch('` menjadi `'function loopSummary('` pada
kedelapan pemanggilan — `loopSummary` (`:1246`) adalah fungsi top-level
pertama setelah `runBurst` dan ikut pindah ke `loop-engine.js`, sehingga
urutannya di bundel tidak pernah terbalik.

- [ ] **Step 5: Jalankan dan commit**

```bash
node --test tests/burst-tab-switching.test.mjs tests/debugger-session-lifecycle.test.mjs
npm test
npm run check
git add tests/burst-tab-switching.test.mjs tests/debugger-session-lifecycle.test.mjs
git commit -m "test: end the burst slice at a marker that moves with runBurst"
```

Expected: kedua file fokus PASS, `# pass 738`, `# fail 0`, `check ok`.
Jumlah tes tidak berubah.

**Catatan pemindaian yang menyertai temuan ini.** Seluruh pasangan
dua-jangkar lain yang memotong bundel sudah diperiksa terhadap tabel region:
`requireTabId→resolveTabId`, `withDebugger→codedError`,
`executeWatchAction→handleWatchFire`, `executeCommand→pair`,
`trustedClick→// Burst ref passthrough`, `sampleTabFocus→// Action Pipeline`,
`withForegroundFocusGate→// Action Pipeline`,
`ensureContent→contentCall`, `contentCall→executeInTab`,
`trustedFill→trustedPointer`, `boundedResult→Event-Triggered Workflows`,
dan `case 'page.read'→case 'page.query'` — semuanya berpasangan di dalam
modul yang sama, atau menyeberang dengan urutan bundel yang memang sudah
dipaksa (serialize sebelum watch-registry). Hanya `runBurst→dispatch` yang
terbalik. `scripts/check.mjs` aman karena Task 5 mengalihkannya ke bundel.

---

### Task 8: `extension/lib/serialize.js` — termasuk penyimpangan yang terdokumentasi

**Files:**
- Create: `extension/lib/serialize.js`
- Modify: `extension/background.js:75`, `extension/background.js:2019-2045`
- Modify: `tests/hygiene.test.mjs` (satu baris asersi — lihat *Satu penyimpangan dari spec*)
- Modify: `tests/helpers/extension-source.mjs`

**Interfaces:**
- Consumes: tidak ada.
- Produces: `boundedResult`, `oversized`, `serializeResult`, `clearSerializedResult`, `MAX_RESULT_BYTES`, dan `serializedResult` (modul-private, **tidak diekspor**).

- [ ] **Step 1: Tulis tes untuk reset — gagal dulu**

Tambahkan ke `tests/hygiene.test.mjs`:

```js
test('executeCommand drops the memoized serialization before dispatching', () => {
  const executor = background.slice(background.indexOf('async function executeCommand'));
  assert.match(executor.slice(0, 900), /clearSerializedResult\(\);/);
});
```

Run: `node --test tests/hygiene.test.mjs`
Expected: FAIL — `clearSerializedResult` belum ada.

- [ ] **Step 2: Buat modulnya**

Pindahkan **utuh** baris 2019-2045 `extension/background.js` (dua fungsi `boundedResult`/`oversized`, blok komentar memo, `let serializedResult`, dan `serializeResult`) ke `extension/lib/serialize.js` — urutannya dipertahankan persis seperti asal — lalu tambahkan kepala berkas, `MAX_RESULT_BYTES`, `clearSerializedResult`, dan satu baris `export`. Seluruh isi berkas setelah perpindahan:

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: serialize — bound and memoize a command result before it crosses the wire.
// @state: owns the single memo that executeCommand clears per command; chrome-free, so it lives in lib/.
// @dependencies: none.

const MAX_RESULT_BYTES = 512 * 1024;

function boundedResult(value) {
  const text = serializeResult(value);
  if (text.length > MAX_RESULT_BYTES) {
    throw new Error(`Result exceeds ${MAX_RESULT_BYTES} bytes. Use bounded/chunked reads.`);
  }
  return value;
}

function oversized(value) {
  return serializeResult(value).length > MAX_RESULT_BYTES;
}

// Single-entry memo for result serialization. page.read measures the result
// against the ceiling and the dispatcher then measures it again; without this,
// every read paid a second full JSON.stringify on the hottest observation path.
// Keyed on object identity, so a rebuilt result serializes exactly once, and
// cleared per command so nothing large is retained between commands.
let serializedResult = { value: null, text: '' };

function serializeResult(value) {
  if (serializedResult.value === value) return serializedResult.text;
  let text;
  try { text = JSON.stringify(value); } catch { throw new Error('Result is not serializable.'); }
  serializedResult = { value, text };
  return text;
}

function clearSerializedResult() {
  // Drop the memo so a large previous result is not pinned for the worker's
  // lifetime. Exported as a function because an imported binding is read-only.
  serializedResult = { value: null, text: '' };
}

export {
  MAX_RESULT_BYTES,
  boundedResult,
  oversized,
  serializeResult,
  clearSerializedResult,
};
```

**Penting — nilai persis:** `const MAX_RESULT_BYTES = 512 * 1024;`, disalin dari `extension/background.js:75`. Jangan menuliskan `65536` atau hasil hitungannya — teksnya harus identik, termasuk bentuk perkaliannya. `boundedResult` dan `oversized` wajib ikut terbawa: kalau hanya `serializeResult` yang dipindah, blok `export` di atas merujuk nama yang tidak terdefinisi dan modul gagal saat *link*.

- [ ] **Step 3: Ambil nilai asli**

Run: `sed -n '75p' extension/background.js`
Expected: satu baris `const MAX_RESULT_BYTES = <nilai>;` — tempelkan nilainya ke Step 2.

- [ ] **Step 4: Potong dari `background.js`**

- Hapus baris 2019-2045 (region `serialize`).
- Hapus baris 75 (`MAX_RESULT_BYTES`).
- Ganti baris 2272 (`  serializedResult = { value: null, text: '' };`) dengan:

```js
  clearSerializedResult();
```

- Tambahkan impor:

```js
import { oversized, MAX_RESULT_BYTES, clearSerializedResult } from './lib/serialize.js';
```

`boundedResult` dan `serializeResult` belum diimpor `background.js` — yang memakainya (`executeCommand`) sudah pindah ke modul, dan `execute-pull` mengimpornya sendiri di Task 18.

- [ ] **Step 5: Daftarkan di helper, tambahkan anchor**

```js
const FILES = [
  'extension/background.js',
  'extension/lib/log.js',
  'extension/lib/serialize.js',
];
```

`serialize.js` harus tetap **sebelum** `watch-registry.js` — hal itu sudah diuji `tests/extension-source.test.mjs`.

- [ ] **Step 6: Jalankan suite dan commit**

```bash
npm test
npm run check
git add extension/lib/serialize.js extension/background.js tests/hygiene.test.mjs tests/helpers/extension-source.mjs
git commit -m "refactor: make the result memo module-private behind a reset function"
```

Expected: `# fail 0`. Kalau asersi `serializedResult = \{ ... \}` yang lama masih ada dan masih lulus, itu berarti potongannya salah — periksa ulang baris 2272.

---

### Task 9: `extension/worker/utils.js`

**Files:**
- Create: `extension/worker/utils.js`
- Modify: `extension/background.js:99-162`, `:71`, `:90-96`
- Modify: `tests/helpers/extension-source.mjs`

**Interfaces:**
- Consumes: `../lib/log.js`, `../lib/endpoints.js`.
- Produces: `sleep`, `isTabDragRefusal`, `mutateTabs`, `nowIso`, `randomToken`, `getConfig`, `setState`, `STORAGE_KEYS`, `connectionState`.

- [ ] **Step 1: Buat direktori dan modulnya**

Buat direktori `extension/worker/`. Pindahkan **utuh** baris 99-162 (tujuh fungsi, termasuk `TAB_DRAG_ATTEMPTS` baris 109 dan `TAB_DRAG_BACKOFF_MS` baris 110 yang ada di dalam region) plus baris 71 (`STORAGE_KEYS`) dan baris 90-96 (`connectionState`).

Blok impor di paling atas `extension/worker/utils.js`:

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: utils — storage access, tab mutation retry and time helpers.
// @state: owns STORAGE_KEYS and connectionState; every module that reads pair status imports these from here.
// @dependencies: log, endpoints.

import { log } from '../lib/log.js';
import { DEFAULT_BRIDGE_URL } from '../lib/endpoints.js';
```

- [ ] **Step 2: Ekspor**

Tambahkan `export` pada kedelapan nama: `sleep`, `isTabDragRefusal`, `mutateTabs`, `nowIso`, `randomToken`, `getConfig`, `setState`, `STORAGE_KEYS`, `connectionState`.

- [ ] **Step 3: Potong dari `background.js` dan impor**

- Hapus baris 99-162, baris 71, baris 90-96.
- Tambahkan:

```js
import { mutateTabs, nowIso, randomToken, getConfig } from './worker/utils.js';
```

Empat itu saja yang dipakai `dispatch`. Sisanya diimpor langsung oleh modul yang memakainya.

- [ ] **Step 4: Daftarkan di helper**

```js
const FILES = [
  'extension/background.js',
  'extension/lib/log.js',
  'extension/lib/serialize.js',
  'extension/worker/utils.js',
];
```

- [ ] **Step 5: Jalankan suite dan commit**

```bash
npm test
npm run check
git add extension/worker extension/background.js tests/helpers/extension-source.mjs
git commit -m "refactor: move storage and tab-mutation helpers into worker/utils.js"
```

---

### Task 10: `extension/worker/capture.js`

**Files:**
- Create: `extension/worker/capture.js`
- Modify: `extension/background.js:288-462`, `:78-79`, `:97`
- Modify: `tests/helpers/extension-source.mjs`

**Interfaces:**
- Consumes: `../lib/log.js`, `../lib/ax-summary.js`, `../lib/debugger-session.js`.
- Produces: `captureFramePrivacyProbe`, `assertCaptureFramesSafe`, `withDebugger`, `codedError`, `collectAxSummary`, `screenshotBytes`, `screenshotHash`, `screenshotLooksBlank`, `cachedScreenshot`, `rememberScreenshot`, `SCREENSHOT_CACHE_MS`, `SCREENSHOT_CACHE_LIMIT`, `screenshotCache`.

- [ ] **Step 1: Buat modulnya**

Pindahkan **utuh** baris 288-462, plus baris 78 (`SCREENSHOT_CACHE_MS`), 79 (`SCREENSHOT_CACHE_LIMIT`), 97 (`screenshotCache`).

Blok impor:

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: capture — debugger attach, frame safety probes, ax summary and the screenshot memo.
// @state: owns screenshotCache; private-tabs and execute-pull clear it through this import, which is why this module must never import either of them.
// @dependencies: log, ax-summary, debugger-session.

import { log } from '../lib/log.js';
import { buildAxSummary } from '../lib/ax-summary.js';
import { registerDebuggerSession, releaseDebuggerSession } from '../lib/debugger-session.js';
```

- [ ] **Step 2: Ekspor**

`export` pada kesepuluh fungsi plus tiga state.

- [ ] **Step 3: Potong dari `background.js` dan impor**

- Hapus baris 288-462, 78, 79, 97.
- Tambahkan:

```js
import { codedError, collectAxSummary } from './worker/capture.js';
```

- [ ] **Step 4: Daftarkan di helper dan jalankan**

Tambahkan `'extension/worker/capture.js',` ke `FILES` **setelah** `utils.js`.

```bash
npm test
npm run check
git add extension/worker extension/background.js tests/helpers/extension-source.mjs
git commit -m "refactor: move capture, debugger and screenshot memo into worker/capture.js"
```

Catatan pengikatan: `capture` sengaja **tidak** mengimpor `private-tabs`. Kalau ia melakukannya, terbentuk siklus `capture → private-tabs → capture` yang bisa dihindari. `tests/extension-source.test.mjs` tidak menguji ini — Task 19 menambahkannya.

---

### Task 11: `extension/worker/private-tabs.js`

**Files:**
- Create: `extension/worker/private-tabs.js`
- Modify: `extension/background.js:269-287`, `:72`
- Modify: `tests/helpers/extension-source.mjs`

**Interfaces:**
- Consumes: `./capture.js` (`screenshotCache`).
- Produces: `privateTabIds`, `isPrivateTab`, `setPrivateTab`, `PRIVATE_TABS_KEY`.

- [ ] **Step 1: Buat modulnya**

Pindahkan **utuh** baris 269-287 plus baris 72 (`PRIVATE_TABS_KEY`).

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: private-tabs — the incognito tab-id set and the screenshot memo it clears.
// @state: owns PRIVATE_TABS_KEY; reads screenshotCache from capture, one way only.
// @dependencies: capture.

import { screenshotCache } from './capture.js';
```

- [ ] **Step 2: Ekspor** keempat nama.

- [ ] **Step 3: Potong dari `background.js`**

- Hapus baris 269-287 dan baris 72.
- **Tidak ada impor baru di `background.js`** — `dispatch` tidak memakai modul ini. Ia dimuat lewat `listen`, `capture-page`, dan `execute-pull` yang mengimpornya sendiri, dan lewat entri helper.

- [ ] **Step 4: Daftarkan di helper dan jalankan**

Tambahkan `'extension/worker/private-tabs.js',` setelah `capture.js`.

```bash
npm test
npm run check
git add extension/worker extension/background.js tests/helpers/extension-source.mjs
git commit -m "refactor: move the private-tab set into worker/private-tabs.js"
```

---

### Task 12: `extension/worker/tab-content.js`

**Files:**
- Create: `extension/worker/tab-content.js`
- Modify: `extension/background.js:163-268`, `:74`
- Modify: `tests/helpers/extension-source.mjs`

**Interfaces:**
- Consumes: `./utils.js`, `../lib/log.js`, `../lib/protocol.js`.
- Produces: `fetchJson`, `publicTab`, `requireTabId`, `resolveTabId`, `waitTabReady`, `ensureContent`, `contentCall`, `executeInTab`, `HTTP_URL_RE`.

- [ ] **Step 1: Buat modulnya**

Pindahkan **utuh** baris 163-268 plus baris 74 (`HTTP_URL_RE`).

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: tab-content — content-script injection and the messaging bridge into a tab.
// @state: owns HTTP_URL_RE and the ensureContent script list; that list is pinned by manifest.content_scripts[0].js and must not be edited.
// @dependencies: utils, log, protocol.

import { log } from '../lib/log.js';
import { sleep } from './utils.js';
import { clamp } from '../lib/protocol.js';
```

- [ ] **Step 2: Ekspor** kesembilan nama.

- [ ] **Step 3: Potong dari `background.js` dan impor**

- Hapus baris 163-268 dan baris 74.
- Tambahkan:

```js
import { publicTab, requireTabId, resolveTabId, waitTabReady, contentCall } from './worker/tab-content.js';
```

- [ ] **Step 4: Daftarkan di helper dan jalankan**

Tambahkan `'extension/worker/tab-content.js',` setelah `utils.js`.

```bash
npm test
npm run check
git add extension/worker extension/background.js tests/helpers/extension-source.mjs
git commit -m "refactor: move the content-script bridge into worker/tab-content.js"
```

---

### Task 13: `extension/worker/listen.js`

**Files:**
- Create: `extension/worker/listen.js`
- Modify: `extension/background.js:463-550`
- Modify: `tests/helpers/extension-source.mjs`

**Interfaces:**
- Consumes: `./utils.js`, `./tab-content.js`, `./private-tabs.js`, `./capture.js`, `../lib/log.js`, `../lib/endpoints.js`.
- Produces: `listenUrlFor`, `readListenSession`, `listenStart`, `listenStop`, `postListenChunk`.

- [ ] **Step 1: Buat modulnya**

Pindahkan **utuh** baris 463-550. Tidak ada state header yang ikut.

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: listen — tabCapture session lifecycle and chunk streaming.
// @state: no module-private state; the session lives in chrome.tabCapture.
// @dependencies: utils, tab-content, private-tabs, capture, log, endpoints.

import { log } from '../lib/log.js';
import { LISTEN_BASE_URL } from '../lib/endpoints.js';
import { getConfig } from './utils.js';
import { fetchJson, contentCall, HTTP_URL_RE } from './tab-content.js';
import { isPrivateTab } from './private-tabs.js';
import { codedError } from './capture.js';
```

`HTTP_URL_RE` ikut diimpor karena `listen` mengujinya di `:480` (`LISTEN_BLOCKED`). Ia dideklarasikan di `background.js:74` dan berpindah ke `tab-content` pada Task 12, sehingga tiap pembaca harus mengimpornya sendiri.

- [ ] **Step 2: Ekspor** kelima fungsi.

- [ ] **Step 3: Potong dari `background.js` dan impor**

- Hapus baris 463-550.
- Tambahkan:

```js
import { listenStart, listenStop } from './worker/listen.js';
```

- [ ] **Step 4: Daftarkan di helper dan jalankan**

Tambahkan `'extension/worker/listen.js',` setelah `capture.js`.

```bash
npm test
npm run check
git add extension/worker extension/background.js tests/helpers/extension-source.mjs
git commit -m "refactor: move the tabCapture session into worker/listen.js"
```

---

### Task 14: `extension/worker/capture-page.js`

**Files:**
- Create: `extension/worker/capture-page.js`
- Modify: `extension/background.js:551-665`, `:77`
- Modify: `tests/helpers/extension-source.mjs`

**Interfaces:**
- Consumes: `./utils.js`, `./tab-content.js`, `./private-tabs.js`, `./capture.js`, `../lib/log.js`, `../lib/protocol.js`.
- Produces: `capturePage`, `MAX_SCREENSHOT_BYTES`.

- [ ] **Step 1: Buat modulnya**

Pindahkan **utuh** baris 551-665 plus baris 77 (`MAX_SCREENSHOT_BYTES`).

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: capture-page — element and tab capture driven through the debugger.
// @state: owns MAX_SCREENSHOT_BYTES; deliberately separate from capture.js — merging them would close the cycle capture -> private-tabs -> capture.
// @dependencies: utils, tab-content, private-tabs, capture, protocol.

import { clamp } from '../lib/protocol.js';
import { nowIso } from './utils.js';
import { contentCall, HTTP_URL_RE } from './tab-content.js';
import { isPrivateTab } from './private-tabs.js';
import {
  assertCaptureFramesSafe,
  withDebugger,
  codedError,
  screenshotBytes,
  screenshotHash,
  screenshotLooksBlank,
  cachedScreenshot,
  rememberScreenshot,
} from './capture.js';
```

- [ ] **Step 2: Ekspor** `capturePage` dan `MAX_SCREENSHOT_BYTES`.

- [ ] **Step 3: Potong dari `background.js` dan impor**

- Hapus baris 551-665 dan baris 77.
- Tambahkan:

```js
import { capturePage } from './worker/capture-page.js';
```

- [ ] **Step 4: Daftarkan di helper dan jalankan**

Tambahkan `'extension/worker/capture-page.js',` setelah `listen.js`.

```bash
npm test
npm run check
git add extension/worker extension/background.js tests/helpers/extension-source.mjs
git commit -m "refactor: split page capture out of capture.js into its own module"
```

---

### Task 15: `extension/worker/action-focus.js`

**Files:**
- Create: `extension/worker/action-focus.js`
- Modify: `extension/background.js:666-1115`
- Modify: `tests/helpers/extension-source.mjs`

**Interfaces:**
- Consumes: `./utils.js`, `./tab-content.js`, `./capture.js`, **`../background.js`** (sementara), `../lib/log.js`, `../lib/protocol.js`, `../lib/action-pipeline.js`, `../lib/focus-gate.js`, `../lib/keyboard.js`, `../lib/popup-events.js`.
- Produces: `executionMode`, `foregroundRequired`, `withInputFocusEmulation`, `sampleTabFocus`, `withForegroundFocusGate`, `popupInFlightTab`, `withActionPopupTracking`, `prunePopupLog`, `notFoundHint`, `notReadyError`, `runActionPipeline`, `trustedClick`, `trustedFill`, `trustedPointer`, `trustedKey`, `burstPassthroughRef`, `burstStepParams`, plus state `popupLog`, `popupActionStack`, `POPUP_LOG_MAX_AGE_MS`, `UV_WAIT_FLOOR_MS` (sudah ada di dalam region: baris 757, 767, 768, 769).

Siklus yang diterima: selama `loop-engine` masih di `background.js`, modul ini mengimpor `finishLoop`/`finishStateLoop` dari sana. Task 16 mengalihkannya ke `./loop-engine.js`.

- [ ] **Step 1: Buat modulnya**

Pindahkan **utuh** baris 666-1115.

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: action-focus — the foreground focus gate, the action pipeline and trusted input.
// @state: owns the popup focus log and its floor; loop-engine reads popupLog/stateSessions from here through this export.
// @dependencies: utils, tab-content, capture, background (loop helpers), log, protocol, action-pipeline, focus-gate, keyboard, popup-events.

import { log } from '../lib/log.js';
import { METHOD_SPECS, clamp } from '../lib/protocol.js';
import { pollDelays, classifyResolve, makeNotReady, attachResolution } from '../lib/action-pipeline.js';
import { decideFocusGate, FOCUS_GATE_ATTEMPTS, FOCUS_GATE_SETTLE_MS } from '../lib/focus-gate.js';
import { resolveKeyInput } from '../lib/keyboard.js';
import { recordPopup, resolvePopupOpener, POPUP_LOG_LIMIT } from '../lib/popup-events.js';
import { sleep } from './utils.js';
import { contentCall } from './tab-content.js';
import { withDebugger } from './capture.js';
import { finishLoop, finishStateLoop, loopSessions, stateSessions } from '../background.js';
```

Empat nama dari `background.js`, bukan dua. `loopSessions` dibaca di `:810` dan `stateSessions` di `:813`, keduanya di dalam `withActionPopupTracking`. Pada titik Task 15, `loop-engine` belum diekstrak, jadi keempatnya masih tinggal di `background.js` — dan keduanya hanya **dibaca** (diiterasi), tidak pernah ditulis ulang, jadi aman sebagai binding impor.

- [ ] **Step 2: Ekspor**

`export` pada kedelapan belas fungsi plus keempat state.

- [ ] **Step 3: Potong dari `background.js` dan impor**

- Hapus baris 666-1115.
- Tambahkan:

```js
import {
  executionMode,
  sampleTabFocus,
  withActionPopupTracking,
  runActionPipeline,
  trustedClick,
  trustedFill,
  trustedPointer,
  trustedKey,
  popupLog,
} from './worker/action-focus.js';
```

`popupLog` ikut diimpor karena `dispatch` membacanya. Ia `const` berbentuk objek — dibaca dan dimodifikasi, tidak pernah ditulis ulang, jadi aman.

- [ ] **Step 4: Daftarkan di helper dan jalankan**

Tambahkan `'extension/worker/action-focus.js',` setelah `capture-page.js`.

```bash
npm test
npm run check
git add extension/worker extension/background.js tests/helpers/extension-source.mjs
git commit -m "refactor: move the focus gate and trusted input into worker/action-focus.js"
```

Kegagalan yang mungkin terjadi di sini: `background-load.test.mjs` gagal dengan `ReferenceError: finishLoop is not defined` atau `... is not a function`. Itu berarti siklus sementara tidak terbentuk dengan benar — periksa bahwa `background.js` masih mendefinisikan `finishLoop` (Task 16 belum berjalan) dan bahwa impor modul ditulis persis seperti di atas.

---

### Task 16: `extension/worker/loop-engine.js` + alihkan impor `action-focus`

**Files:**
- Create: `extension/worker/loop-engine.js`
- Modify: `extension/worker/action-focus.js` (satu baris impor)
- Modify: `extension/background.js:1116-1646`, `:76`
- Modify: `extension/lib/loop.js:3`
- Modify: `tests/helpers/extension-source.mjs`

**Interfaces:**
- Consumes: `./action-focus.js`, `./tab-content.js`, **`../background.js`** (`dispatch`), `../lib/log.js`, `../lib/protocol.js`, `../lib/loop.js`, `../lib/keyboard.js`, `../lib/debugger-session.js`.
- Produces: `burstResultSize`, `runBurst`, `loopSummary`, `finishLoop`, `loopSessionOnTab`, `stateSummary`, `finishStateLoop`, `handleStateEvent`, `loopDecodeTemplate`, `loopSnapshot`, `loopCropRegion`, `loopSyntheticKey`, `loopTrustedKey`, `loopTrustedPointer`, `loopActKey`, `loopAct`, `loopSense`, `loopTickLater`, `loopTick`, plus state `MAX_BURST_RESULT_BYTES`, `LOOP_MAX_ACTIVE`, `loopSessions`, `loopResults`, `STATE_READERS`, `stateSessions`, `stateResults`.

- [ ] **Step 1: Buat modulnya**

Pindahkan **utuh** baris 1116-1646 plus baris 76 (`MAX_BURST_RESULT_BYTES`).

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: loop-engine — burst execution and the sense-act / state loop sessions.
// @state: owns loopSessions, loopResults, stateSessions, stateResults, STATE_READERS and LOOP_MAX_ACTIVE; dispatch and action-focus read them through this export.
// @dependencies: action-focus, tab-content, background, log, protocol, loop, keyboard, debugger-session.

import { log } from '../lib/log.js';
import {
  BURST_ACTION_METHODS,
  BURST_MAX_TIMEOUT_MS,
  burstCrossTabRef,
  burstStaleRef,
  normalizeError,
} from '../lib/protocol.js';
import {
  LOOP_SYNTHETIC_DEAD_TICKS,
  LOOP_TRACK_MIN_RUN,
  centroidTrack,
  downscaleHash,
  frontOfChanged,
  matchTemplate,
  pixelDiff,
  recordTick,
} from '../lib/loop.js';
import { resolveKeyInput } from '../lib/keyboard.js';
import { releaseDebuggerSession } from '../lib/debugger-session.js';
import { resolveTabId, contentCall } from './tab-content.js';
import { executionMode, withInputFocusEmulation, notReadyError, burstStepParams } from './action-focus.js';
import { dispatch } from '../background.js';
```

- [ ] **Step 2: Ekspor**

`export` pada kesembilan belas fungsi plus ketujuh state.

- [ ] **Step 3: Alihkan seluruh blok impor `action-focus.js` dari `background.js` ke `./loop-engine.js`**

Ganti baris:

```js
import { finishLoop, finishStateLoop, loopSessions, stateSessions } from '../background.js';
```

menjadi:

```js
import { finishLoop, finishStateLoop, loopSessions, stateSessions } from './loop-engine.js';
```

Keempatnya sekaligus — `finishLoop`/`finishStateLoop` dipanggil, `loopSessions`/`stateSessions` dibaca. Mengalihkan hanya dua akan meninggalkan `action-focus` membaca binding `background.js` yang sudah tidak ada, dan itu **tidak** terbaca sebagai `ReferenceError` saat load karena keduanya ada di dalam badan fungsi: ia baru meledak saat `withActionPopupTracking` pertama kali dipanggil, tepatnya saat user mengambil tindakan lewat popup. Itu kegagalan runtime yang paling mahal dalam rencana ini, karena itu langkahnya ditulis eksplisit.

Siklus `action-focus ↔ loop-engine` tetap ada, tapi kini antara dua modul peer — `background.js` tidak lagi berada di dalamnya.

- [ ] **Step 4: Potong dari `background.js` dan impor**

- Hapus baris 1116-1646 dan baris 76.
- Tambahkan:

```js
import {
  runBurst,
  loopSummary,
  finishLoop,
  loopSessionOnTab,
  stateSummary,
  finishStateLoop,
  loopDecodeTemplate,
  loopTickLater,
  LOOP_MAX_ACTIVE,
  loopSessions,
  loopResults,
  STATE_READERS,
  stateSessions,
  stateResults,
} from './worker/loop-engine.js';
```

- [ ] **Step 5: Perbarui `extension/lib/loop.js:3`**

Ganti:

```js
// @state: validator and tick-band classifier only; no executor yet.
```

menjadi:

```js
// @state: validator and tick-band classifier only; the executor (loopSessions, loopTick, runBurst) lives in extension/worker/loop-engine.js.
```

- [ ] **Step 6: Daftarkan di helper dan jalankan**

Tambahkan `'extension/worker/loop-engine.js',` setelah `action-focus.js`.

```bash
npm test
npm run check
git add extension/worker extension/background.js extension/lib/loop.js tests/helpers/extension-source.mjs
git commit -m "refactor: move the burst and loop sessions into worker/loop-engine.js"
```

---

### Task 17: `extension/worker/watch-registry.js`

**Files:**
- Create: `extension/worker/watch-registry.js`
- Modify: `extension/background.js:2046-2268`
- Modify: `tests/helpers/extension-source.mjs`

**Interfaces:**
- Consumes: `./utils.js`, `./tab-content.js`, `./capture.js`, `./action-focus.js`, `./loop-engine.js`, **`../background.js`** (`dispatch`), `../lib/log.js`, `../lib/protocol.js`, `../lib/watch.js`, `../lib/debugger-session.js`.
- Produces: `watchRuleId`, `loadWatchers`, `saveWatchers`, `watcherIdsForTab`, `pruneWatchers`, `tabExists`, `armWatchersForTab`, `handleWatchFacts`, `emitWatchEvent`, `executeWatchAction`, `handleWatchFire`, `commandTimeoutError`, `trustedHover`, plus seluruh state `WATCH_*` di baris 2051-2054 termasuk `MAX_WATCHERS_PER_TAB` dan `MAX_WATCHERS_GLOBAL`.

- [ ] **Step 1: Buat modulnya**

Pindahkan **utuh** baris 2046-2268 (termasuk banner `// ---- Event-Triggered Workflows: watch registry ----` dan deklarasi `const` baris 2051-2054).

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: watch-registry — event-triggered watchers: persistence, arming and firing.
// @state: owns the WATCH_* caps and both watcher tables; dispatch reads MAX_WATCHERS_PER_TAB and MAX_WATCHERS_GLOBAL from here.
// @dependencies: utils, tab-content, capture, action-focus, loop-engine, background, log, protocol, watch, debugger-session.

import { log } from '../lib/log.js';
import { clamp } from '../lib/protocol.js';
import { evaluateRules } from '../lib/watch.js';
import { releaseDebuggerSession } from '../lib/debugger-session.js';
import { getConfig, setState } from './utils.js';
import { fetchJson, contentCall, executeInTab } from './tab-content.js';
import { withDebugger, codedError } from './capture.js';
import {
  executionMode,
  withInputFocusEmulation,
  withForegroundFocusGate,
  runActionPipeline,
  trustedClick,
} from './action-focus.js';
import { runBurst } from './loop-engine.js';
import { dispatch } from '../background.js';
```

- [ ] **Step 2: Ekspor**

`export` pada ketiga belas fungsi plus seluruh state `WATCH_*`.

- [ ] **Step 3: Potong dari `background.js` dan impor**

- Hapus baris 2046-2268.
- Tambahkan:

```js
import {
  watchRuleId,
  saveWatchers,
  watcherIdsForTab,
  pruneWatchers,
  armWatchersForTab,
  trustedHover,
  MAX_WATCHERS_PER_TAB,
  MAX_WATCHERS_GLOBAL,
} from './worker/watch-registry.js';
```

- [ ] **Step 4: Daftarkan di helper dan jalankan**

Tambahkan `'extension/worker/watch-registry.js',` setelah `extension/lib/serialize.js` — **urutannya di sini diuji** oleh `tests/extension-source.test.mjs`.

```bash
npm test
npm run check
git add extension/worker extension/background.js tests/helpers/extension-source.mjs
git commit -m "refactor: move the event-triggered watchers into worker/watch-registry.js"
```

---

### Task 18: `extension/worker/execute-pull.js` — langkah terakhir

**Files:**
- Create: `extension/worker/execute-pull.js`
- Modify: `extension/background.js:2269-2647`, `:73`, `:88-89`
- Modify: `tests/helpers/extension-source.mjs`
- Modify: `tests/structure-gates.test.mjs` (guard `<= 2647` menjadi `< 600`)

**Interfaces:**
- Consumes: `./utils.js`, `./tab-content.js`, `./private-tabs.js`, `./listen.js`, `./action-focus.js`, `./watch-registry.js`, `./capture.js`, `../lib/serialize.js`, **`../background.js`** (`dispatch`), `../lib/log.js`, `../lib/protocol.js`, `../lib/options-store.js`, `../lib/model-client.js`, `../lib/external-origins.js`, `../lib/deadline-race.js`.
- Produces: `executeCommand`, `pair`, `unpair`, `completionPayload`, `complete`, `completeWithRetry`, `flushPendingCompletion`, `pullOnce`, `pullLoop`, `ensurePullLoop`, `restartPullLoop`, `heartbeat`, `localSelfTest`, plus `WAKE_ALARM`, `loopPromise`, `loopGeneration`.

**Kenapa langkah ini yang terakhir dan selalu begitu:** ia memuat sembilan listener top-level termasuk `chrome.runtime.onMessage` (baris 2535), `chrome.alarms.create` (2645), dan `ensurePullLoop()` (2646) — tiga pernyataan yang **dievaluasi saat load**. `WAKE_ALARM`, `loopPromise`, `loopGeneration` ikut pindah persis supaya tidak ada yang membaca binding `background.js` saat load. `background.js` mengimpornya **hanya untuk efek samping**, jadi registrasi tetap terjadi di startup.

- [ ] **Step 1: Buat modulnya**

Pindahkan **utuh** baris 2269-2647 plus baris 73 (`WAKE_ALARM`), 88 (`loopPromise`), 89 (`loopGeneration`).

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: execute-pull — command execution, pairing and the device pull loop.
// @state: owns WAKE_ALARM, loopPromise and loopGeneration; every statement here that runs at load time is listed in tests/background-load.test.mjs.
// @dependencies: utils, tab-content, private-tabs, listen, action-focus, watch-registry, capture, serialize, background, log, protocol, options-store, model-client, external-origins, deadline-race.

import { log } from '../lib/log.js';
import {
  PRODUCT_VERSION,
  PROTOCOL_VERSION,
  METHOD_SPECS,
  validateCommand,
  normalizeError,
} from '../lib/protocol.js';
import { readModelConfig, saveModelEndpoint, saveModelKey, saveModelName } from '../lib/options-store.js';
import { buildProbeRequest, endpointOk, MODEL_TIMEOUT_MS } from '../lib/model-client.js';
import { originAllowed } from '../lib/external-origins.js';
import { raceWithTimeout } from '../lib/deadline-race.js';
import { sleep, nowIso, randomToken, getConfig, setState, connectionState } from './utils.js';
import { fetchJson, publicTab, requireTabId, contentCall, HTTP_URL_RE } from './tab-content.js';
import { privateTabIds, isPrivateTab, setPrivateTab, PRIVATE_TABS_KEY } from './private-tabs.js';
import { readListenSession, listenStop, postListenChunk } from './listen.js';
import { notReadyError } from './action-focus.js';
import { loadWatchers, armWatchersForTab, handleWatchFacts } from './watch-registry.js';
import { screenshotCache } from './capture.js';
import { clearSerializedResult, boundedResult } from '../lib/serialize.js';
import { dispatch } from '../background.js';
```

- [ ] **Step 2: Ekspor**

`export` pada ketiga belas fungsi plus `WAKE_ALARM`, `loopPromise`, `loopGeneration`.

- [ ] **Step 3: Potong dari `background.js` dan ganti menjadi impor efek samping**

- Hapus baris 2269-2647, 73, 88, 89.
- Tambahkan **tepat satu baris**:

```js
import './worker/execute-pull.js';
```

Tidak ada nama yang diimpor — `dispatch` tidak memakai satupun dari fungsi modul ini. `hygiene.test.mjs` memotong `async function executeCommand` dari bundel, dan karena modul ini entri **terakhir** helper, potongannya menutup berkas seperti yang diminta.

- [ ] **Step 4: Daftarkan di helper — posisi terakhir, tanpa pengecualian**

```js
const FILES = [
  'extension/background.js',
  'extension/lib/log.js',
  'extension/lib/serialize.js',
  'extension/worker/utils.js',
  'extension/worker/tab-content.js',
  'extension/worker/private-tabs.js',
  'extension/worker/capture.js',
  'extension/worker/listen.js',
  'extension/worker/capture-page.js',
  'extension/worker/action-focus.js',
  'extension/worker/loop-engine.js',
  'extension/worker/watch-registry.js',
  'extension/worker/execute-pull.js',
];
```

- [ ] **Step 5: Ganti guard `background.js` dengan ambang akhir, lalu jalankan suite**

Di `tests/structure-gates.test.mjs`, ganti guard yang dipasang Task 6:

```js
  assert.ok(bg.split('\n').length <= 2647,
    `background.js grew to ${bg.split('\n').length} lines; the split must only remove code`);
```

menjadi ambang sebenarnya:

```js
  assert.ok(bg.split('\n').length < 600,
    `background.js must end up below 600 lines, got ${bg.split('\n').length}`);
```

Lalu:

```bash
npm test
npm run check
```

Expected: `# fail 0`, `check ok`. Ketiga tes `structure-gates` kini lulus, termasuk ambang `< 600` yang baru bisa ditegakkan setelah dua belas ekstraksi selesai.

Kalau ambang itu gagal, `background.js` belum cukup kecil — periksa apakah ada baris yang seharusnya ikut berpindah tetapi tertinggal, **bukan** menaikkan ambang.

Kalau `background-load.test.mjs` gagal dengan `ReferenceError: WAKE_ALARM is not defined`, konstanta tidak ikut pindah. Kalau `loopPromise is not defined`, hal yang sama. Keduanya adalah penyebab tunggal yang dipastikan Task 18 tangani.

- [ ] **Step 6: Commit**

```bash
git add extension/worker extension/background.js tests/helpers/extension-source.mjs
git commit -m "refactor: move command execution and the pull loop into worker/execute-pull.js"
```

---

### Task 19: Verifikasi akhir dan penutupan

**Files:**
- Modify: `tests/extension-source.test.mjs` (tambahkan pengikatan yang tersisa)
- Modify: `docs/handoff.md` bila menyebut struktur berkas

**Interfaces:**
- Consumes: seluruh 12 modul dari Task 7-18.
- Produces: bukti bahwa seluruh rencana terpenuhi.

- [ ] **Step 1: Tambahkan pengikatan yang belum diuji**

Tambahkan ke `tests/extension-source.test.mjs`:

```js
test('no state is declared twice across the bundle', async () => {
  const files = extensionSourceFiles();
  if (files.length === 1) return;          // belum ada modul yang dipindah
  const decls = new Map();
  for (const rel of files) {
    const text = await readFile(new URL(`../../${rel}`, import.meta.url), 'utf8');
    const names = [...text.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    for (const name of names) decls.set(name, [...(decls.get(name) || []), rel]);
  }
  const duplicated = [...decls].filter(([, where]) => where.length > 1);
  assert.deepEqual(duplicated, [], 'a state declared in two files will silently diverge');
});

test('every cross-module name is imported where it is used', async () => {
  const files = extensionSourceFiles();
  if (files.length === 1) return;          // belum ada modul yang dipindah

  // Buang komentar dan string agar nama di dalamnya tidak dihitung sebagai pemakaian.
  const strip = (text) => {
    let out = '', i = 0;
    const keep = (s) => (s.match(/\n/g) || ['']).join('');
    while (i < text.length) {
      const c = text[i], c2 = text.slice(i, i + 2);
      if (c2 === '//') { const s = i; while (i < text.length && text[i] !== '\n') i++; out += keep(text.slice(s, i)); continue; }
      if (c2 === '/*') { const s = i; i += 2; while (i < text.length && text.slice(i, i + 2) !== '*/') i++; i += 2; out += keep(text.slice(s, i)); continue; }
      if (c === '"' || c === "'" || c === '`') {
        const q = c, s = i; i++;
        while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; }
        i++; out += '""' + keep(text.slice(s, i)); continue;
      }
      out += c; i++;
    }
    return out;
  };

  const clean = new Map(), exported = new Map(), imported = new Map(), declared = new Map();
  for (const rel of files) {
    const text = await readFile(new URL(`../../${rel}`, import.meta.url), 'utf8');
    const code = strip(text);
    clean.set(rel, code);

    const exp = new Set();
    for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) exp.add(m[1]);
    for (const b of text.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const n of b[1].split(',')) {
        const name = n.trim().split(/\s+as\s+/).pop().trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) exp.add(name);
      }
    }
    exported.set(rel, exp);

    const imp = new Set();
    for (const b of code.matchAll(/import\s*\{([^}]*)\}/g)) {
      for (const n of b[1].split(',')) {
        const name = n.trim().split(/\s+as\s+/).pop().trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) imp.add(name);
      }
    }
    imported.set(rel, imp);

    const dec = new Set();
    for (const m of code.matchAll(/(?:^|[^\w$.])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) dec.add(m[1]);
    for (const m of code.matchAll(/(?:^|[^\w$.])(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) dec.add(m[1]);
    for (const m of code.matchAll(/(?:^|[^\w$.])(?:function|const|let|var|class)\s*\(?[^)]*\b([A-Za-z_$][\w$]*)\s*[)=,]/g)) dec.add(m[1]);
    declared.set(rel, dec);
  }

  const universe = new Set();
  for (const s of exported.values()) for (const n of s) universe.add(n);

  const misses = [];
  for (const rel of files) {
    const code = clean.get(rel);
    for (const n of universe) {
      if (exported.get(rel).has(n)) continue;   // file ini pemiliknya
      if (imported.get(rel).has(n)) continue;   // sudah diimpor
      if (declared.get(rel).has(n)) continue;   // ditutupi deklarasi lokal
      if (!new RegExp(`(?<![.\\w$])${n}\\b`).test(code)) continue;
      misses.push(`${rel}: ${n}`);
    }
  }
  assert.deepEqual(misses, [],
    'a name used but not imported does not fail at load — it fails when the user hits the feature');
});

test('the ensureContent script list still matches the manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const expected = manifest.content_scripts[0].js;
  const src = await extensionSource();
  const literal = `files: [${expected.map((f) => `'${f}'`).join(', ')}]`;
  assert.ok(src.includes(literal),
    `the runtime injection list must stay byte-identical to manifest.content_scripts[0].js:\n  ${literal}`);
});

test('capture never imports private-tabs, so the split cannot close a fifth cycle', async () => {
  const files = extensionSourceFiles();
  if (!files.includes('extension/worker/capture.js')) return;
  const text = await readFile(new URL('../../extension/worker/capture.js', import.meta.url), 'utf8');
  assert.ok(!/from\s+'\.\/private-tabs\.js'/.test(text),
    'capture -> private-tabs would form capture -> private-tabs -> capture');
});
```

**Tentang tes `every cross-module name is imported where it is used`.** Heuristiknya sudah divalidasi sebelum ditulis ke dalam rencana, karena tes yang berisiko salah tembak lebih berbahaya daripada tidak ada tes sama sekali:

- Dijalankan terhadap 17 modul `extension/lib/` yang sudah terpisah — **0 temuan** (108 nama diekspor, semuanya resolusi).
- **3/3 kutukan buatan tertangkap**: `ALLOWED_METHODS` dihapus dari `goal-plan.js`, `SITE_ORIGIN` dari `external-origins.js`, `compileGoalPlan` dari impor majemuk `model-client.js` — ketiganya dilaporkan, file asli kembali 0.

Kuncinya ada pada penyaringan deklarasi lokal: sebuah nama hanya dituduh kalau file itu tidak mengekspornya sendiri, tidak mengimpornya, dan tidak mendeklarasikannya dalam bentuk apa pun. Tanpa penyaringan itu, `dispatch` — nama yang juga lazim sebagai parameter — akan memunculkan dugaan palsu di mana-mana.

- [ ] **Step 2: Jalankan suite penuh**

```bash
npm test
npm run check
```

Expected: `# fail 0`, `check ok`.

- [ ] **Step 3: Baca ulang seluruh tabel angka di spec**

Bandingkan angka di `docs/superpowers/specs/2026-10-09-background-modularization-design.md` *Fakta terverifikasi* dengan kondisi akhir. Kalau berbeda, **perbaiki angka di spec** — sesuai aturan yang sudah ditulis spec itu sendiri.

- [ ] **Step 4: Commit**

```bash
git add tests/extension-source.test.mjs docs/
git commit -m "test: pin state uniqueness, the injection list and the cycle that must not exist"
```
