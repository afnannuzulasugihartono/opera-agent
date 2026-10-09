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
- **Satu simbol diekspor hanya kalau punya pemanggil di file lain.** `tests/hygiene.test.mjs:367` memegang ini untuk `extension/` dan `lib/`: pemakaian di dalam file pengeskpor sendiri tidak cukup, dan test/script pun dihitung sebagai pemanggil. Sebelum menambah `export`, `grep` namanya ke seluruh pohon di luar modul itu — yang nol hasil, jangan diekspor. Ini berlaku untuk dua belas modul yang akan dibuat.
- **Setiap nama yang diimpor harus benar-benar dipakai di berkas itu, sekarang.** Jangan memangkas daftar impor karena pemakainya "nanti pindah ke modul lain" — sampai modul itu pindah, pemanggilnya masih di `background.js`. Tiga kali temuan ini sudah terbukti (Task 8 `boundedResult`, Task 9 `setState` dan `sleep`), dan tak satu pun ditangkap tes mana pun pada awalnya — semuanya menilai `dispatch`, padahal pemanggilnya ada di region yang belum ikut pindah. Keempat kalinya terjadi di Task 11: brief-nya menyatakan "tidak ada impor baru", padahal empat namanya dipanggil `listenStart`, `capturePage` dan `localSelfTest`.
- **Setiap modul baru diakhiri tepat satu `\n`.** Baris kosong ekor ialah sisa
  pemotongan region yang membawa pemisah bersamanya; `capture.js` sempat
  memilikinya (Task 10b) dan sudah dibersihkan di Task 11, `tab-content.js`
  memilikinya sekarang. Setiap brief ekstraksi yang memotong baris kosong
  terakhir region wajib menyebut pembersihannya.
- **Klasifikasi jarak komentar bisa buta, dan kebutaannya bergeser tiap task.**
  `tests/hygiene.test.mjs:51` mensyaratkan blok komentar kolom-0 berjarak satu
  baris dari deklarasi, tapi `classifyJs` (`comment-spacing.mjs:20-58`) terjebak
  mode template pada backtick yang bertemu `${`, sehingga setelah penutup
  template tak pernah kembali ke mode kode. Akibatnya `background.js` kini
  hanya diawasi sampai `:95` — `:96`-`2247` buta. Kalau task berikutnya membuat
  gerbang ini merah, kemungkinan besar itu pelanggaran **tersimpan** yang barusan
  terbuka, bukan kesalahan gerbang: perbaiki dengan satu baris kosong, jangan
  longgarkan aturannya.
- **Sebelum setiap dispatch ekstraksi, kontrol memeriksa dua hal secara mandiri terhadap pohon hidup:** (a) setiap kandidat impor punya panggilan nyata di `background.js` **di luar** region yang dipotong; (b) setiap kandidat ekspor punya pemanggil di file **selain** dirinya sendiri. Keduanya dihitung, bukan dinilai — hasilnya dibawa ke dalam dispatch. Tiga kegagalan berturut-turut (Task 8, 9, 10) menjadikan pemeriksaan ini wajib, bukan opsional.
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
`worker/burst.js` pada Task 16 — dan `background.js` selalu menjadi
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
pertama setelah `runBurst`.

**Setelah Task 16, keduanya berada di berkas berbeda** (`runBurst` di
`burst.js`, `loopSummary` di `loop-engine.js`), jadi alasan "ikut pindah ke
berkas yang sama" tidak lagi berlaku. Yang menjaminnya kini ialah **urutan
`FILES`**: kedua modul dibuat pada Task 16, dan rencana menambahkan `burst.js`
**sebelum** `loop-engine.js`. Karena `background.js` selalu entri pertama
bundel, urutan itu membuat `indexOf(endMarker, start)` positif. Terbalik, dan
delapan tes ini merah serempak dengan pesan
*"`function loopSummary(` must follow `async function runBurst(`"*. Task 16
membawa peringatan itu di dalam brief-nya.

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
import { oversized, MAX_RESULT_BYTES, clearSerializedResult, boundedResult } from './lib/serialize.js';
```

**Empat nama, bukan tiga.** `executeCommand` **belum** pindah — itu tugas Task 18 — sehingga `background.js` masih memanggil `clearSerializedResult()` (sekali) dan `boundedResult()` (dua titik) di dalamnya, dan keduanya wajib ikut diimpor sekaligus. Rencana versi awal hanya menulis tiga nama; itu menghasilkan `ReferenceError` pada setiap perintah yang tidak tertangkap suite mana pun, karena jalur itu tak diuji.

Yang betul-betul permanen hanya `oversized` (`background.js:1890`) dan `MAX_RESULT_BYTES` (`:1897`) — keduanya dipakai `dispatch`, yang tidak pernah berpindah. `serializeResult` memang tidak diimpor karena tidak punya pemanggil di `background.js`.

**Kewajiban Task 18:** memangkas baris impor ini menjadi `import { oversized, MAX_RESULT_BYTES } from './lib/serialize.js';` begitu `executeCommand` berpindah — tanpa itu dua nama terakhir jadi impor mati.

- [ ] **Step 4b: Putar ulang jangkar akhir irisan `boundedResult`**

`tests/hygiene.test.mjs` memotong dari `function boundedResult` ke
`// ---- Event-Triggered Workflows: watch registry`. Jangkar pertama kini
pindah ke `extension/lib/serialize.js`, sedangkan jangkar kedua masih ada di
`background.js` — **entri pertama bundel** — sampai Task 17. Urutannya jadi
terbalik: `indexOf` pertama menghasilkan indeks yang lebih besar, irisan jadi
kosong, dan asersi `exactly one stringify` gagal dengan `0 !== 1`. Inilah satu-satunya
penghalang task ini, dan ia berlaku selama Task 8 sampai Task 16.

Ganti jangkar akhirnya dengan penanda yang hidup **di modul yang sama dan
selalu sesudahnya**:

```js
  const block = background.slice(
    background.indexOf('function boundedResult'),
    background.indexOf('function clearSerializedResult() {')
  );
  assert.ok(
    background.indexOf('function clearSerializedResult() {')
      > background.indexOf('function boundedResult'),
    'the result-sizing block must have a live end marker after boundedResult'
  );
```

Bukti aman: blok yang dihasilkan mencakup `boundedResult`, `oversized`,
komentar memo, `let serializedResult`, dan `serializeResult` — tepat **satu**
`JSON.stringify(` (di `serializeResult`), sehingga asersi "exactly one"
tetap benar; `function oversized` tetap ada di dalamnya untuk asersi
berikutnya; dan `clearSerializedResult` tidak pernah dihapus di task mana pun,
jadi jangkarnya bertahan sampai selesai. Penjaga `assert.ok` ditambahkan agar
jangkar yang mati gagal nyaring, bukan diam-diam membesarkan irisan.

Ini adalah **edit kedua** pada `tests/hygiene.test.mjs` untuk task ini —
yang pertama adalah penggantian asersi `serializedResult`. Keduanya diizinkan
secara eksplisit; tidak ada asersi lain yang disentuh.

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
git commit -m "refactor: bound and memoize command results in a lib module"
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
- Produces: `sleep`, `mutateTabs`, `nowIso`, `randomToken`, `getConfig`, `setState`, `connectionState` (diekspor); `isTabDragRefusal`, `STORAGE_KEYS`, `TAB_DRAG_ATTEMPTS`, `TAB_DRAG_BACKOFF_MS` (milik modul, dipakai di dalamnya).

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

Tambahkan `export` pada **tujuh** nama: `sleep`, `mutateTabs`, `nowIso`, `randomToken`, `getConfig`, `setState`, `connectionState`.

**Tujuh, bukan sembilan.** Blok asli menyebut sembilan, tapi dua di antaranya mustahil diekspor:

- `STORAGE_KEYS` — setelah region ini pindah, satu-satunya pemakai `background.js`
  adalah `getConfig`, yang ikut pindah. Namanya tidak muncul di file mana pun
  lain — bukan di test, bukan di script.
- `isTabDragRefusal` — hanya dipanggil `mutateTabs`, yang ikut pindah dan berada
  di modul yang sama. Nama ini juga tak disebut di file mana pun lain.

`tests/hygiene.test.mjs:367` menegakkan itu: *"no module under extension/, lib/,
scripts/ or supabase/functions/ exports a symbol nothing reaches"*, dan
komentarnya menyatakan khusus bahwa **di `extension/` dan `lib/`, sebuah simbol
tetap butuh pemanggil di file lain** — pemakaian di dalam file pengeskpor sendiri
tidak cukup. Jadi dua nama itu diekspor, dan suite langsung merah.

Keduanya tetap hidup dan privat: `STORAGE_KEYS` dipakai `getConfig`, dan
`isTabDragRefusal` dipakai `mutateTabs`, keduanya di dalam `utils.js`.

- [ ] **Step 3: Potong dari `background.js` dan impor**

- Hapus baris 99-162, baris 71, baris 90-96.
- Tambahkan:

```js
import { sleep, mutateTabs, nowIso, randomToken, getConfig, setState, connectionState } from './worker/utils.js';
```

**Tujuh nama, bukan empat.** Semuanya dipakai `background.js` **sekarang**, bukan
hanya oleh `dispatch`; yang belum ikut pindah justru bagian terbesarnya:

- `mutateTabs` (1837/1846/1860/1872), `nowIso` (1653), `randomToken`
  (1684/1746), `getConfig` (1644-2544) — dipakai `dispatch`, dan permanen.
- `sleep` — dipanggil `waitTabReady` (`background.js:212`, region tab-content,
  Task 12) dan `withForegroundFocusGate` (`:739`, region action-focus, Task 15),
  lalu `completeWithRetry`/`pullLoop` (2362/2419, Task 18).
- `connectionState` — dibaca `localSelfTest` (`background.js:2547`, Task 18).
- `setState` — **sembilan panggilan**, di `emitWatchEvent` (`:2069`, Task 17) dan
  sepanjang blok execute-pull (`:2236`-`:2384`, Task 18). Region-region itu masih
  ada di `background.js`; mereka baru berpindah nanti.

Empat nama saja akan menghasilkan `ReferenceError: setState is not defined`
lewat `ensurePullLoop()` → `pullLoop` → `setState` — persis cacat yang Task 8
tangkap di impornya sendiri, dan tak satu pun tes mengamatinya pada awalnya.

Tidak ada yang memakai `STORAGE_KEYS` maupun `isTabDragRefusal` di luar region
yang dipotong, sehingga keduanya tidak diimpor dan tidak diekspor (lihat langkah sebelumnya).

`connectionState` adalah `let` yang berpindah utuh ke `utils.js`, dan `setState`
— yang tetap satu modul dengannya — adalah satu-satunya yang menulis ulang;
`background.js` hanya membaca, dan binding ESM hidup sehingga nilainya selalu terkini.

- Hapus `DEFAULT_BRIDGE_URL` dari baris impor `background.js:35`, sisakan:

```js
import { LISTEN_BASE_URL } from './lib/endpoints.js';
```

`DEFAULT_BRIDGE_URL` hanya dipakai `getConfig` yang sudah pindah. Tanpa ini
tertinggal satu impor mati yang tidak ditangkap gerbang mana pun.

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
- Produces: `captureFramePrivacyProbe`, `assertCaptureFramesSafe`, `withDebugger`, `codedError`, `collectAxSummary`, `screenshotBytes`, `screenshotHash`, `screenshotLooksBlank`, `cachedScreenshot`, `rememberScreenshot`, `screenshotCache` (diekspor); `SCREENSHOT_CACHE_MS`, `SCREENSHOT_CACHE_LIMIT` (milik modul, dipakai di dalamnya).

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

`export` pada **sebelas** nama: kesepuluh fungsi (`captureFramePrivacyProbe`,
`assertCaptureFramesSafe`, `withDebugger`, `codedError`, `collectAxSummary`,
`screenshotBytes`, `screenshotHash`, `screenshotLooksBlank`, `cachedScreenshot`,
`rememberScreenshot`) plus `screenshotCache`.

**Dua dari tiga state jangan diekspor.** `SCREENSHOT_CACHE_MS` dan
`SCREENSHOT_CACHE_LIMIT` tidak punya satu pun penyebut di file lain mana pun —
tidak di modul, tidak di test, tidak di script. Setelah region ini pindah,
pemakai tunggalnya ada di dalam `capture.js` sendiri (`:363` dan `:375`),
sehingga mengekspornya langsung mematahkan `tests/hygiene.test.mjs:367`:
*"a symbol in `extension/` or `lib/` still needs a caller in another file."*
`SCREENSHOT_CACHE_MS`/`LIMIT` tetap dideklarasikan dan tetap dipakai — hanya
kata `export`-nya yang gugur. `screenshotCache` boleh diekspor karena
dibaca `background.js` (kini) lalu `private-tabs` dan `execute-pull`.

- [ ] **Step 3: Potong dari `background.js` dan impor**

- Hapus baris 288-462, 78, 79, 97.
- Tambahkan:

```js
import { assertCaptureFramesSafe, withDebugger, codedError, collectAxSummary, screenshotBytes, screenshotHash, screenshotLooksBlank, cachedScreenshot, rememberScreenshot, screenshotCache } from './worker/capture.js';
```

**Sepuluh nama, bukan dua.** Rencana versi awal hanya menulis `codedError` dan
`collectAxSummary`; keduanya memang dipakai `dispatch`, tapi mereka bukan
satwa yang paling langka. Delapan lainnya dipanggil dari region yang **belum
pindah**, jadi masih hidup di `background.js` setelah potongan ini:

- `assertCaptureFramesSafe` — `:487`
- `withDebugger` — `:512`, `:849`, `:870`, `:908`, `:964`, `:2153`
- `screenshotBytes` — `:538`; `screenshotHash` — `:561`; `screenshotLooksBlank` — `:559`
- `cachedScreenshot` — `:509`; `rememberScreenshot` — `:580`
- `screenshotCache` — `:207` (region private-tabs, Task 11) dan `:2529` (execute-pull, Task 18)

Yang **tidak** diimpor: `captureFramePrivacyProbe` (hanya dipakai di dalam
region), `SCREENSHOT_CACHE_MS`, `SCREENSHOT_CACHE_LIMIT` (hanya dipakai di
dalam modul; lihat langkah sebelumnya).

- Hapus baris `import { buildAxSummary } from './lib/ax-summary.js';` dari
  `background.js`. Satu-satunya pemakainya adalah `:311`, yang ada di dalam
  region yang sedang dipindah — barisnya jadi impor mati begitu potongan
  dilakukan.

  **Ada gerbang yang menangkap penghapusan ini, dan memang seharusnya ada:**
  `tests/ax-observation.test.mjs:149` mengunci bentuk path impor itu:

  ```js
  assert.match(background, /import \{ buildAxSummary[^}]*\} from '\.\/lib\/ax-summary\.js'/);
  ```

  Setelah region pindah, `capture.js` yang mengimpornya — dan dari `worker/`,
  path yang benar adalah `'../lib/ax-summary.js'`, bukan `'./lib/…'`. Regex
  yang mengunci tanda kutip plus `./` persis itu lalu gagal.

- [ ] **Step 3b: Putar ulang bentuk path pada asersi itu**

  Ganti baris tersebut menjadi:

  ```js
  assert.match(background, /import \{ buildAxSummary[^}]*\} from '\.{1,2}\/lib\/ax-summary\.js'/);
  ```

  **Ini penyempitan yang jujur, bukan pelemahan.** Inti klaimnya tak berubah:
  bundel tetap harus mengimpor `buildAxSummary` dari berkas bernama
  `lib/ax-summary.js`, dan tetap gagal kalau impornya dihapus sama sekali
  atau diarahkan ke berkas lain. Yang longgar hanya kedalaman modul — `./`
  versus `../` — yaitu persis hal yang rencana ini ubah, dan yang bukan milik
  klaimnya.

  Ini **edit tes kedua** pada file ini untuk task ini, dan satu-satunya.
  Sembilan asersi berikutnya dalam tes yang sama membaca bundel, dan kode
  yang mereka cari (`AX_SUMMARY_TEXT_POVERTY_CHARS`, `Accessibility.enable`,
  `withDebugger(tabId, context,`, `totalTextChars`, blok catch
  `AX_SUMMARY_COLLECTION_FAILED`) ikut pindah ke `capture.js` — jadi tetap
  cocok tanpa diubah. Dua pembaca langsung `background.js` yang lain
  (`tests/extension-source.test.mjs:12` dan
  `tests/structure-gates.test.mjs:69`) memang membaca berkasnya sendiri dan
  tidak terpengaruh.

  **Catatan:** `screenshotCache` di berkas hidup adalah `const`, bukan `let`.
  Rencana menyebut `let` — itu keliru. `const` berisi `Map` yang hanya
  dimutasi, tak pernah disetel ulang, jadi dipindahkan apa adanya adalah
  benar; jangan diubah menjadi `let` demi menyelaraskan dengan teks.

Jangan menghapus impor `./lib/debugger-session.js`: `registerDebuggerSession`
(`:1612`), `releaseDebuggerSession` (`:1155`, `:1202`, `:2095`) dan
`handleDebuggerDetach` (pendaftaran listener di `:64`) semuanya masih dipakai
`background.js` setelah region berpindah.

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

### Task 10b: Tiga perbaikan hasil review Task 10

Review menemukan dua temuan Important, keduanya nyata, plus satu header yang
kini berbohong. Ketiganya kecil dan tak mengubah perilaku.

**Files:**
- Modify: `extension/worker/capture.js`
- Modify: `extension/background.js`
- Modify: `tests/helpers/boundary-locks.mjs` (nilai hash saja)

**Interfaces:**
- Consumes: —
- Produces: — (perbaikan, bukan ekstraksi)

- [ ] **Step 1: Pindahkan komentar WHY tabCapture ke region listen**

`extension/worker/capture.js:183-189` diakhiri blok tujuh baris yang dibuka
`// WHY element capture and not tab capture: chrome.tabCapture refuses
callers…`. Isinya seluruhnya bahasa perekaman audio: WebAudio, media element,
CORS, `a silent transcript proves nothing by itself`.

`capture.js` **nol** kode perekaman — isinya `captureFramePrivacyProbe`,
`assertCaptureFramesSafe`, `withDebugger`, `codedError`, `collectAxSummary`,
`cachedScreenshot`, `rememberScreenshot`, memo screenshot. Komentar itu
didokumentasikan oleh **region listen**, yang masih di `background.js` dan
berisi `listenStart`/`postListenChunk` beserta komentar soal recorder dan
transcription windows. Judul modul Task 13 sendiri adalah
`listen — tabCapture session lifecycle and chunk streaming` — frasa yang sama
dengan pembuka komentar.

Ambil tujuh baris itu keluar dari `capture.js` dan tempatkan di
`background.js`, tepat di atas `function listenUrlFor(bridgeUrl) {`. Karena
kedua berkas sudah termasuk jalur yang diizinkan, perpindahan ini malah
**menambah** byte-identitas region: Task 13 lalu mewarisi alasan desainnya,
dan pembaca `capture.js` tidak lagi diberitahu bahwa filenya soal tabCapture.

- [ ] **Step 2: Lepas `export` dari `captureFramePrivacyProbe`**

`capture.js:15` mengekspor fungsi yang tak punya pengimpor. Pemakai
tunggalnya ada di dalam modul sendiri (`capture.js:43`, sebagai argumen
`func:`). Ekspornya hanya bertahan karena `scripts/check.mjs:111` menyebut
namanya di dalam array penanda — dan penanda itu cuma menuntut **nama** muncul
di bundel, bukan diekspor. Jadi:

- Lepas kata `export` di `capture.js:15`.
- `scripts/check.mjs:111` tetap hijau, karena nama itu masih ada di dalam
  `capture.js`.
- `tests/hygiene.test.mjs:367` ikut tetap hijau, karena simbol yang tak
  diekspor memang tak diperiksa.

Hasilnya **sepuluh** ekspor, bukan sebelas. Angka sebelas di Task 10 salah
hitung: reviewer membuktikan satu-satunya "pemanggil" ekspor itu adalah string
penanda, bukan kode. `captureFramePrivacyProbe` tetap ada dan tetap dipakai —
hanya permukaan publiknya yang dipersempit, persis prinsip yang
`tests/hygiene.test.mjs:351` nyatakan sendiri.

- [ ] **Step 3: Koreksi header `background.js`**

`background.js:4` masih menulis `… role-reconcile, agent-log, ax-summary,
popup-events, deadline-race` — `ax-summary` sudah tidak diimpor sejak Task 10.
Hapus kata `ax-summary,` saja. Sisanya biarkan: daftar itu memang sudah
parsial sebelum rencana ini, dan itu cacat lama yang dicatat terpisah.

- [ ] **Step 4: Re-pin hash, jalankan, commit**

```bash
npm test
npm run check
git add extension/worker/capture.js extension/background.js tests/helpers/boundary-locks.mjs
git commit -m "refactor: return the tabCapture rationale to listen and drop a dead export"
```

Expected: `# pass 738`, `# fail 0`, `check ok`. Hash `background.js` berubah
karena dua berkas disentuh — tempel ulang **nilai saja**, tanpa blok komentar
baru. `git status --porcelain` mesti menunjuk tepat tiga jalur.

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
- Tambahkan **impor empat nama** di `background.js`:

```js
import { privateTabIds, isPrivateTab, setPrivateTab, PRIVATE_TABS_KEY } from './worker/private-tabs.js';
```

**Empat nama, bukan nol.** Rencana versi awal menulis *"tidak ada impor baru di
`background.js` — `dispatch` tidak memakai modul ini"*. Pernyataan itu salah
dengan cara yang sama seperti cacat Task 8, 9 dan 10: ia menilai `dispatch`,
padahal yang tinggal di `background.js` bukan cuma `dispatch`. Empat nama itu
dipanggil dari tiga wilayah yang **belum ikut pindah**:

- `isPrivateTab` — `listenStart` (`:234`, `LISTEN_…`), `capturePage` (`:307`, `CAPTURE_…`)
- `setPrivateTab` — `localSelfTest` (`:2313`)
- `privateTabIds` — `localSelfTest` (`:2364`)
- `PRIVATE_TABS_KEY` — `localSelfTest` (`:2366`)

Empat `ReferenceError` asinkron yang tak diamati tes mana pun, kalau impornya
dihilangkan.

**Koreksi atribusi setelah review Task 11** (teks di atas salah satu kali, dan
reviewer menangkapnya). Panggilan itu bukan milik `localSelfTest` — yang
memilikinya empat wilayah yang belum ikut pindah, dua di antaranya bukan
fungsi bernama sama sekali melainkan blok pendaftaran listener:

- `isPrivateTab` — `listenStart` (region `listen`, **Task 13**) dan `capturePage` (region `capture-page`, **Task 14**), lalu handler `chrome.runtime.onMessage` popup (region `execute-pull`, **Task 18**)
- `setPrivateTab` — handler `chrome.runtime.onMessage` popup (**Task 18**)
- `privateTabIds` dan `PRIVATE_TABS_KEY` — callback `chrome.tabs.onRemoved` (**Task 18**)

Akar kesalahannya instruksional, bukan ketik: penghitungan memakai pencarian
`^(async )?function ` pada awal baris, lalu mengambil deklarasi terakhir di atas
titik itu. Blok `chrome.<sesuatu>.onListener(...)` bukan deklarasi fungsi, jadi
tidak pernah menggeser kepemilikan — dan seluruh ekor berkas tampak jadi
milik `localSelfTest`. **Perbaikan yang mengikat:** petakan pemanggil dengan
blok kurung setara (`{ … }` naik ke tingkat paling atas), bukan dengan daftar
deklarasi fungsi saja.

**Konsekuensi untuk Task 18:** ketiga konsumen terakhir keluar bersama
`execute-pull`, sehingga setelah Task 18 seluruh keempat nama kehilangan
pemanggil di `background.js`. Sapuan impor mati di Task 18 langkah 4b wajib
menghapus baris impor `private-tabs` seluruhnya — bukan hanya memperkecilnya.

Klaim yang **benar** dalam kalimat itu: modul ini memang tak diimpor `dispatch`
secara langsung, dan tetap termuat lewat `background.js` yang mengimpornya di
atas — bukan lewat entri `FILES`, yang memang hanya untuk berkas uji.

Ekspor keempat nama itu juga jadi sah oleh impor ini: `isPrivateTab`,
`setPrivateTab`, `PRIVATE_TABS_KEY` tidak disebut di satu pun file lain sampai
`background.js` menyebutnya, dan `tests/hygiene.test.mjs:367` menuntut pemanggil
di file berbeda.

- Hapus baris kosong ekor di `extension/worker/capture.js` (langkah pertama
  task ini, bukan bagian ekstraksinya). Task 10b memotong komentar tujuh baris
  dan meninggalkan `}\n\n`; `utils.js`, `log.js`, `serialize.js` dan
  `content.js` semuanya berakhir satu `\n`.

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
- Produces: `fetchJson`, `publicTab`, `requireTabId`, `resolveTabId`, `waitTabReady`, `contentCall`, `executeInTab`, `HTTP_URL_RE` (diekspor, **delapan**); `ensureContent` (milik modul, **tak diekspor**).

- [ ] **Step 1: Buat modulnya**

Pindahkan **utuh** baris 163-268 plus baris 74 (`HTTP_URL_RE`).

**Koordinat terverifikasi di pohon hidup** (angka di atas adalah baseline dan
sudah bergeser beberapa kali — cari berdasarkan konten): region berjalan dari
`async function fetchJson(url, body, timeoutMs = 30000) {` sampai kurung
penutup `executeInTab`, yaitu **`:83`-`:187`** plus baris kosong `:188`.
Deklarasi `const HTTP_URL_RE` ada di **`:69`**. Pemisah atasnya ialah
`let loopGeneration = 0;` (`:81`) dan `const AX_SUMMARY_TEXT_POVERTY_CHARS` (`:78`)
— keduanya **ikut tinggal**, milik task lain.

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: tab-content — content-script injection and the messaging bridge into a tab.
// @state: owns HTTP_URL_RE and the ensureContent script list; that list is pinned by manifest.content_scripts[0].js and must not be edited.
// @dependencies: utils, log, protocol.

import { log } from '../lib/log.js';
import { sleep } from './utils.js';
import { clamp } from '../lib/protocol.js';
```

- [ ] **Step 2: Ekspor** delapan nama — semua kecuali `ensureContent`.

`ensureContent` jangan diekspor. Setelah region ini pindah, satu-satunya
pemanggilnya ialah `contentCall` di dalam modul yang sama. Tiga berkas yang
menyebut namanya — `tests/efficiency.test.mjs:72`, `scripts/check.mjs:72`,
dan sebuah komentar di `tests/helpers/boundary-locks.mjs:32` — semuanya
menyapu **string** `async function ensureContent` untuk memotong bundel, bukan
memanggilnya; tak satu pun butuh kata `export`. Ini keadaan yang persis sama
dengan `captureFramePrivacyProbe`, yang sudah dilepas ekspornya di Task 10b.

Gerbang `tests/hygiene.test.mjs:367` tetap akan lulus dengan `export`
dipertahankan (karena string itu memang ada), jadi tidak ada tes yang memaksa
keputusan ini — yang memaksa ialah prinsip yang uji itu sendiri nyatakan di
`tests/hygiene.test.mjs:351`: *a public helper nothing calls is dead weight*.

- [ ] **Step 3: Potong dari `background.js` dan impor**

- Hapus region (`:83`-`:188`) dan baris `HTTP_URL_RE` (`:69`).
- Tambahkan:

```js
import { fetchJson, publicTab, requireTabId, resolveTabId, waitTabReady, contentCall, executeInTab, HTTP_URL_RE } from './worker/tab-content.js';
```

**Delapan nama, bukan lima.** Rencana versi awal hanya menulis `publicTab,
requireTabId, resolveTabId, waitTabReady, contentCall`. Hitungan terhadap pohon
hidup menemukan tiga lagi, semuanya dipanggil dari region yang belum ikut pindah:

- `fetchJson` — `readListenSession`, `capturePage`, blok `loop`/`watch` dan `execute-pull` (`:218`, `:228`, `:234`, `:252`, `:273`, `:1871`, `:1919`, `:2028`, `:2083`, `:2120`, `:2184`)
- `executeInTab` — `:1816`, `:1891`
- `HTTP_URL_RE` — `listenStart` (`:213`, `LISTEN_BLOCKED`), `capturePage` (`:286`, `CAPTURE_BLOCKED`), `localSelfTest` (`:2202`)

Ketiganya ialah `ReferenceError` asinkron yang tak diamati tes mana pun — dan
`HTTP_URL_RE` paling ironis, sebab rencana ini justru membahasnya di baris 59-60
dan 1631, hanya saja pembahasannya soal `listen` dan `capture-page` yang
mengimpor dari `tab-content`, bukan soal `background.js` yang juga memakainya.

Yang **tidak** diimpor: `ensureContent` — nol pemakai di luar region (lihat
Step 2).

- [ ] **Step 4: Daftarkan di helper dan jalankan**

Tambahkan `'extension/worker/tab-content.js',` **setelah `private-tabs.js`**
(akhiri daftar; rencana menulis `setelah utils.js` ketika daftar itu baru berisi
empat entri, dan tiga task sejak itu menambah `capture.js` lalu
`private-tabs.js`). `tests/extension-source.test.mjs` hanya mengunci
`background.js` sebagai entri pertama, jadi urutan sisanya bebas — yang
diikat cuma `serialize.js` sebelum `watch-registry.js`, dan `execute-pull.js`
terakhir.

**Jangan mengubah urutan di dalam `tab-content.js`.** Dua penggunanya memotong
bundel dengan jangkar berurutan:

```js
background.slice(background.indexOf('async function ensureContent'),
                 background.indexOf('async function contentCall'))
```

`tests/efficiency.test.mjs:72` dan `scripts/check.mjs:72` melakukan hal yang
sama persis, dan keduanya menuntut `ensureContent` muncul **sebelum**
`contentCall`. Karena potongan byte-identik, urutannya terjaga sendiri — tapi
menyusun ulang fungsi, atau memisah keduanya, akan membuat irisan itu kosong
dan menjatuhkan dua gerbang sekaligus. Perhatikan juga bahwa `indexOf` tidak
berjangkar di awal baris, sehingga awalan `export ` tidak mengganggunya.

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

**Koordinat terverifikasi di pohon hidup** (angka baseline sudah bergeser —
cari berdasarkan konten): region berjalan dari **`:83`** sampai **`:178`**.
`background.js` kini 2247 baris.

**Region ini dimulai tujuh baris lebih tinggi dari yang ditulis rencana.**
`:463` baseline ialah `function listenUrlFor`. Tapi blok komentar

```
// WHY element capture and not tab capture: chrome.tabCapture refuses callers
```

kini berdiri di **`:83`-`:89`**, tepat di atasnya, dan Task 10b meletakkannya
di sana **supaya task ini mewarisinya**. Isinya murni alasan desain
`listenStart`: WebAudio, media element, CORS, `a silent transcript proves
nothing by itself`. Kalau potongan dimulai di `listenUrlFor`, komentar itu
tinggal di `background.js` — terdampar di samping region `capture-page`,
menjelaskan sesuatu yang sudah tidak ada di berkas itu.

Jadi: potong `:83`-`:178` (96 baris = komentar 7, baris kosong, lima fungsi,
baris kosong pemisah `:178`). Baris kosong pemisah ikut terpotong supaya
`background.js` tidak berakhir dengan dua baris kosong berurutan —
**dan karena itu `listen.js` akan berakhir `}\n\n`. Hapus baris kosong ekor
itu** (lihat langkah 0).

Pemisah atasnya ialah `let loopGeneration = 0;` (`:81`) dan baris kosong
`:82` — keduanya **ikut tinggal**.

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

- [ ] **Step 2: Ekspor** **empat** fungsi: `readListenSession`, `listenStart`,
  `listenStop`, `postListenChunk`.

`listenUrlFor` **jangan diekspor.** Setelah region ini pindah, kelima
panggilannya (`:113`, `:123`, `:129`, `:147`, `:168`) berada di dalam
`listen.js` sendiri, di `listenStart` dan `listenStop`. Nama itu tidak disebut
di satu pun file lain mana pun — dan kalaupun nanti disebut `background.js`,
itu pun hanya lewat baris impor, bukan panggilan. Ini keadaan yang sama persis
dengan `captureFramePrivacyProbe` (Task 10b) dan `ensureContent` (Task 12),
keduanya sudah dilepas ekspornya. Rencana versi awal menulis "kelima fungsi" —
yang kelima itu mati.

- [ ] **Step 3: Potong dari `background.js` dan impor**

- Hapus region `:83`-`:178`.
- Tambahkan:

```js
import { readListenSession, listenStart, listenStop, postListenChunk } from './worker/listen.js';
```

**Empat nama, bukan dua.** Rencana versi awal hanya menulis `listenStart` dan
`listenStop`. Dua lagi dipanggil dari region yang belum ikut pindah:

- `postListenChunk` — `:2139`
- `readListenSession` — `:2235`

Dua `ReferenceError` asinkron di jalur yang tak ditutup tes mana pun — cacat
yang sama dengan Task 8, 9, 10, 11 dan 12.

- [ ] **Step 0: Dua pemangkasan, sebelum potongan**

1. **`extension/worker/tab-content.js:117` berakhir `}\n\n`** — sisa baris
   kosong `:188` dari region Task 12, yang brief-nya memerintahkan ikut
   dipotong. Task 11 sudah memutuskan standar ini ketika menghapus cacat yang
   sama dari `capture.js`: setiap berkas di pohon berakhir tepat satu `\n`
   (`utils.js`, `capture.js`, `private-tabs.js`, `lib/serialize.js` semuanya
   begitu). Hapus satu baris itu. Kunci tidak menyentuh `tab-content.js`,
   jadi tak ada hash yang perlu ditempel ulang.
2. Region Task 13 ikut menyisakan `}\n\n` di `listen.js` (alasannya dijelaskan
   di Step 1). Setelah langkah 3, pastikan `listen.js` juga berakhir tepat
   satu `\n`.

- [ ] **Step 4: Daftarkan di helper dan jalankan**

Tambahkan `'extension/worker/listen.js',` **setelah `tab-content.js`**
(akhiri daftar — rencana menulis `setelah capture.js`, angka yang basi sejak
Task 11 dan Task 12 menambah dua entri di belakangnya). `FILES` tumbuh
berurutan kronologis; satu-satunya urutan yang dikunci tes ialah
`background.js` pertama, `serialize.js` sebelum `watch-registry.js`, dan
`execute-pull.js` terakhir.

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
- Produces: `capturePage` (diekspor); `MAX_SCREENSHOT_BYTES` (milik modul, **tak diekspor**).

- [ ] **Step 1: Buat modulnya**

Pindahkan **utuh** baris 551-665 plus baris 77 (`MAX_SCREENSHOT_BYTES`).

**Koordinat terverifikasi di pohon hidup** (baseline sudah bergeser — cari
berdasarkan konten; `background.js` kini 2152 baris): `capturePage` berada di
**`:84`**, region berakhir di **`:198`**, dan `const MAX_SCREENSHOT_BYTES`
di **`:72`**.

Pemisah atasnya ialah `let loopGeneration = 0;` (`:82`) dan `AX_SUMMARY_TEXT_POVERTY_CHARS` (`:79`) — keduanya **ikut tinggal**.
Fungsi berikutnya, `function executionMode(params = {}) {`, ada di `:199` dan
**bukan bagian region** — ia milik region `action-focus` (Task 15).

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

- [ ] **Step 2: Ekspor** `capturePage` **saja**.

`MAX_SCREENSHOT_BYTES` **jangan diekspor.** Ketiga pemakaiannya
(`:157`, `:165`, `:167`) berada di dalam `capturePage` sendiri, dan satu-satunya
pemanggilan lain ialah deklarasinya di `:72` yang ikut berpindah. Nama itu tidak
disebut di satu pun file lain kecuali sebagai string penanda di
`scripts/check.mjs` — dan penanda itu menuntut nama *muncul di bundel*, bukan
diekspor. Keadaan ini persis dengan `captureFramePrivacyProbe` (Task 10b),
`ensureContent` (Task 12) dan `listenUrlFor` (Task 13); rencana versi awal
memerintahkan mengeksporkannya, yang kelima kalinya kalimat itu salah.

- [ ] **Step 2b: Tiga perbaikan** — dua di antaranya mendahului potongan,
  satu lagi menutupinya. Kerjakan ketiganya bersama sebelum melanjutkan
  ke Step 3, supaya potongan dan perbaikan dihitung dalam satu re-pin.

1. **Hapus baris `background.js:35`** — `import { LISTEN_BASE_URL } from './lib/endpoints.js';`.
   Setelah region `listen` pindah ke `listen.js`, tidak ada panggilan tersisa
   di `background.js` (hanya penyebutan di header `@dependencies` `:4`, yang
   memang sudah cacat lama dan tercatat terpisah).

   Tapi ada gerbang yang menahannya: `tests/endpoint-source.test.mjs:14`
   meminta bundel membawa bentuk `'./lib/endpoints.js'`. `options.js` dan
   `popup.js` memang memakai bentuk itu, tapi keduanya tidak ada di dalam
   `FILES` sehingga tidak ikut dalam bundel uji — baris `:35` adalah
   satu-satunya.

   **Otorisasi pengeditan tes:** lebarkan regex-nya menjadi
   `/\.{1,2}\/lib\/endpoints\.js/`. Sama persis dengan otorisasi Task 10
   untuk `ax-observation.test.mjs:149`: asersinya ialah *"satu-satunya sumber
   endpoint ialah `lib/endpoints.js`"*, dan itu tetap dibawa oleh
   `/supabase\.co\/functions\/v1/g` di baris `:15` — yang membuktikan tak ada
   URL keras di mana pun. Yang dilonggarkan hanya kedalaman relatif modul,
   dan tidak ada asersi yang dilepas. Ini edit tes keempat yang diizinkan.

2. **Perbaiki judul `listen.js`.** `@title` baris `:2` menulis
   *"tabCapture session lifecycle"* dan `@state` baris `:3` menulis *"the
   session lives in chrome.tabCapture"* — padahal modul itu tidak pernah
   menyebut `chrome.tabCapture`. Mekanismenya ialah
   `chrome.storage.local['listenSession']` dan perekaman berjalan di dalam tab
   lewat `contentCall('media.listen_start')`.

   Ironinya: komentar WHY miliknya sendiri (`listen.js:13-19`) menjelaskan
   mengapa `chrome.tabCapture` **tidak** dipakai — menolak pemanggil tanpa
   gestur pengguna, yang tak pernah dimiliki agen otonom. Judulnya membantah
   keputusan yang didokumentasikan modul itu sendiri.

   Ganti `@title` menjadi
   `// @title: listen — the listen session lifecycle and chunk streaming.`
   dan `@state` menjadi
   `// @state: no module-private state; the session lives in chrome.storage.local['listenSession'], and recording runs inside the tab via contentCall media.listen_start.`
   Keduanya teks dari brief, jadi ini perbaikan cacat rencana, bukan selera.
   `listen.js` tidak disentuh task ini selain langkah ini.

3. **Pastikan `capture-page.js` berakhir tepat satu `\\n`.** Region `:84`-`:198`
   memasukkan baris kosong pemisah `:198`, sehingga berkas baru akan berakhir
   `}\\n\\n` — cacat yang sudah dibersihkan dari `capture.js`, `tab-content.js`
   dan `listen.js`. Jangan ulangi.

   Setelah berkas `background.js` dan `tests/endpoint-source.test.mjs` ikut
   berubah, hitung ulang hash `background.js` di langkah 4.

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
git status --porcelain   # harus tepat 6 jalur, tanpa kejutan
git add extension/worker extension/background.js tests/helpers/extension-source.mjs tests/helpers/boundary-locks.mjs tests/endpoint-source.test.mjs
git commit -m "refactor: split page capture out of background into worker/capture-page.js"
```

Enam jalur: `capture-page.js` (baru), `background.js`, `listen.js` (dua baris
judul), `tests/helpers/extension-source.mjs`,
`tests/helpers/boundary-locks.mjs` (nilai hash), dan
`tests/endpoint-source.test.mjs` (regex satu baris). Pesan commit memperbaiki
draf rencana yang menulis *"out of capture.js"* — regionnya ada di
`background.js`.

---

### Task 15: `extension/worker/action-focus.js`

**Files:**
- Create: `extension/worker/action-focus.js`
- Modify: `extension/background.js:666-1115`
- Modify: `tests/helpers/extension-source.mjs`

**Interfaces:**
- Consumes: `./utils.js`, `./tab-content.js`, `./capture.js`, **`../background.js`** (sementara), `../lib/log.js`, `../lib/protocol.js`, `../lib/action-pipeline.js`, `../lib/focus-gate.js`, `../lib/keyboard.js`, `../lib/popup-events.js`.
- Produces (diekspor, **tiga belas**): `executionMode`, `withInputFocusEmulation`, `sampleTabFocus`, `withForegroundFocusGate`, `popupLog`, `withActionPopupTracking`, `notReadyError`, `runActionPipeline`, `trustedClick`, `trustedFill`, `trustedPointer`, `trustedKey`, `burstStepParams`.
  Sisanya (**delapan**) milik modul, **tak diekspor**: `foregroundRequired`, `popupInFlightTab`, `prunePopupLog`, `notFoundHint`, `burstPassthroughRef`, `popupActionStack`, `POPUP_LOG_MAX_AGE_MS`, `UV_WAIT_FLOOR_MS`.

  Rencana versi awal memerintahkan `export` pada "kedelapan belas fungsi plus
  keempat state" — dua puluh dua. Hitungan terhadap pohon hidup memang
  menemukan dua puluh satu deklarasi, tapi hanya tiga belas yang punya pemanggil
  di luar dirinya sendiri. Delapan lainnya dipanggil **di dalam** region
  (`popupInFlightTab` oleh `withActionPopupTracking`, `prunePopupLog` oleh
  pelacakan popup, `notFoundHint` oleh `runActionPipeline`, `burstPassthroughRef`
  oleh `burstStepParams`, dst.) dan tak satu pun disebut di berkas lain mana pun.

  Pengujinya sederhana: kalau disebut, kenapa rencana ini tidak menuliskan
  keempat modul berikutnya yang mengimpornya? Semua yang dibutuhkan Task 16
  (`executionMode`, `withInputFocusEmulation`, `notReadyError`,
  `burstStepParams`), Task 17 (`executionMode`, `withInputFocusEmulation`,
  `withForegroundFocusGate`, `runActionPipeline`, `trustedClick`) dan Task 18
  (`notReadyError`) sudah ada di tiga belas itu. Delapan nama itu akan jadi
  permukaan mati — keadaan yang sudah dua kali dibersihkan di task ini
  (`captureFramePrivacyProbe`, `ensureContent`, `listenUrlFor`,
  `MAX_SCREENSHOT_BYTES`).

Siklus yang diterima: selama `loop-engine` masih di `background.js`, modul ini mengimpor `finishLoop`/`finishStateLoop` dari sana. Task 16 mengalihkannya ke `./loop-engine.js`.

**`dispatch` tidak ikut diimpor.** Empat kemunculan kata itu di dalam region
(`:113`, `:118`, `:154`, `:170`) semuanya komentar dan satu perbandingan string
`decision.outcome === 'dispatch'` — bukan panggilan. Modul ini tidak
memanggilnya.

- [ ] **Step 1: Buat modulnya**

Pindahkan **utuh** baris 666-1115.

**Koordinat terverifikasi di pohon hidup** (baseline sudah bergeser — cari
berdasarkan konten; `background.js` kini 2042 baris): region = **`:83`-`:538`**,
yaitu **456 baris**. Jumlahnya melebihi baseline 450 baris karena Task 14
menambahkan enam baris kosong di dalam rentang ini.

- **Ambang atas** (ikut tinggal): `let loopPromise = null;` (`:80`) dan
  `let loopGeneration = 0;` (`:81`). `:82` ialah baris kosong pemisah.
- **Ambang bawah** (ikut tinggal): `function burstResultSize(results) {`
  di **`:539`** — pintu masuk region `loop-engine` (Task 16).
  `async function runBurst` di `:543` juga milik Task 16.
- Dua penanda yang dipakai `tests/hygiene.test.mjs:305-313` dan
  `tests/extension-source.test.mjs:43-50` berada **di dalam** region:
  `withForegroundFocusGate` (`:135`) dan komentar `// Action Pipeline` (`:168`).
  Keduanya berpindah bersama, jadi irisan 34 baris itu tetap utuh — selama
  `action-focus.js` masuk `FILES`. Ini bukan kebetulan yang boleh dilanggar:
  memisahkan keduanya menjatuhkan dua gerbang sekaligus.

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

**Blok impor di atas sudah terverifikasi lengkap, jangan dikurangi.** Ia
memuat tepat 21 nama: 17 yang muncul di region (`FOCUS_GATE_ATTEMPTS`,
`FOCUS_GATE_SETTLE_MS`, `METHOD_SPECS`, `POPUP_LOG_LIMIT`, `attachResolution`,
`clamp`, `classifyResolve`, `contentCall`, `decideFocusGate`, `log`,
`makeNotReady`, `pollDelays`, `recordPopup`, `resolveKeyInput`,
`resolvePopupOpener`, `sleep`, `withDebugger`) ditambah empat dari
`background.js`. `popupsSince` **tidak** ikut — ia hanya dipakai di `:1407`
dan `:1415`, di luar region.

- [ ] **Step 2: Ekspor** **tiga belas** nama — daftarnya ada di bagian
  **Interfaces** di atas. Delapan sisanya tetap privat.

- [ ] **Step 3: Potong dari `background.js`, rapikan impornya, lalu impor balik**

- Hapus region `:83`-`:538`.
- Tambahkan blok impor ini (empat belas baris, bukan sembilan nama):

```js
import {
  executionMode,
  withInputFocusEmulation,
  sampleTabFocus,
  withForegroundFocusGate,
  withActionPopupTracking,
  notReadyError,
  runActionPipeline,
  trustedClick,
  trustedFill,
  trustedPointer,
  trustedKey,
  burstStepParams,
  popupLog,
} from './worker/action-focus.js';
```

**Empat belas nama, bukan sembilan.** Rencana versi awal hanya menulis
`executionMode, sampleTabFocus, withActionPopupTracking, runActionPipeline,
trustedClick, trustedFill, trustedPointer, trustedKey, popupLog`. Empat lagi
dipanggil dari region yang belum ikut pindah:

- `withInputFocusEmulation` — `:857`, `:1653`
- `withForegroundFocusGate` — `:1654`
- `notReadyError` — `:631` (di `runBurst`, Task 16), `:1683`, `:1704`
- `burstStepParams` — `:618` (di `runBurst`, Task 16)

Empat `ReferenceError` asinkron — cacat yang sama dengan Task 8, 9, 10, 11,
12, 13 dan 14.

- **Empat baris impor `background.js` jadi mati oleh potongan yang sama**, dan
  tidak ada gerbang yang menangkapnya (ujian mati-ekspor hanya memeriksa simbol
  yang *diekspor*, dan `background.js` tidak punya satu pun baris `export`):

  | baris | isi | tindakan |
  |---|---|---|
  | `:58` | enam nama `capture.js` yang sudah mati sejak Task 14 | potong jadi `import { withDebugger, codedError, collectAxSummary, screenshotCache } from './worker/capture.js';` |
  | `:32` | `pollDelays, classifyResolve, makeNotReady, attachResolution` | **hapus seluruh baris** |
  | `:33` | `decideFocusGate, FOCUS_GATE_ATTEMPTS, FOCUS_GATE_SETTLE_MS` | **hapus seluruh baris** |
  | `:49` | `recordPopup, popupsSince, resolvePopupOpener, POPUP_LOG_LIMIT` | potong jadi `import { popupsSince } from './lib/popup-events.js';` |

  Verifikasi: kesepuluh nama di baris `:32`, `:33` dan yang mati dari `:49`
  hanya dipakai di dalam region. `popupsSince` tetap hidup di `:1407` dan
  `:1415`. Tak ada penanda di `scripts/check.mjs` yang menuntut nama-nama itu
  tetap muncul di bundel.

  Baris `:58` bisa dibersihkan **sebelum** potongan (ia sudah mati sekarang);
  tiga sisanya baru mati setelah region hilang. Kerjakan keempatnya dalam satu
  commit, sekali re-pin.

`popupLog` ikut diimpor karena `dispatch` membacanya. Ia `const` berbentuk objek — dibaca dan dimodifikasi, tidak pernah ditulis ulang, jadi aman.

- [ ] **Step 4: Daftarkan di helper dan jalankan**

Tambahkan `'extension/worker/action-focus.js',` setelah `capture-page.js`.

```bash
npm test
npm run check
git status --porcelain   # harus tepat 4 jalur
git add extension/worker extension/background.js tests/helpers/extension-source.mjs tests/helpers/boundary-locks.mjs
git commit -m "refactor: move the focus gate and trusted input into worker/action-focus.js"
```

Empat jalur: `action-focus.js` (baru), `background.js`,
`tests/helpers/extension-source.mjs`, dan `tests/helpers/boundary-locks.mjs`
(nilai hash — tanpa komentar bertanggal baru).

Ukuran yang diharapkan: `background.js` 2042 → **sekitar 1599** — region 456
baris terpotong, dua baris impor mati terhapus, satu blok impor 15 baris
ditambahkan.

Kegagalan yang mungkin terjadi di sini: `background-load.test.mjs` gagal dengan `ReferenceError: finishLoop is not defined` atau `... is not a function`. Itu berarti siklus sementara tidak terbentuk dengan benar — periksa bahwa `background.js` masih mendefinisikan `finishLoop` (Task 16 belum berjalan) dan bahwa impor modul ditulis persis seperti di atas.

---

### Task 16: `extension/worker/loop-engine.js` + alihkan impor `action-focus`

**Files:**
- Create: `extension/worker/burst.js` **(baru — lihat rincian di bawah)**
- Create: `extension/worker/loop-engine.js`
- Modify: `extension/worker/action-focus.js` (satu baris impor **dan satu baris `@state`**)
- Modify: `extension/background.js:96-628`, `:84`, **dan satu kata kunci `export` di `:630`**
- Modify: `extension/lib/loop.js:3`
- Modify: `tests/helpers/extension-source.mjs`
- Modify: `tests/helpers/boundary-locks.mjs`

**Rencana versi awal membuat satu berkas. Ia tidak bisa.**

Ambang `tests/structure-gates.test.mjs:78` menuntut tiap modul worker
`< 550` baris. Region ini 533 baris; ditambah header 5 baris dan blok impor
26 baris, satu berkas menjadi **565** — merah. Implementer Task 16 menemukan
ini betulan dan berhenti, benar, daripada menaikkan ambang: rencana sendiri
menulis di Task 6, *"selidiki, jangan naikkan ambang."*

Solusinya bukan menaikkan angka, melainkan memeriksa apakah region itu
benar-benar satu unit. **Ternyata tidak.** Pengukuran terhadap pohon:

- Bagian burst (`:96`–`:223`, **128 baris**) memanggil **tak satu pun** simbol
  dari bagian loop.
- Bagian loop (`:224`–`:628`, **405 baris**) memanggil `runBurst` **nol kali**
  dan `burstResultSize` **nol kali**.
- `dispatch` dipakai **hanya di bagian burst** (`:178`).
- `MAX_BURST_RESULT_BYTES` (`:84`) hanya dipakai di `:186`, di dalam `runBurst`.

Jadi ada dua unit yang mandiri. Keduanya jauh di bawah ambang: **`burst.js`
±146 baris**, **`loop-engine.js` ±426 baris**. Tidak ada aturan yang dilanggar,
tidak ada gerbang yang diubah, dan `loop-engine.js` kehilangan kepadatan yang
tidak pernah ia butuhkan.

**Urutan `FILES` menentukan.** `tests/burst-tab-switching.test.mjs` (8 pemanggilan)
memotong dari `'async function runBurst('` ke `'function loopSummary('`. `runBurst`
akan ada di `burst.js` dan `loopSummary` di `loop-engine.js`; `sliceBetween`
memakai `indexOf(endMarker, startMarker)`, jadi `burst.js` **harus** muncul
sebelum `loop-engine.js` di dalam `FILES`. Keduanya ditambahkan pada task ini,
dalam urutan itu. Terbalik, dan delapan tes merah serempak dengan
*"`function loopSummary(` must follow `async function runBurst(`"*.

**Interfaces:**

**`burst.js`**
- Consumes: `./action-focus.js`, `./tab-content.js`, **`../background.js`** (`dispatch`), `../lib/log.js`, `../lib/protocol.js`, `../lib/debugger-session.js`.
- Produces (diekspor, **satu**): `runBurst`.
  `burstResultSize` privat (dipanggil hanya di `:186`, di dalam `runBurst`),
  `MAX_BURST_RESULT_BYTES` privat (satu-satunya pemakaian di luar region ialah
  deklarasinya sendiri di `:84`, dan deklarasi itu ikut pindah ke sini).

**`loop-engine.js`**
- Consumes: `./action-focus.js`, `./tab-content.js`, `../lib/log.js`, `../lib/protocol.js`, `../lib/loop.js`, `../lib/keyboard.js`, `../lib/debugger-session.js`. **Tidak mengimpor `background.js`.**
- Produces (diekspor, **empat belas**): `loopSummary`, `finishLoop`, `loopSessionOnTab`, `stateSummary`, `finishStateLoop`, `handleStateEvent`, `loopDecodeTemplate`, `loopTickLater`, `LOOP_MAX_ACTIVE`, `loopSessions`, `loopResults`, `STATE_READERS`, `stateSessions`, `stateResults`.
  Sebelas sisanya milik modul, **tak diekspor**: `loopSnapshot`, `loopCropRegion`, `loopSyntheticKey`, `loopTrustedKey`, `loopTrustedPointer`, `loopActKey`, `loopAct`, `loopSense`, `loopTick`, `LOOP_POLICY_RECHECK_TICKS`, `LOOP_SUSPEND_FLOOR_MS`.
  Dua yang terakhir tidak tercatat di Produces versi awal tetapi berada di dalam region.

  Rencana versi awal memerintahkan `export` pada "kesembilan belas fungsi plus
  ketujuh state" dan menulis lima belas nama untuk `background.js`. Keduanya
  dihitung ulang terhadap pohon hidup setelah pembelahan: **1 + 14 = 15**,
  jumlahnya persis sama, hanya terbagi ke dua berkas. Yang hilang dari blok
  impor rencana versi awal ialah `handleStateEvent` (dipanggil `:1503`, di
  region yang belum berpindah) — cacat kelas yang sama untuk ke sepuluh kalinya.

  Pengujinya tetap: kalau sebuah nama disebut, kenapa rencana ini tidak
  menuliskan modul berikutnya yang mengimpornya? Task 17 hanya mengambil
  `{ runBurst }` (kini dari `./burst.js`) dan Task 18 tidak mengambil apa pun
  dari keduanya.

**Catatan tentang siklus:** kini hanya `burst.js` yang mengimpor balik dari
`background.js` (untuk `dispatch`). `loop-engine.js` **bebas siklus** — keputusan
pembelahan memperbaiki dua siklus menjadi satu.

- [ ] **Step 1: Buat dua modul**

**Koordinat terverifikasi di pohon hidup** (baseline sudah bergeser — cari
berdasarkan konten; `background.js` kini 1602 baris). Region 533 baris itu
terbelah di **antara `:223` dan `:224`**:

| modul | region | ukuran akhir |
|---|---|---|
| `extension/worker/burst.js` | **`:96`–`:223`** (128 baris) + `const MAX_BURST_RESULT_BYTES` di **`:84`** | ±145 |
| `extension/worker/loop-engine.js` | **`:224`–`:628`** (405 baris) | ±426 |

- **Ambang atas** (ikut tinggal): `const AX_SUMMARY_TEXT_POVERTY_CHARS = 400;` (`:91`), `let loopPromise = null;` (`:93`), `let loopGeneration = 0;` (`:94`), baris kosong (`:95`). Dua yang terakhir milik **Task 18** — `loopPromise` dipakai di `:1415`–`:1427`, `loopGeneration` di `:1302`, `:1388`.
- **Ambang bawah** (ikut tinggal): baris kosong (`:629`) lalu `async function dispatch(method, params = {}, context = {}) {` di **`:630`** — dispatch ialah Task 18. Potong **tepat sampai `:628`**, baris penutup `loopTick`.
- Setelah `:84` berpindah, **`background.js` tidak lagi menyebut `MAX_BURST_RESULT_BYTES` sama sekali**.

**`extension/worker/burst.js`**

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: burst — run a burst of actions against a tab, bounded by time and result size.
// @state: owns MAX_BURST_RESULT_BYTES; background.js reads runBurst through this export.
// @dependencies: action-focus, tab-content, background, log, protocol, debugger-session.

import { log } from '../lib/log.js';
import {
  BURST_ACTION_METHODS,
  BURST_MAX_TIMEOUT_MS,
  burstCrossTabRef,
  burstStaleRef,
  normalizeError,
} from '../lib/protocol.js';
import { releaseDebuggerSession } from '../lib/debugger-session.js';
import { resolveTabId } from './tab-content.js';
import { executionMode, burstStepParams, notReadyError } from './action-focus.js';
import { dispatch } from '../background.js';
```

**`extension/worker/loop-engine.js`**

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: loop-engine — the sense-act and state loop sessions.
// @state: owns loopSessions, loopResults, stateSessions, stateResults, STATE_READERS and LOOP_MAX_ACTIVE; background and action-focus read them through this export.
// @dependencies: action-focus, tab-content, log, loop, keyboard, debugger-session.

import { log } from '../lib/log.js';
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
import { contentCall } from './tab-content.js';
import { withInputFocusEmulation } from './action-focus.js';
```

**Kedua blok impor terverifikasi lengkap terhadap masing-masing region, jangan dikurangi.** Setelah pembelahan, `dispatch` **hanya** di `burst.js` dan `loop-engine.js` **tidak mengimpor `background.js` sama sekali** — itu keuntungan tambahan dari pemisahan, dan `@dependencies` kedua modul mencerminkannya. `log` dan `releaseDebuggerSession` muncul di keduanya karena kedua region memakainya.

- [ ] **Step 2: Ekspor** **satu** nama dari `burst.js` (`runBurst`) dan **empat belas** dari `loop-engine.js` — daftar lengkapnya di bagian **Interfaces** di atas. Sebelas nama loop tetap privat, begitu pula `burstResultSize` dan `MAX_BURST_RESULT_BYTES`.

- [ ] **Step 3: Tiga perbaikan, sebelum potongan**

Ketiganya bersifat wajib dan saling bergantung: tanpa yang pertama, modul tak
bisa dimuat; tanpa yang kedua, `action-focus` jatuh pada waktu yang jauh lebih
mahal.

**3a. Ekspor `dispatch` di `background.js:630`.**

Task 15 membuktikan cacat ini tepat saat terjadi — brief menyuruh mengimpor
`finishLoop` dari `background.js`, padahal berkas itu tidak mengekspor apa pun,
dan `background-load.test.mjs` langsung gagal dengan
`SyntaxError: does not provide an export named 'finishLoop'`. Empat nama itu
kini diekspor (penambahan Task 15), tapi **`dispatch` belum.**

`burst.js` menggunakannya di **`:178`** — satu-satunya pemakaian `dispatch`
di seluruh region:

```js
const result = await dispatch(method, burstStepParams(step, stepTabId, remainingMs, mode, results), context);
```

Jadi ubah `async function dispatch(method, ...)` menjadi
`export async function dispatch(method, ...)`. Tanpa ini Task 16 gagal sama
persis cara dengan Task 15, dan Task 17 (`watch-registry`) serta Task 18
(`execute-pull`) ikut mengimpornya — mereka sudah menuliskan
`import { dispatch } from '../background.js'` di rencananya masing-masing.

Pertimbangan keamanan: `background.js` memang sudah menjadi sumber siklus
(`action-focus` mengimpornya), jadi satu baris ini tidak menciptakan pola baru
— ia hanya melengkapi pola yang sudah ada. Reach-nya juga jujur sejak saat ini:
tiga modul worker akan menyebutnya.

**3b. Bawa keempat kata kunci `export` ikut bersama deklarasinya.**

`export const loopSessions`, `export async function finishLoop`,
`export const stateSessions`, `export function finishStateLoop` semuanya
berada **di dalam region** (`:232`, `:253`, `:282`, `:299`). Potongan
memindahkannya ke `loop-engine.js` **lengkap dengan kata kunci** — jangan
dilepas. Itulah yang membuat langkah 3c di bawah aman.

**3c. Alihkan blok impor `action-focus.js` dari `background.js` ke `./loop-engine.js`.**

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

**Bonus: perbaiki `action-focus.js:3`, lini waktu berhenti dari `background.js`.**

Temuan review Task 15: baris `@state` menulis *"...loop-engine reads
popupLog/stateSessions from here through this export"* — padahal arahnya
terbalik. `popupLog` memang dibaca `loop-engine` **dari sini**, tapi
`stateSessions` di dalam modul ini ialah **yang diimpor** dari `background.js`
(baris 15), dan setelah 3b baris itu diarahkan ke `./loop-engine.js`.
Tukar:

```js
// @state: owns the popup focus log and its floor; loop-engine reads popupLog/stateSessions from here through this export.
```

menjadi:

```js
// @state: owns the popup focus log and its floor; loop-engine reads popupLog from here, and this module takes stateSessions from loop-engine.
```

Ini satu-satunya edit di `action-focus.js` selain 3c.

- [ ] **Step 4: Potong dari `background.js` dan impor**

- Hapus region **`:96`-`:628`** (533 baris) dan baris **`:84`**
  (`MAX_BURST_RESULT_BYTES`).
- Tambahkan **dua blok impor** ini:

```js
import { runBurst } from './worker/burst.js';
import {
  loopSummary,
  finishLoop,
  loopSessionOnTab,
  stateSummary,
  finishStateLoop,
  handleStateEvent,
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

Total **lima belas nama**, terbagi 1 + 14 sesuai pembelahan.

**`handleStateEvent` ialah nama yang hilang dari rencana versi awal.** Ia
dipanggil di **`:1503`**, di region yang belum ikut pindah. Tanpanya
`handleStateEvent is not defined` — kegagalan asinkron yang sama dengan cacat
sembilan kali sebelumnya.

Yang **tidak** ikut diimpor: `MAX_BURST_RESULT_BYTES` (setelah `:84` pindah,
`background.js` tidak menyebutnya lagi), `loopPromise` dan `loopGeneration`
(keduanya masih milik `background.js` sampai Task 18).

- [ ] **Step 5: Perbarui `extension/lib/loop.js:3`**

Ganti:

```js
// @state: validator and tick-band classifier only; no executor yet.
```

menjadi:

```js
// @state: validator and tick-band classifier only; the executors live in extension/worker/loop-engine.js (loopSessions, loopTick) and extension/worker/burst.js (runBurst).
```

`runBurst` **tidak lagi** ada di `loop-engine.js` setelah pembelahan, jadi
menyebutnya di sana akan menjadi komentar yang membantah berkasnya sendiri —
cacat judul yang persis ditemukan pada `listen.js` di Task 14.

- [ ] **Step 6: Daftarkan di helper dan jalankan**

Tambahkan **kedua berkas, `burst.js` lalu `loop-engine.js`**, setelah `action-focus.js`. **Urutannya menentukan** — lihat peringatan di bagian **Files**.

```bash
npm test
npm run check
git status --porcelain   # harus tepat 7 jalur, tanpa kejutan
git add extension/worker extension/background.js extension/worker/action-focus.js extension/lib/loop.js tests/helpers/extension-source.mjs tests/helpers/boundary-locks.mjs
git commit -m "refactor: split burst execution and the loop sessions into worker/burst.js and worker/loop-engine.js"
```

Tujuh jalur: `burst.js` (baru), `loop-engine.js` (baru), `background.js`,
`action-focus.js` (impor 3c plus baris `@state`), `extension/lib/loop.js`
(satu baris `@state`), `tests/helpers/extension-source.mjs`, dan
`tests/helpers/boundary-locks.mjs` (nilai hash — tanpa komentar bertanggal).

Ukuran yang diharapkan: `background.js` 1602 → **sekitar 1084** — region 533
baris terpotong, satu konstanta terpindah, dua blok impor (1 + 14 baris)
ditambahkan. Modul yang lahir: `burst.js` ±145 dan `loop-engine.js` ±426 —
keduanya jauh di bawah ambang 550.
Kalau `tests/hygiene.test.mjs:51` menembak lagi dan menambahkan baris kosong,
jumlahnya naik setingkat itu; koreksi itu sah dan sudah terjadi pada Task 14
(enuh baris) dan Task 15 (tiga baris).

**Lima kegagalan yang mungkin terjadi di sini, dan apa artinya:**

- `SyntaxError: does not provide an export named 'dispatch'` — langkah 3a
  terlewat. `background.js` memang tidak pernah mengekspor `dispatch` sebelum ini.
- `ReferenceError: finishLoop is not defined` / `... is not a function` —
  langkah 3b atau 3c tidak lengkap; periksa keempat kata kunci `export`
  ikut pindah dan seluruh empat nama diarahkan.
- `ReferenceError: handleStateEvent is not defined` — blok impor di Step 4
  kehilangan satu nama.
- Gerbang `hygiene` dead-export merah — sebuah dari 15 nama diekspor tapi tidak
  disebut di berkas lain. Turunkan menjadi privat, jangan tambahkan pemanggil.
- `function loopSummary( must follow async function runBurst(` — **`FILES`
  terbalik.** Delapan pemanggil `sliceBetween` memotong dari `runBurst` ke
  `loopSummary`; keduanya kini di berkas berbeda, dan `indexOf(end, start)`
  mengembalikan `-1` kalau `loop-engine.js` mendahului `burst.js`. Balikkan
  urutan kedua entri, jangan sentuh tesnya.

---

### Task 17: `extension/worker/watch-registry.js`

**Files:**
- Create: `extension/worker/watch-registry.js`
- Modify: `extension/background.js:485-707`
- Modify: `extension/worker/action-focus.js:4` (**satu baris `@dependencies`** — perbaikan dari review Task 16)
- Modify: `tests/helpers/extension-source.mjs`
- Modify: `tests/helpers/boundary-locks.mjs`

**Koordinat terverifikasi di pohon hidup** (baseline sudah bergeser dua kali —
cari berdasarkan konten; `background.js` kini **1085** baris):

| penanda | baris | catatan |
|---|---|---|
| `export async function dispatch(` | `:113` | 372 baris, **tetap** — Task 18 tidak memindahkannya |
| `// ---- Event-Triggered Workflows: watch registry ----` | `:485` | batas atas; tepat setelah penutup `dispatch` |
| `const WATCH_*` | `:490`–`:493` | empat konstanta, ikut region |
| `async function executeCommand(` | `:708` | batas bawah — **tidak ikut** |

Region = **`:485`–`:707`**, yaitu **223 baris**: banner sampai baris kosong
sebelum `executeCommand`. `:707` ikut supaya `background.js` tidak menyisakan
dua baris kosong berdampingan (`:484` dan `:707`); di modul baru, baris kosong
penutup itu dipangkas — aturan akhir satu `\n`, seperti Task 15.

**Interfaces:**
- Consumes: `./utils.js`, `./tab-content.js`, `./capture.js`, `./action-focus.js`, `./burst.js`, **`../background.js`** (`dispatch`), `../lib/log.js`, `../lib/protocol.js`, `../lib/watch.js`, `../lib/debugger-session.js`.
- Produces (diekspor, **sebelas**): `watchRuleId`, `loadWatchers`, `saveWatchers`, `watcherIdsForTab`, `pruneWatchers`, `armWatchersForTab`, `handleWatchFacts`, `commandTimeoutError`, `trustedHover`, `MAX_WATCHERS_PER_TAB`, `MAX_WATCHERS_GLOBAL`.
  Enam lainnya milik modul, **tak diekspor**: `tabExists`, `emitWatchEvent`, `executeWatchAction`, `handleWatchFire`, `WATCH_STATE_KEY`, `WATCH_MAX_RULES_PER_ARM`.

  Rencana versi awal memerintahkan `export` pada **"ketiga belas fungsi plus
  seluruh state `WATCH_*`"** — tujuh belas. Ternyata sebelas. Enam yang sisanya
  tidak punya pemanggil sama sekali di luar region: `tabExists` dipanggil
  `armWatchersForTab`, `emitWatchEvent` dan `executeWatchAction` dipanggil
  `handleWatchFire`, dua konstanta terakhir dipakai `loadWatchers` dan
  `armWatchersForTab`. Semua di dalam region.

  Empat yang memang disebut berkas lain (`executeWatchAction`,
  `handleWatchFire` di `debugger-session-lifecycle.test.mjs`, `trustedHover`
  di `hover-settle.test.mjs`, `MAX_WATCHERS_PER_TAB` di
  `etw-watch-engine.test.mjs`) tetap tidak dihitung jangkauan — mengutip nama
  dalam teks tes bukan pengimpor. Hanya pemanggil kode nyata yang menentukan.

- **Yang `background.js` butuh dari modul ini: sebelas — bukan delapan.**
  Blok impor rencana versi awal kehilangan `loadWatchers` (`:1064`),
  `handleWatchFacts` (`:994`) dan `commandTimeoutError` (`:721`, `:742`).
  Ketiganya dipanggil dari region yang **belum ikut pindah**: dua pertama dari
  region Task 18, ketiga dari `executeCommand`. Tanpanya, ketiganya ialah
  `X is not defined` — cacat yang sama untuk ke **sebelas** kalinya.

- [ ] **Step 0: Perbaiki `extension/worker/action-focus.js:4` (temuan review Task 16)**

Task 16 mengalihkan keempat nama `action-focus` ke `./loop-engine.js`, tapi
baris `@dependencies`nya masih menulis `background (loop helpers)` — ia
menyebut modul yang **bukan lagi** dependensinya, dan menghilangkan yang kini
jadi. Tidak ada gerbang yang menjaganya (`tests/hygiene.test.mjs` hanya menolak
teks *boilerplate* di `extension/lib/`), jadi cacat ini bisa hidup selamanya.

Ganti:

```js
// @dependencies: utils, tab-content, capture, background (loop helpers), log, protocol, action-pipeline, focus-gate, keyboard, popup-events.
```

menjadi:

```js
// @dependencies: utils, tab-content, capture, loop-engine, log, protocol, action-pipeline, focus-gate, keyboard, popup-events.
```

Satu baris, dan itu **satu-satunya** edit di `action-focus.js` pada task ini.

- [ ] **Step 1: Buat modulnya**

Pindahkan **utuh** baris `:485`–`:707` (223 baris: banner `// ----
Event-Triggered Workflows: watch registry ----`, empat `const WATCH_*`, dan
seluruh isi sampai baris kosong sebelum `executeCommand`). Baris penutup `:707`
ikut supaya `background.js` tidak menyisakan dua baris kosong berdampingan
(`:484` dan `:707`); di modul baru, baris kosong itu **dipangkas** — aturan
akhir satu `\n`, sama seperti Task 15.

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: watch-registry — event-triggered watchers: persistence, arming and firing.
// @state: owns the WATCH_* caps and both watcher tables; dispatch reads MAX_WATCHERS_PER_TAB and MAX_WATCHERS_GLOBAL from here.
// @dependencies: utils, tab-content, capture, action-focus, burst, background, log, protocol, watch, debugger-session.

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
import { runBurst } from './burst.js';
import { dispatch } from '../background.js';
```

**Blok impor di atas terverifikasi lengkap, jangan dikurangi: 18 nama.**
Tujuh belas diimpor `background.js` (`clamp`, `codedError`, `contentCall`,
`evaluateRules`, `executeInTab`, `executionMode`, `fetchJson`, `getConfig`,
`log`, `releaseDebuggerSession`, `runActionPipeline`, `runBurst`, `setState`,
`trustedClick`, `withDebugger`, `withForegroundFocusGate`,
`withInputFocusEmulation`) ditambah `dispatch`, yang satu-satunya disebut di
luar daftar itu karena ia dideklarasikan — bukan diimpor — oleh `background.js`.

- [ ] **Step 2: Ekspor** **sebelas** nama — daftarnya ada di bagian
  **Interfaces** di atas. Enam sisanya tetap privat.

- [ ] **Step 3: Potong dari `background.js` dan impor**

- Hapus baris **`:485`–`:707`** (223 baris).
- Tambahkan ini — **sebelas nama, bukan delapan**:

```js
import {
  watchRuleId,
  loadWatchers,
  saveWatchers,
  watcherIdsForTab,
  pruneWatchers,
  armWatchersForTab,
  handleWatchFacts,
  commandTimeoutError,
  trustedHover,
  MAX_WATCHERS_PER_TAB,
  MAX_WATCHERS_GLOBAL,
} from './worker/watch-registry.js';
```

**Tiga yang hilang dari rencana versi awal** — dan ketiganya dipanggil dari
region yang **masih tinggal**:

| nama | pemanggil | setelah Task 17 |
|---|---|---|
| `loadWatchers` | `:1064` | pindah ke `execute-pull.js` di Task 18 |
| `handleWatchFacts` | `:994` | pindah ke `execute-pull.js` di Task 18 |
| `commandTimeoutError` | `:721`, `:742` | tetap di `executeCommand`, **tinggal di `background.js`** |

Omitting them is the same `X is not defined` failure for the eleventh time
across tasks 8–16 — and unlike the earlier ten, two of these three will be
removed again by task 18's sweep, so a reviewer reading the final tree will
not see them here at all. The task must still be correct at this commit.

Yang **tidak** ikut diimpor: enam nama privat (`tabExists`, `emitWatchEvent`,
`executeWatchAction`, `handleWatchFire`, `WATCH_STATE_KEY`,
`WATCH_MAX_RULES_PER_ARM`) — semuanya hanya dipanggil di dalam region.

- [ ] **Step 4: Daftarkan di helper, re-pin, dan jalankan**

Tambahkan `'extension/worker/watch-registry.js',` **setelah
`extension/lib/serialize.js`** (indeks 3). Ini bukan selera:

```js
// tests/extension-source.test.mjs:29
assert.ok(idx('extension/lib/serialize.js') < idx('extension/worker/watch-registry.js'),
  'serialize must precede watch-registry');
// :32 — jangkarnya ada di serialize.js
assert.ok(src.indexOf('// ---- Event-Triggered Workflows') > src.indexOf('function boundedResult'));
```

`function boundedResult` ada di `extension/lib/serialize.js:8`, dan tanda
`// ---- Event-Triggered Workflows` kini **pindah** dari `background.js`
(indeks 0) ke `watch-registry.js`. Simpanlah setelah `serialize.js`; letaknya
di antara berkas worker mana pun setelah itu bebas — tidak ada satu pun irisan
yang melintasi batas ini.

**Yang perlu diketahui sebelum menjalankan** — dua irisan menyentuh berkas ini
dan keduanya selamat, bukan karena keberuntungan tapi karena bergerak bersama:

- `tests/debugger-session-lifecycle.test.mjs:51` memotong dari
  `'async function executeWatchAction('` ke `'async function handleWatchFire('`
  — **kedua penanda ada di region** (`:667` dan sebelumnya), jadi keduanya
  berpindah ke berkas yang sama dan urutannya tak terbalik.
- `tests/hover-settle.test.mjs:128` memotong `trustedHover` sampai `\n}\n` —
  penanda penutupnya baris `:706` yang ikut berpindah. Setelah baris kosong
  `:707` dipangkas, pola itu jatuh pada akhir berkas dan **tetap cocok**.

Blok `dispatch` (`:113`–`:484`) **tidak** menyentuh region ini: `case`
`page.read`/`page.query` (`:425`) dan `watch.*` (`:238`–`:284`) semuanya di
dalamnya dan semuanya tinggal.

Re-pin `tests/helpers/boundary-locks.mjs` — nilai hash saja, tanpa komentar
bertanggal.

```bash
npm test
npm run check
git status --porcelain   # harus tepat 5 jalur, tanpa kejutan
git add extension/worker extension/background.js extension/worker/action-focus.js tests/helpers/extension-source.mjs tests/helpers/boundary-locks.mjs
git commit -m "refactor: move the event-triggered watchers into worker/watch-registry.js"
```

Lima jalur: `watch-registry.js` (baru), `background.js`,
`action-focus.js` (Step 0), `tests/helpers/extension-source.mjs`, dan
`tests/helpers/boundary-locks.mjs`.

Ukuran yang diharapkan: `background.js` 1085 → **sekitar 875** — 223 baris
terpotong, blok impor 13 baris ditambahkan. Tak ada pernyataan *load-time* di
region (murni `const` dan `function`), jadi `background-load.test.mjs` tidak
berubah perilaku.

**Empat kegagalan yang mungkin terjadi di sini, dan apa artinya:**

- `ReferenceError: loadWatchers is not defined` / `handleWatchFacts` /
  `commandTimeoutError` — blok impor di Step 3 kehilangan satu dari tiga
  nama yang baru. Ini cacat ke-sebelas, dan dua di antaranya akan hilang lagi
  dari daftar itu di Task 18.
- `serialize must precede watch-registry` atau `the watch section marker must
  follow boundedResult` — `watch-registry.js` disisipkan setelah
  `loop-engine.js` alih-alih setelah `serialize.js`.
- `watchAction must exist` / `end > start` di
  `debugger-session-lifecycle.test.mjs` — regionnya terpotong di tengah
  `executeWatchAction`/`handleWatchFire`; periksa batas `:485`/`:707`.
- Gerbang `hygiene` dead-export merah — sebuah dari sebelas nama diekspor
  tapi tidak disebut di berkas lain. Turunkan menjadi privat, jangan
  tambahkan pemanggil.

---

### Task 18: `extension/worker/execute-pull.js` — langkah terakhir

**Files:**
- Create: `extension/worker/execute-pull.js`
- Modify: `extension/background.js:497-875`, `:113`, `:122-123`, dan satu baris kembar `:124-125`
- Modify: `tests/helpers/extension-source.mjs`
- Modify: `tests/helpers/boundary-locks.mjs` (re-pin **nilai saja** — `background.js` pasti berubah)
- Modify: `tests/structure-gates.test.mjs` (guard `<= 2647` menjadi `< 600`)

Lima jalur. Jika muncul jalur keenam, hentikan dan laporkan — kecuali
`hygiene.test.mjs:51` menembak, yang memang akan menuntut satu blank per
pelanggaran, seperti pada Task 14, 15 dan 17.

**Koordinat terverifikasi di pohon hidup.** `background.js` kini **875** baris.
Angka lama (`2269-2647`, `:73`, `:88-89`) ialah koordinat baseline yang sudah
bergeser tiga kali oleh Task 15, 16 dan 17 — jangan dipakai. Cari berdasarkan
konten:

| penanda | baris | keterangan |
|---|---|---|
| `chrome.debugger.onDetach.addListener(...)` | `:111` | **TETAP** |
| `const WAKE_ALARM = 'opera-agent-wake';` | `:113` | ikut pindah |
| `const SEMANTIC_RUNTIME_EPOCH` | `:114` | **TETAP** — pemakainya `dispatch` `:369` |
| `const AX_SUMMARY_TEXT_POVERTY_CHARS` | `:120` | **TETAP** — pemakainya `dispatch` `:400` |
| `let loopPromise` / `let loopGeneration` | `:122`, `:123` | ikut pindah |
| dua baris kosong kembar | `:124`–`:125` | **dirapikan jadi satu** |
| `export async function dispatch(` | `:126`, tutup `:496` | **TETAP** — tak tersentuh |
| `async function executeCommand(raw)` | `:498` | batas atas region |
| `ensurePullLoop();` | `:875` | batas bawah, baris terakhir |

**Region pemotongan = `:497`–`:875`, 379 baris** — baris kosong pemisah `:497`
ikut supaya `background.js` berakhir tepat di `}` penutup `dispatch`, bukan di
`}\n\n`. Modul baru menerima **`:498`–`:875`** (378 baris): ia sudah punya baris
kosongnya sendiri setelah blok impor, jadi tak perlu mewarisi `:497`.

Total berpindah: 378 baris region + 3 baris konstanta = **381**.

**Tiga hal yang BUKAN bagian region dan harus tertinggal:**

- `chrome.debugger.onDetach.addListener(handleDebuggerDetach);` (`:111`) — baseline `:69`, jauh sebelum region. Ia tetap di `background.js`, dan karena itu `background.js` menyisakan **tepat satu** pernyataan load-time. Jangan ikut memindahkannya demi "keseragaman": ia tidak pernah masuk daftar langkah mana pun, dan memindahkannya mengubah di mana `handleDebuggerDetach` diimpor tanpa ada yang memintanya.
- `SEMANTIC_RUNTIME_EPOCH` (`:114`) dan `AX_SUMMARY_TEXT_POVERTY_CHARS` (`:120`) — keduanya murni milik `dispatch`, yang tidak ikut berpindah. Ini penyebab terselubung kegagalan sapuan: sebuah konstanta kelihatan "tak terpakai" padahal pemakainya ada di fungsi yang tetap tinggal.

**Interfaces:**
- Consumes: `./utils.js`, `./tab-content.js`, `./private-tabs.js`, `./listen.js`, `./action-focus.js`, `./watch-registry.js`, **`./loop-engine.js`**, `./capture.js`, `../lib/serialize.js`, **`../background.js`** (`dispatch`), `../lib/log.js`, `../lib/protocol.js`, `../lib/options-store.js`, `../lib/model-client.js`, `../lib/external-origins.js`, `../lib/deadline-race.js`.
  **`./loop-engine.js` hilang dari daftar lama** — region memanggil `handleStateEvent`, yang hanya diimpor `background.js` dari berkas itu. Tanpanya daftar `Consumes` menjanjikan 15 modul padahal kenyataannya 16.
- Produces: **tidak ada satu pun.** Modul ini mengekspor **nol** simbol. Langkah 2 menjelaskan kenapa angka itu bukan kelalaian.

**Kenapa langkah ini yang terakhir dan selalu begitu:** region memuat **sepuluh** pernyataan load-time — delapan listener (`chrome.runtime.onMessageExternal` `:745`, `chrome.runtime.onMessage` `:764`, `onInstalled` `:824`, `onStartup` `:833`, `onAlarm` `:839`, `onChanged` `:844`, `tabs.onUpdated` `:851`, `tabs.onRemoved` `:861`) plus `chrome.alarms.create` (`:874`) dan `ensurePullLoop()` (`:875`). Rencana lama menulis "sembilan"; dihitung ulang terhadap pohon hidup hasilnya sepuluh. `WAKE_ALARM`, `loopPromise`, `loopGeneration` ikut pindah persis supaya tidak ada yang membaca binding `background.js` saat load. `background.js` mengimpornya **hanya untuk efek samping**, jadi registrasi tetap terjadi di startup — itulah satu-satunya alasan modul ini boleh diekspor nol kali.

- [ ] **Step 1: Buat modulnya**

Pindahkan **utuh** baris `:498`–`:875` plus baris `:113` (`WAKE_ALARM`), `:122` (`loopPromise`), `:123` (`loopGeneration`).

```js
// @last-edited: 2026-10-09 UTC+7.
// @title: execute-pull — command execution, pairing and the device pull loop.
// @state: owns WAKE_ALARM, loopPromise and loopGeneration; every statement here that runs at load time is listed in tests/background-load.test.mjs.
// @dependencies: utils, tab-content, private-tabs, listen, action-focus, watch-registry, loop-engine, capture, serialize, background, log, protocol, options-store, model-client, external-origins, deadline-race.

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
import { handleStateEvent } from './loop-engine.js';
import { loadWatchers, armWatchersForTab, handleWatchFacts, commandTimeoutError } from './watch-registry.js';
import { screenshotCache } from './capture.js';
import { clearSerializedResult, boundedResult } from '../lib/serialize.js';
import { dispatch } from '../background.js';
```

**Blok di atas = 43 nama dan terverifikasi lengkap terhadap pemanggil di
`:498`–`:875`. Jangan dikurangi.** Dua di antaranya hilang dari rencana lama:

| nama | dipakai di | dari modul |
|---|---|---|
| `commandTimeoutError` | `:511`, `:532` | `./watch-registry.js` |
| `handleStateEvent` | `:776` | `./loop-engine.js` |

Keduanya adalah cacat `X is not defined` kelas yang sama — ke-**dua belas** dan
**ketiga belas** kalinya — dan keduanya akan terdeteksi oleh tes
`every cross-module name is imported where it is used` di Task 19, jadi tidak
ada gunanya menghemat satu baris di sini.

- [ ] **Step 2: Ekspor nol simbol — ini perubahan dari rencana lama**

Rencana lama menyuruh `export` pada "ketiga belas fungsi plus `WAKE_ALARM`,
`loopPromise`, `loopGeneration`". **Jangan lakukan itu.** Enam belas `export`
itu tidak punya pemanggil, dan delapan di antaranya akan **merah** di
`tests/hygiene.test.mjs:367` pada baris `assert.deepEqual(noCaller, [], ...)`.

Perhitungan gerbang itu presisi (`:485-:493`): sebuah simbol "reached" kalau
muncul di file lain mana pun; untuk `extension/` syaratnya **tanpa syarat** —
`if (!usedElsewhere && runtimeModules.includes(p)) noCaller.push(where)`
tidak memandang berapa kali dipakai di file sendiri. Hasil pengukuran terhadap
161 berkas konsumen dengan terjemahan persis pola `\\bnama\\b`:

| 8 **reached** (boleh diekspor, tapi tidak perlu) | 8 **DEAD** (akan merah) |
|---|---|
| `executeCommand`, `pair`, `unpair`, `complete`, `completeWithRetry`, `flushPendingCompletion`, `pullOnce`, `heartbeat` | `completionPayload`, `pullLoop`, `ensurePullLoop`, `restartPullLoop`, `localSelfTest`, `WAKE_ALARM`, `loopPromise`, `loopGeneration` |

**Kenapa nol, bukan delapan:** tidak ada satu pun file yang mengimpor dari
modul ini. `grep "from './worker/"` terhadap seluruh `extension/` menghasilkan
nol berkas di luar `background.js`, dan `background.js` sendiri memang tidak
membutuhkan satu pun nama — audit pemanggil membuktikan ketiga belas fungsi
punya **nol** pemanggil di luar region. Delapan yang "reached" pun dicapai
karena kebetulan bunyi kata (`popup.js` punya action berbunyi `pair`,
`content.js` punya fungsi `complete` miliknya sendiri), bukan karena ada
pengimpor — gerbang tidak bisa membedakan, tapi keputusan kita bisa.

`hygiene.test.mjs:396-403` menegaskan arahnya sendiri: *"the keyword promised a
reusable API no file used. The repair is to drop the keyword, not to invent a
consumer."* Ada preseden di pohon yang sama — `extension/lib/agent-log.js`
mengekspor nol simbol. Dan sebelum pemisahan, `background.js` mengekspor tepat
satu simbol: `dispatch`. Memindahkan berkas tidak boleh menciptakan API yang
tak pernah ada.

Satu-satunya hal yang **boleh** diekspor dari modul ini ialah `dispatch`, dan
itu pun bukan miliknya — ia diimpor dari `../background.js`.

- [ ] **Step 3: Potong dari `background.js` dan ganti menjadi impor efek samping**

- Hapus baris `:497`–`:875`, `:113`, `:122`, `:123`.
- Rapikan `:124`–`:125` (dua baris kosong kembar, sudah ada sebelum task ini)
  menjadi **tepat satu** baris kosong sebelum `export async function dispatch(`.
  Setelah tiga baris konstanta terhapus, ketiganya akan berdempetan jadi tiga
  baris kosong — rapikan, jangan dibiarkan.
- Tambahkan **tepat satu baris**, diletakkan sebagai **impor terakhir** (setelah
  `dispatch`), supaya seluruh modul lain selesai dievaluasi sebelumnya:

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
  'extension/worker/watch-registry.js',
  'extension/worker/utils.js',
  'extension/worker/capture.js',
  'extension/worker/private-tabs.js',
  'extension/worker/tab-content.js',
  'extension/worker/listen.js',
  'extension/worker/capture-page.js',
  'extension/worker/action-focus.js',
  'extension/worker/burst.js',
  'extension/worker/loop-engine.js',
  'extension/worker/execute-pull.js',
];
```

**Daftar di atas adalah keadaan pohon hidup, bukan tebakan.** Daftar versi
lama menyusun `utils → tab-content → private-tabs → capture` (urutan asli
sudah `utils → capture → private-tabs → tab-content`) dan menaruh
`watch-registry` setelah `loop-engine`. Menyalinnya berarti **mengurutkan ulang**
yang sudah ada — dan `watch-registry` di belakang `loop-engine` membuat dua
asersi merah sekaligus:

```js
// tests/extension-source.test.mjs:29
assert.ok(idx('extension/lib/serialize.js') < idx('extension/worker/watch-registry.js'));
// :32 — jangkarnya 'function boundedResult' di serialize.js:8
assert.ok(src.indexOf('// ---- Event-Triggered Workflows') > src.indexOf('function boundedResult'));
```

**`private-tabs.js` tetap di daftar** walaupun `background.js` berhenti
mengimpornya pada langkah berikut — empat konsumennya ikut pindah ke
`execute-pull.js`, dan modul lain di `worker/` masih memakainya. Ini bukan
satu-satunya hal yang tampak "mati" padahal tidak; baca Step 4b sebelum
menghapus apa pun.

- [ ] **Step 4b: Sapuan impor mati `background.js`**

Setelah Task 18 ini, `background.js` hanya berisi header, konstanta, dan
`dispatch`. Impor yang tersisa di atasnya mesti disapu sampai persis berisi
yang masih dipanggil — semuanya oleh `dispatch`, atau oleh potongan yang tetap
di berkas. Baca `git grep` sendiri terhadap berkas hasil ekstraksi, jangan
percaya daftar ini, tapi titik awalnya:

```js
import { sleep, mutateTabs, nowIso, randomToken, getConfig, connectionState } from './worker/utils.js';
```

menjadi:

```js
import { mutateTabs, nowIso, randomToken, getConfig } from './worker/utils.js';
```

- `sleep` hilang: pemanggil terakhirnya (`waitTabReady`, `withForegroundFocusGate`,
  `completeWithRetry`, `pullLoop`) semuanya sudah pindah.
- `connectionState` hilang: satu-satunya pembacanya `localSelfTest`, ikut pindah.
- `mutateTabs`, `nowIso`, `randomToken`, `getConfig` tetap — dipakai `dispatch`.

Dan impor `serialize.js` dipangkas seperti pada langkah sebelumnya:

```js
import { oversized, MAX_RESULT_BYTES, clearSerializedResult, boundedResult } from './lib/serialize.js';
```

menjadi:

```js
import { oversized, MAX_RESULT_BYTES } from './lib/serialize.js';
```

- `oversized` dipakai `dispatch` (`background.js:1890`) dan `MAX_RESULT_BYTES`
  pula (`:1897`); keduanya permanen.
- `clearSerializedResult` dan `boundedResult` kini diimpor `worker/execute-pull.js`
  sendiri.

Sisanya — `./worker/*.js`, `../lib/*.js` — berlaku aturan yang sama: buang
nama yang tak punya pemanggil di `background.js`, sisakan yang dipakai `dispatch`
dan oleh potongan yang tinggal. Tanpa langkah ini nama-nama mati tertinggal
tanpa satu pun gerbang yang menangkapnya.

**Angka pembanding, diambil sebelum task ini memotong apa pun.** Di ujung
Task 17, `background.js` sudah membawa **20** nama impor tanpa pemanggil —
14 dari perpindahan burst/loop Task 16 (`BURST_ACTION_METHODS`,
`BURST_MAX_TIMEOUT_MS`, `LOOP_SYNTHETIC_DEAD_TICKS`, `LOOP_TRACK_MIN_RUN`,
`burstCrossTabRef`, `burstStaleRef`, `burstStepParams`, `centroidTrack`,
`downscaleHash`, `frontOfChanged`, `matchTemplate`, `pixelDiff`, `recordTick`,
`resolveKeyInput`) dan 6 dari pemotongan watch Task 17 (`evaluateRules`,
`executeInTab`, `releaseDebuggerSession`, `withDebugger`,
`withForegroundFocusGate`, `withInputFocusEmulation`).

**Angka akhir setelah potongan task ini: 59 nama tersisa dari 109, 50
dibuang.** Itu dihitung langsung terhadap pohon hidup, bukan diturunkan dari
rencana. Empat puluh sembilan penuh berarti sapuanmu berhenti sekitar satu
nama sebelum selesai; 59 berarti berhenti lebih awal — keduanya perlu
diulang, bukan dikompromikan.

Enam blok impor **hilang seluruhnya**, bukan sekadar mengecil. Ini bagian yang
paling mudah salah: sisa nama tinggal satu dua, mudah ditinggalkan dengan
`import { } from '...'` yang sintaksis sah tapi sampah.

```
HAPUS SELURUH: './lib/keyboard.js'           (resolveKeyInput)
HAPUS SELURUH: './lib/options-store.js'      (readModelConfig, saveModelEndpoint, saveModelKey, saveModelName)
HAPUS SELURUH: './lib/model-client.js'       (buildProbeRequest, endpointOk, MODEL_TIMEOUT_MS)
HAPUS SELURUH: './lib/external-origins.js'   (originAllowed)
HAPUS SELURUH: './lib/deadline-race.js'      (raceWithTimeout)
HAPUS SELURUH: './worker/private-tabs.js'    (privateTabIds, isPrivateTab, setPrivateTab, PRIVATE_TABS_KEY)
```

Yang **kembali penuh**, jangan disentuh:

```
'./lib/protocol.js'      sisanya (5): PRODUCT_VERSION, PROTOCOL_VERSION, METHOD_SPECS, safeUrl, clamp
'./lib/watch.js'         sisanya (1): validateRule
'./lib/loop.js'          sisanya (2): startLoopState, validateLoopProgram
'./lib/debugger-session' sisanya (2): registerDebuggerSession, handleDebuggerDetach
'./worker/utils.js'      sisanya (4): mutateTabs, nowIso, randomToken, getConfig
'./worker/tab-content'   sisanya (5): publicTab, requireTabId, resolveTabId, waitTabReady, contentCall
'./worker/listen.js'     sisanya (2): listenStart, listenStop
'./worker/action-focus'  sisanya (9): executionMode, sampleTabFocus, withActionPopupTracking, runActionPipeline, trustedClick, trustedFill, trustedPointer, trustedKey, popupLog
'./worker/loop-engine'   sisanya (13): loopSummary, finishLoop, loopSessionOnTab, stateSummary, finishStateLoop, loopDecodeTemplate, loopTickLater, LOOP_MAX_ACTIVE, loopSessions, loopResults, STATE_READERS, stateSessions, stateResults
'./worker/watch-registry' sisanya (8): watchRuleId, saveWatchers, watcherIdsForTab, pruneWatchers, armWatchersForTab, trustedHover, MAX_WATCHERS_PER_TAB, MAX_WATCHERS_GLOBAL
'./lib/serialize.js'     sisanya (2): oversized, MAX_RESULT_BYTES
'./worker/capture.js'    sisanya (2): codedError, collectAxSummary
```

Dua jebakan terselubung di daftar atas, keduanya sudah diketahui tapi tetap
layak ditulis ulang karena keduanya menyerupai kegagalan:

- `private-tabs.js` dihapus **seluruhnya** dari `background.js`, padahal
  berkasnya tetap ada dan tetap di `FILES`. "Dipakai" dan "dipakai modul ini"
  ialah dua pertanyaan berbeda; hanya yang kedua yang boleh memutuskan.
- `handleStateEvent` ikut terbuang dari `background.js` **karena pemakainya
  hanya ada di region** — padahal berkas yang mengimpornya (`loop-engine.js`)
  tetap menjadi konsumen `execute-pull.js`. Jangan sampai kehilangan itu dua
  kali: sekali sebagai impor yang terbuang di sini, sekali lagi sebagai impor
  yang tak pernah ditambahkan di Step 1.

Setelah sapuan, `background.js` berada di sekitar **463 baris** (492 sebelum
sapuan, dikurangi 29 baris blok yang mengecil atau hilang) — masih jauh di
bawah 600, jadi jangan biarkan angka itu menjadi alasan untuk menyisakan
satu nama mati pun.

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

**Ukuran yang diharapkan** — semua sudah dihitung terhadap pohon hidup, bukan
ditebak, jadi selisih berarti memotong sesuatu yang salah:

| berkas | sebelum | sesudah |
|---|---|---|
| `extension/background.js` | 875 | **~463** (492 sebelum sapuan impor, −29 baris blok yang mengecil/hilang) |
| `extension/worker/execute-pull.js` | — | **~408** (378 region + blok impor + header) |

Keduanya jauh di bawah ambangnya (`< 600` dan `< 550`).

**Re-pin `tests/helpers/boundary-locks.mjs`** untuk berkas `background.js`
baru, nilai saja tanpa komentar bertanggal, pakai `sha1Blob` di
`tests/boundary-locks.test.mjs:16-21`. Lock ini akan merah pada langkah mana
pun setelah potongan pertama — itu memang terjadi, bukan tanda ada yang
bermasalah.

Kalau ambang `< 600` itu gagal, `background.js` belum cukup kecil — periksa apakah ada baris yang seharusnya ikut berpindah tetapi tertinggal, **bukan** menaikkan ambang.

**Empat kegagalan yang mungkin terjadi di sini, dan artinya:**

- `Missing export in ...` atau `does not provide an export named 'dispatch'` —
  kata kunci `export` pada `export async function dispatch(` ikut terhapus
  oleh sapuan. Ia satu-satunya simbol yang masih diekspor `background.js`,
  dan `execute-pull.js` mengimpornya. Gerbang `background-load.test.mjs`
  menangkapnya sekaligus sebagai SyntaxError saat load.
- `these extension/ and lib/ exports have no caller in another file` —
  sebuah `export` tersangkut pada nama yang pindah ke modul ini. Ralatnya
  sama persis dengan yang tertulis di Step 2: **buang kata kuncinya**, jangan
  cari pemanggil.
- `background.js must end up below 600 lines` — sapuan Step 4b berhenti
  sebelum `git grep` benar-benar kosong, atau ada pernyataan yang seharusnya
  ikut pindah tertinggal. Ukur dulu, lalu perbaiki pemotongannya.
- `the runtime injection list must stay byte-identical to
  manifest.content_scripts[0].js` — `ensureContent` ada di dua tempat dan
  daftarnya tidak lagi identik; ini di luar scope task ini, jadi laporkan
  sebagai temuan, jangan samakan dengan menulis ulang salah satunya.

Kalau `background-load.test.mjs` gagal dengan `ReferenceError: WAKE_ALARM is not defined`, konstanta tidak ikut pindah. Kalau `loopPromise is not defined`, hal yang sama. Keduanya adalah penyebab tunggal yang dipastikan Task 18 tangani.

- [ ] **Step 6: Commit**

```bash
git status --porcelain   # harus tepat 5 jalur, tanpa kejutan
git add extension/worker extension/background.js tests/helpers/extension-source.mjs tests/helpers/boundary-locks.mjs tests/structure-gates.test.mjs
git commit -m "refactor: move command execution and the pull loop into worker/execute-pull.js"
```

`tests/structure-gates.test.mjs` masuk di sini — satu-satunya edit di berkas
itu ialah ganti guard `<= 2647` menjadi `< 600`. `tests/helpers/boundary-locks.mjs`
ikut karena `background.js` berubah bentuk. Bila muncul jalur keenam,
laporkan, jangan ikut di-commit.

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

test('no import brings in a name its own file never uses', async () => {
  const files = extensionSourceFiles();
  if (files.length === 1) return;          // belum ada modul yang dipindah
  const dead = [];
  for (const rel of files) {
    const text = await readFile(new URL(`../../${rel}`, import.meta.url), 'utf8');
    const lines = text.split('\n');

    // Sebuah pernyataan impor bisa membentang banyak baris. Tanpa penanda ini,
    // sebuah pernyataan { a, b, c } di banyak baris membaca baris kelanjutannya
    // sendiri sebagai pemakaian dan tidak pernah bisa merah — cacat yang sama
    // persis yang menyembunyikan 50 nama mati selama 18 task.
    const insideImport = [];
    let open = false;
    for (const line of lines) {
      const head = line.trimStart();
      if (open) {
        insideImport.push(true);
        if (head.includes('}')) open = false;
        continue;
      }
      const isImport = head.startsWith('import');
      insideImport.push(isImport);
      if (isImport && !head.includes('}')) open = true;
    }

    for (const m of text.matchAll(/import\s*{([^}]*)}\s*from/gs)) {
      for (const raw of m[1].split(',')) {
        const token = raw.trim().split(/\s+as\s+/).pop().trim();
        if (!token) continue;
        let uses = 0;
        for (let i = 0; i < lines.length; i++) {
          if (insideImport[i]) continue;
          // Pemakaian di komentar tetap dihitung: lebih baik tidak menyalahkan
          // daripada menyalahkan keliru. Yang dilarang di sini ialah nol.
          if (lines[i].split(/[^A-Za-z0-9_$]+/).includes(token)) uses++;
        }
        if (uses === 0) dead.push(`${rel}: ${token}`);
      }
    }
  }
  assert.deepEqual(dead, [],
    'an imported name with no call site is weight that hides the next real import');
});
```

**Tentang tes `every cross-module name is imported where it is used`.** Heuristiknya sudah divalidasi sebelum ditulis ke dalam rencana, karena tes yang berisiko salah tembak lebih berbahaya daripada tidak ada tes sama sekali:

- Dijalankan terhadap 17 modul `extension/lib/` yang sudah terpisah — **0 temuan** (108 nama diekspor, semuanya resolusi).
- **3/3 kutukan buatan tertangkap**: `ALLOWED_METHODS` dihapus dari `goal-plan.js`, `SITE_ORIGIN` dari `external-origins.js`, `compileGoalPlan` dari impor majemuk `model-client.js` — ketiganya dilaporkan, file asli kembali 0.

Kuncinya ada pada penyaringan deklarasi lokal: sebuah nama hanya dituduh kalau file itu tidak mengekspornya sendiri, tidak mengimpornya, dan tidak mendeklarasikannya dalam bentuk apa pun. Tanpa penyaringan itu, `dispatch` — nama yang juga lazim sebagai parameter — akan memunculkan dugaan palsu di mana-mana.

**Tentang tes kelima, `no import brings in a name its own file never uses`.**
Ia adalah cermin dari tes kedua dan mengisi satu-satunya celah yang tersisa di
harness: `hygiene.test.mjs:367` mengawasi ekspor mati, tapi tidak ada satu pun
gerbang yang mengawasi **impor** mati. Akibatnya terukur — 20 nama terakumulasi
lewat Task 16, lalu 50 lagi lewat Task 18, tanpa satu pun peringatan. Tanpa
tes ini, sapuan Task 18 tidak meninggalkan bukti apa pun bahwa 50 nama itu
tidak kembali pada task berikutnya.

Status validasi, dijalankan terhadap pohon hidup sebelum tes ini ditulis:
**nol impor mati** di seluruh `extension/` kecuali `background.js` yang memang
belum disapu. Karena itu tes ini hijau tepat setelah Task 18 selesai — dan
merah lagi begitu seseorang menambahkan satu nama impor yang dipakai nol kali.

Satu keputusan sadar di dalamnya: pemakaian **di dalam komentar tetap
dihitung**. Heuristik ini sengaja dibuat timpang ke arah diam — tugasnya hanya
menangkap nol, bukan menduga. Sebuah tes yang menyalahkan keliru akan dilemahkan
orang pada kesempatan pertama; tes yang hanya menangkap keadaan mustahil
(0 pemakaian) tetap dipertahankan.

- [ ] **Step 2: Jalankan suite penuh**

```bash
npm test
npm run check
```

Expected: `# fail 0`, `check ok`. `npm test` kini berjumlah **lebih dari 738**
karena langkah ini menambah lima tes; laporkan angka sebenarnya, jangan
mengklaim 738 lagi. Angka 738 ialah baseline ekstraksi, dan ekstraksinya sudah
selesai.

- [ ] **Step 3: Baca ulang seluruh tabel angka di spec**

Bandingkan angka di `docs/superpowers/specs/2026-10-09-background-modularization-design.md` *Fakta terverifikasi* dengan kondisi akhir. Kalau berbeda, **perbaiki angka di spec** — sesuai aturan yang sudah ditulis spec itu sendiri.

- [ ] **Step 4: Commit**

```bash
git add tests/extension-source.test.mjs docs/
git commit -m "test: pin state uniqueness, the injection list and the cycle that must not exist"
```
