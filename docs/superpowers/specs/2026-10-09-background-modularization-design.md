@last-edited: 2026-10-09 UTC+7.
@related: [`../../../AGENTS.md`](../../../AGENTS.md) - [`../../../README.md`](../../../README.md) - [`../../../docs/handoff.md`](../../../docs/handoff.md)

# Spec: pecah `extension/background.js` jadi `extension/worker/`

Disetujui di percakapan 2026-10-09. Satu file 2647 baris menjadi entry tipis plus
13 file baru — 11 modul `extension/worker/` dan 2 modul `extension/lib/`. Tanpa
perubahan perilaku: seluruh suite hijau sebelum dan sesudah tiap langkah, bukan
cuma di akhir. Suite itu tidak dimulai dari 743: rencana ini menambah gerbangnya
sendiri — 17 tes ditambah, tidak satu pun dihapus — dan berakhir di 743 tes.

## Intent

`background.js` dibaca sebagai satu blok 2647 baris: 100 fungsi top-level, 35
state top-level, dan **satu** banner section di seluruh file (baris 2046). Batas
wilayah tidak ditandai apa pun — pembaca hanya bisa menebaknya sambil menggulir
700 baris.

Hasil akhir: `background.js` **463 baris** — header, state yang hanya
dipakai `dispatch`, dan `dispatch` sendiri (baris 1647-2018, tidak disentuh
isinya) — plus **13 file baru**: 11 di `extension/worker/` dan 2 di
`extension/lib/`.

Pemisahan memakai satu kriteria yang terukur, bukan selera: **`chrome.*` sebagai
kode = 0 → `extension/lib/`, selain itu → `extension/worker/`.**

Keputusan yang sudah diambil dan tidak dibuka lagi:

- Pindahkan juga `execute-pull`, `utils`, dan `serialize` — karena target 450
  mustahil kalau tiga region itu tetap (98 + 372 = 470 baris sudah lewat dari
  450 sebelum satu fungsi pun dipindah).
- Terima siklus impor ESM, dokumentasikan sebagai batasan yang disengaja, dan
  tutup celahnya dengan satu tes yang benar-benar mengimport `background.js`.
  Saat ini **nol tes memuat file itu** — semuanya `fs.readFileSync`.

## Non-goals

Tidak ada perubahan perilaku, tidak ada rename fungsi, tidak ada rename file
yang sudah ada, tidak ada perombakan isi `dispatch`, tidak ada perubahan
`manifest.json`, dan `content.js` tetap sampai tahap terpisah.

## Fakta terverifikasi

Angka-angka ini diambil dari pohon bersih (`git status` kosong) sebelum spec
ditulis. Angka yang tidak bisa dibuktikan tidak masuk spec. Kalau setelah tiap
langkah angkanya berbeda, yang diperbaiki angkanya — bukan langkahnya.

### Ukuran

`background.js` 2647 baris, 100 fungsi top-level, 35 state top-level, 16 impor,
manifest bertipe `module`.

### Tiga belas region, batas dari posisi deklarasi fungsi

`chrome.*` dihitung sebagai **kode** — baris komentar dikecualikan.

| region | baris | fungsi | `chrome.*` kode | pernyataan top-level |
|---|---|---|---|---|
| header + impor | 1-98 | 0 | 1 | listener `69` |
| utilitas dasar | 99-162 | 7 | 2 | — |
| plumbing tab/content | 163-268 | 8 | 8 | — |
| tab pribadi | 269-287 | 3 | 2 | — |
| privasi capture + debugger + ax + cache screenshot | 288-462 | 10 | 7 | — |
| listen (tabCapture) | 463-550 | 5 | 4 | — |
| capturePage | 551-665 | 1 | 3 | — |
| gerbang fokus + pipeline aksi | 666-1115 | 17 | 22 | const `757,767,768,769`; listener `793,803` |
| mesin loop + loop state | 1116-1646 | 19 | 9 | const `1241,1242,1248-1250,1298-1300` |
| dispatch | 1647-2018 | 1 | 17 | — |
| serialisasi hasil | 2019-2045 | 3 | 0 | `let 2036` |
| registry watch | 2046-2268 | 13 | 4 | const `2051-2054` |
| executeCommand + pull loop | 2269-2647 | 13 | 27 | listener `2516,2535,2595,2604,2610,2615,2622,2632`; `2645` alarm; `2646` `ensurePullLoop()` |

Jumlah: **100 fungsi**, **106 `chrome.*` sebagai kode**, 2647 baris.

### `extension/lib/` hampir murni

Dari 17 file, hanya satu memakai `chrome.*` sebagai kode:
`debugger-session.js:51` (`chrome.debugger.detach`). Dua file menyebut `chrome.*`
hanya di komentar (`external-origins.js:7`, `options-store.js:7` dan `:14`).
Total `chrome.*` sebagai kode di seluruh `extension/lib/`: **1**.

### Empat siklus impor — semuanya nyata, semuanya diterima

Diverifikasi dengan mencari `name(` yang bukan properti dan bukan komentar, lalu
menghitung region definisinya:

| siklus | arah | bukti |
|---|---|---|
| `dispatch` ↔ `loop-engine` | dua arah | `background.js:1195` `await dispatch(method, burstStepParams(...))` |
| `dispatch` ↔ `watch-registry` | dua arah | `background.js:2196` `await dispatch('page.click', ...)` |
| `dispatch` ↔ `execute-pull` | dua arah | `background.js:2280`, `2301` |
| `action-focus` ↔ `loop-engine` | dua arah | `action-focus` memanggil `finishLoop`, `finishStateLoop` (`1270`, dan satu lagi); `loop-engine` memanggil `executionMode`, `withInputFocusEmulation`, `notReadyError`, `burstStepParams` |

`action-focus` **tidak** memanggil `dispatch`. Semua kecocokan itu
`Input.dispatchKeyEvent` / `Input.dispatchMouseEvent` dari chrome.debugger dan
string `'dispatch'` di `decision.outcome === 'dispatch'`.

ESM mengizinkan siklus selama yang dibaca saat *load* adalah deklarasi `function`
(yang dihoist sebelum evaluasi). Semua pemanggilan di atas ada di dalam badan
fungsi, bukan di top level — jadi **berfungsi**. Aturan yang menjamin ini ada di
bawah, judul *TDZ*.

### Tidak ada satu pun tes yang memuat `background.js`

17 file membaca `background.js` sebagai teks — semuanya `fs.readFileSync` atau
`readFile`. Nol `await import('../extension/background.js')`. Konsekuensinya:
ekspor yang salah, impor yang putus, atau siklus yang gagal **lolos dari 743 tes**
dan baru meledak di browser. Ini celah yang ditutup spesifikasi ini.

### Tidak ada tes yang mendeteksi siklus impor

Pencarian `cycle|cyclic|topolog|acyclic` di `tests/` dan `scripts/` tidak
menemukan apa pun yang relevan.

### Konvensi yang sudah berjalan

Pemisahan sebelumnya mengikutinya, dan tidak satu pun dari empat pasangan ini
menghitung duplikat nama fungsi — diverifikasi untuk seluruh **100** fungsi
`background.js` terhadap **80** fungsi di seluruh **17** modul `lib/`: **nol
tumbukan**. Karena itu modul baru boleh memakai nama aslinya apa adanya:

```
focus-gate.js (murni)        <-> withForegroundFocusGate     (background)
action-pipeline.js (murni)   <-> runActionPipeline           (background)
watch.js (murni)             <-> registry WATCH_STATE_KEY    (background)
loop.js (murni)              <-> loopSessions / loopTick     (background)
```

### Satu penanda mati, satu potongan tanpa batas, dan sembilan header yang tidak berisi

- `hygiene.test.mjs:303` memakai `indexOf('// U-V Action Pipeline')`, yang
  menghasilkan `-1` sejak `6c6f901` menghapus penanda itu. `slice(a, -1)` lalu
  menutupi **74% file**, bukan satu fungsi. Asersinya tetap lulus — yang hilang
  adalah cakupannya. Ini satu-satunya penanda yang mati.
- `hygiene.test.mjs:276` memakai `indexOf('async function executeCommand')`
  tanpa batas kedua; aman selama `execute-pull` jadi bagian **terakhir** bundel
  (lihat *Pengujian*).
- Sembilan file `extension/lib/` memuat baris `@state` identik
  `MV3 runtime library, shared with the Node suite..` — `agent-log`, `ax-summary`,
  `endpoints`, `external-origins`, `focus-gate`, `keyboard`, `popup-events`,
  `protocol`, `watch`. Tidak satu pun menyatakan isi filenya.
- `loop.js:3` menyatakan `no executor yet`. Eksekutornya (`loopSessions`,
  `loopTick`, `runBurst`) ada di `background.js`.

## Arsitektur

```
extension/
├── background.js   entry: header + impor + state yang hanya dipakai dispatch + dispatch   (463 baris)
├── content.js      tetap — tahap terpisah, IIFE klasik, tidak bisa ES module
├── lib/            MURNI: chrome.* sebagai kode = 0, kecuali daftar kecualian
│                   17 file sekarang + 2 baru (log.js, serialize.js)
└── worker/         BARU: kode service worker yang butuh chrome.*
    ├── utils.js            99-162    81 baris   7 fungsi   chrome.*  2
    ├── tab-content.js     163-268   116 baris   8 fungsi   chrome.*  8
    ├── private-tabs.js    269-287    27 baris   3 fungsi   chrome.*  2
    ├── capture.js         288-462   181 baris  10 fungsi   chrome.*  7
    ├── listen.js          463-550   107 baris   5 fungsi   chrome.*  4
    ├── capture-page.js    551-665   136 baris   1 fungsi   chrome.*  3
    ├── action-focus.js    666-1115  471 baris  17 fungsi   chrome.* 22
    ├── burst.js          1116-1646  142 baris   2 fungsi   chrome.*  0
    ├── loop-engine.js    1116-1646  431 baris  17 fungsi   chrome.*  9
    ├── watch-registry.js 2046-2268  245 baris  13 fungsi   chrome.*  4
    └── execute-pull.js   2269-2647  414 baris  13 fungsi   chrome.* 27

extension/lib/log.js        BARU, 9 baris,  chrome.* 0   — satu sumber `log`
extension/lib/serialize.js  BARU, 47 baris, chrome.* 0   — region 2019-2045
```

Angka baris termasuk konstanta header yang ikut pindah ke modulnya (daftar lengkap
di bawah, judul *Penempatan state*). Region yang **tidak** ikut pindah:

- **`dispatch` (1647-2018)** — sudah disetujui tidak disentuh isinya. Satu fungsi
  372 baris yang memanggil hampir semua modul lain.
- **`SEMANTIC_RUNTIME_EPOCH` (80)** dan **`AX_SUMMARY_TEXT_POVERTY_CHARS` (86)**
  — keduanya hanya dipakai `dispatch` (baris 1890, 1921), jadi tetap di header.

### Gerbang: aturan `lib/` bebas `chrome.*`

Aturan ditegakkan tes, bukan ingatan:

```
extension/lib/*.js  tidak boleh memuat  chrome.<prop>  sebagai kode,
kecuali file yang tercatat eksplisit di daftar kecualian dalam tes.
```

Daftar kecualian saat ini: `debugger-session.js`, yang memang sudah memakai
`chrome.debugger.detach` sebelum spec ini. Tanpa kecualian yang tercatat, aturan
langsung gagal pada kesalahan pertama yang sudah ada lalu diabaikan — persis
seperti empat lock hash yang mati tanpa seorang pun sadar. Karena daftarnya ada
di dalam tes, menambah file ke `lib/` yang melanggar aturan akan ketahuan.

Inilah alasan pemilihan `worker/` atas `lib/`: `lib/` yang murni bisa diuji Node
suite tanpa browser, dan itu yang membuat 743 tes tetap cepat.

### TDZ: satu-satunya tempat yang bisa membunuh saat load

Setelah semua region dipindah, **hanya `execute-pull` yang membaca binding header
di top level**:

```
background.js:2645   chrome.alarms.create(WAKE_ALARM, {...})   membaca WAKE_ALARM
background.js:2646   ensurePullLoop();                          membaca loopPromise, loopGeneration
```

Semua `addListener` lain hanya mendaftarkan *callback* yang dievaluasi ketika
event datang — bukan saat modul dimuat. Karena `background.js` adalah entry,
seluruh impor dievaluasi sebelum badannya, jadi membaca binding `const`/`let`
dari `background.js` pada saat load akan melempar `ReferenceError` dan service
worker gagal start.

Aturan yang menjamin aman, dan wajib dipertahankan tiap langkah:

> **Modul worker tidak boleh membaca binding `const`/`let` milik `background.js`
> di top level.** Deklarasi `function` aman (dihoist). Callback `addListener` aman
> (dievaluasi nanti). Yang berbahaya hanya ekspresi yang dihitung saat load.

Tiga pemblokir di atas dihilangkan dengan memindahkan semuanya ke `execute-pull`
— bukan dengan membungkus:

- `WAKE_ALARM` (73) — **4 pemakaian, semuanya** di region `execute-pull`
  (`2596, 2605, 2611, 2645`). Ada juga `log.warn('WAKE_ALARM_CREATE_FAILED')`
  di `2645` — tag log, bukan konstanta; jangan dihitung.
- `loopPromise` (88) dan `loopGeneration` (89) — def di header, **semua pemakaian**
  di region `execute-pull` (`2346, 2432, 2459-2462, 2466, 2470, 2471`).
- `log` — tidak pernah dibaca di top level (di `2645` ada di dalam `.catch()`),
  tapi tetap dipindah ke leaf baru supaya tidak ada modul yang mengimpor
  `background.js` hanya untuk logging.

### Penempatan state

35 state top-level. Aturannya satu kalimat: **state pindah ke modul yang
memakainya; modul lain mengimpor dari sana; arah impor tidak boleh membalik.**

| state | baris | pindah ke | alasan |
|---|---|---|---|
| `STORAGE_KEYS` | 71 | `worker/utils.js` | satu-satunya pemakaian di `138` |
| `PRIVATE_TABS_KEY` | 72 | `worker/private-tabs.js` | `270, 283` di region itu; `execute-pull:2641` impor — arah sudah ada |
| `WAKE_ALARM` | 73 | `worker/execute-pull.js` | 4 pemakaian (`2596, 2605, 2611, 2645`), semua di region itu |
| `HTTP_URL_RE` | 74 | `worker/tab-content.js` | `listen`, `capture-page`, `execute-pull` sudah mengimpor `tab-content` |
| `MAX_RESULT_BYTES` | 75 | `lib/serialize.js` | dipakai `dispatch:1903` dan `serialize:2021,2022,2028` — `serialize` tidak memanggil apa pun, jadi arahnya satu |
| `MAX_BURST_RESULT_BYTES` | 76 | `worker/loop-engine.js` | satu-satunya pemakaian `1203` |
| `MAX_SCREENSHOT_BYTES` | 77 | `worker/capture-page.js` | `624, 632, 634`, semua di region itu |
| `SCREENSHOT_CACHE_MS` | 78 | `worker/capture.js` | `440` |
| `SCREENSHOT_CACHE_LIMIT` | 79 | `worker/capture.js` | `452` |
| `loopPromise` | 88 | `worker/execute-pull.js` | semua pemakaian di region itu |
| `loopGeneration` | 89 | `worker/execute-pull.js` | semua pemakaian di region itu |
| `connectionState` | 90-96 | `worker/utils.js` | ditulis `155, 157` (`setState`); dibaca `execute-pull:2580` — `execute-pull → utils` sudah ada |
| `screenshotCache` | 97 | `worker/capture.js` | ditulis `451`; `private-tabs:284` dan `execute-pull:2633` hapus. **`capture` tidak memanggil `private-tabs`** (diverifikasi), jadi tidak membalik |

State yang **ikut** region tanpa perlu keputusan — sudah ada di dalam badan
region yang dipindah: `popupLog`, `popupActionStack`, `POPUP_LOG_MAX_AGE_MS`,
`UV_WAIT_FLOOR_MS` (action-focus); `LOOP_MAX_ACTIVE`, `LOOP_*`, `loopSessions`,
`loopResults`, `STATE_READERS`, `stateSessions`, `stateResults` (loop-engine);
`WATCH_*` (watch-registry); `serializedResult` (serialize).

`log` (54) dipakai 9 region. Daripada 9 impor mengimpor `background.js`, dibuat
`extension/lib/log.js`:

```js
import './agent-log.js';
export const log = globalThis.OperaAgentLog || {};
if (typeof log.warn !== 'function') throw new Error('Agent log runtime is unavailable.');
```

`agent-log.js` diverifikasi **nol `chrome.*`** dan **nol `export`** — pola
classic-script itu yang membuatnya tidak boleh diberi `export` (akan jadi sintaks
error di `manifest.content_scripts`), dan `lib/log.js` adalah pembungkus
ES-module yang tidak pernah dimuat sebagai classic script.

### Nama file yang dikunci oleh injeksi runtime

Dua tempat menulis path file sebagai **string**, dan kedua path itu menuju classic
script yang tidak bisa diubah jadi modul:

```
background.js:232   (region tab-content, dieksekusi saat ensureContent)
  ['lib/agent-log.js', 'semantic-identity.js', 'semantic-views.js',
   'role-reconcile.js', 'hover-settle.js', 'content.js']          — 6 file
  → daftar ini identik byte-per-byte dengan manifest.content_scripts[0].js

background.js:1743  (region DISPATCH, world: 'MAIN')
  ['loop-decide.js', 'state-bridge.js']                           — 2 file
  → tidak ada di manifest; hanya diinjeksi runtime
```

`manifest.content_scripts` tidak mendukung `type: module`, jadi kedelapan file
itu tetap IIFE klasik — di luar cakupan, tidak boleh ikut berpindah, dan tidak
boleh di-rename.

Yang berpindah hanya **wadahnya**, bukan isinya:

- `:232` berada di region `tab-content`, jadi baris itu ikut pindah ke
  `worker/tab-content.js` **sebagai string yang tidak diubah**. Kalau isinya
  disentuh, injeksi runtime berhenti menemukan file dan konten pingsan diam-diam.
- `:1743` berada di region `dispatch`, yang tetap di `background.js` — **tidak
  berpindah sama sekali**.

## Langkah

Tahap 0 dijalankan **sebelum** langkah pertama, karena ia memperbaiki alat yang
akan dipakai memverifikasi semua langkah berikutnya.

### Tahap 0

1. **`tests/hygiene.test.mjs:303`** — ganti anchor `// U-V Action Pipeline`
   dengan `// Action Pipeline`. Sudah diverifikasi: anchor itu ada **tepat sekali**
   di `background.js:749`, sehingga `slice(717, 749)` menghasilkan blok **33 baris**
   (satu fungsi `withForegroundFocusGate`), dan ketiga asersinya terbukti benar
   atas blok itu — `doesNotMatch /for \([^;]*;\s*;/` true,
   `match` loop `attempt <= FOCUS_GATE_ATTEMPTS` true, `match` `FOCUS_GATE_SETTLE_MS`
   true. Periksa ulang setelah anchor diganti, jangan cuma percaya angka ini.
2. **Empat lock hash basi di dua array yang tak pernah diimpor.**
   `tests/helpers/boundary-locks.mjs` mengekspor tiga array, total **9 entri**:
   `PUBLIC_SURFACE_LOCKS` (4), `OBSERVATION_STACK_LOCKS` (3),
   `RELEVANCE_STACK_LOCKS` (2). Hanya `PUBLIC_SURFACE_LOCKS` yang diimpor —
   oleh `delta-first-observation.test.mjs` — dan keempat hash-nya **masih
   segar**. Dua array lain tidak diimpor siapa pun, jadi kelima hash di dalamnya
   tak pernah diperiksa — dan **4 di antaranya basi**:
   `reactive-vm.js`, `reactive-vm-control-flow.js`, `reactive-vm-collect.js`
   (ketiganya), plus `multi-signal-relevance.js`.
   Perbaikannya: tambahkan pemeriksaan yang benar-benar berjalan untuk kedua
   array itu, lalu ambil ulang kelima hash. Catat di komentar bahwa hash dihitung
   sebagai git blob SHA1 atas byte LF (konversi CRLF→LF diperlukan supaya
   checkout Windows dan CI sama) — `sha1Blob` di
   `delta-first-observation.test.mjs:194` sudah benar, tiru saja.
   Peringatan: path dalam array itu di-resolve relatif ke **file pemanggil**
   (`new URL(rel, import.meta.url)` di test), bukan relatif helper — jadi pemeriksaan
   baru harus berada di `tests/`, bukan di `tests/helpers/`.
3. **Sembilan baris `@state` identik** di `extension/lib/` — teksnya persis
   `MV3 runtime library, shared with the Node suite..` di `agent-log`,
   `ax-summary`, `endpoints`, `external-origins`, `focus-gate`, `keyboard`,
   `popup-events`, `protocol`, `watch`. Isi dengan kalimat yang benar-benar
   menjelaskan isi tiap file, dan hilangkan titik ganda `..`. Dua file lagi
   membawa teks yang sama persis di `@title`, bukan `@state` —
   `action-pipeline.js:2` dan `options-store.js:2`; perbaiki sekalian, karena
   masalahnya sama: boilerplate yang tidak menyatakan apa pun.
   Terkait: `loop.js:3` (`validator and tick-band classifier only; no executor
   yet`) diperbarui agar menunjuk `extension/worker/loop-engine.js` sebagai rumah
   eksekutornya — baris itu diperbarui di **langkah 10**, saat eksekutornya
   benar-benar pindah.
4. **Tes load** `tests/background-load.test.mjs` — ditulis, dijalankan, dan
   **lulus terhadap file saat ini** sebelum satu baris pun dipindah. Ini baseline;
   tanpa baseline, tes load hanya membuktikan dirinya sendiri.
5. **Baca ulang seluruh tabel angka** di *Fakta terverifikasi*. Kalau berbeda,
   perbaiki tabelnya.

### Enam fase, tiga belas perpindahan

Tiap perpindahan diakhiri `npm test` **dan** `npm run check` — bukan tiap fase,
bukan cuma di akhir. Fase ada supaya spec ini terbaca, bukan supaya verifikasi
ditumpuk. Tahap 0 bukan perpindahan; ia prasyaratnya.

**Fase A — perbaikan alat.** Tahap 0 di atas.

**Fase B — modul daun** (tidak mengimpor modul worker lain):

1. `extension/lib/log.js` — file baru, 5 baris. `background.js` ganti tiga baris
   bootstrap jadi satu `import { log }`. Tidak ada kode pindah.
2. `extension/lib/serialize.js` — region 2019-2045 (3 fungsi, `chrome.*` 0)
   plus `MAX_RESULT_BYTES`. Mengikuti aturan gerbang: `chrome.*` 0 → `lib/`.
3. `extension/worker/utils.js` — region 99-162 (7 fungsi, `chrome.*` 2) plus
   `STORAGE_KEYS` dan `connectionState`.

**Fase C — capture, privasi, plumbing** (berurutan karena saling bergantung):

4. `extension/worker/capture.js` — region 288-462 (10 fungsi, `chrome.*` 7) plus
   `SCREENSHOT_CACHE_MS`, `SCREENSHOT_CACHE_LIMIT`, `screenshotCache`. `capture`
   tidak memanggil `private-tabs` — diverifikasi, jadi langkah 5 tidak membalik.
5. `extension/worker/private-tabs.js` — region 269-287 (3 fungsi, `chrome.*` 2)
   plus `PRIVATE_TABS_KEY`, mengimpor `screenshotCache` dari `capture`.
6. `extension/worker/tab-content.js` — region 163-268 (8 fungsi, `chrome.*` 8)
   plus `HTTP_URL_RE`.

**Fase D — I/O halaman** (keduanya mengimpor ketiga modul di Fase C):

7. `extension/worker/listen.js` — region 463-550 (5 fungsi, `chrome.*` 4).
8. `extension/worker/capture-page.js` — region 551-665 (1 fungsi, `chrome.*` 3)
   plus `MAX_SCREENSHOT_BYTES`. Terpisah dari `capture` **bukan** selera:
   `capture-page` memanggil `isPrivateTab` (private-tabs) dan `private-tabs`
   mengimpor `screenshotCache` (capture) — menggabungkan keduanya menciptakan
   siklus kelima yang bisa dihindari.

**Fase E — pasangan bersiklus** (satu per satu, keduanya aman diurutan mana pun):

9. `extension/worker/action-focus.js` — region 666-1115 (17 fungsi, `chrome.*` 22).
   Dua listener top-level (`793, 803`) ikut pindah; keduanya hanya membaca
   `popupLog` di dalam callback, jadi aman. Selama `loop-engine` masih di
   `background.js`, `action-focus` mengimpor `finishLoop`/`finishStateLoop`
   dari sana — siklus diterima.
10. `extension/worker/loop-engine.js` — region 1116-1646 (17 fungsi, `chrome.*` 9).
    Mengimpor `executionMode` dkk. dari `action-focus` dan `dispatch` dari
    `background.js`. `chrome.*` 9 di region ini termasuk enam
    `Input.dispatch*` dari chrome.debugger yang **bukan** pemanggilan `dispatch`.
    Di langkah ini juga perbarui `extension/lib/loop.js:3` — eksekutornya
    (`loopSessions`, `loopTick`, `runBurst`) baru saja pindah ke sini.

**Fase F — akhir** (keduanya mengimpor `dispatch`, jadi terakhir):

11. `extension/worker/watch-registry.js` — region 2046-2268 (13 fungsi, `chrome.*` 4).
12. `extension/worker/execute-pull.js` — region 2269-2647 (13 fungsi, `chrome.*` 27)
    plus `WAKE_ALARM`, `loopPromise`, `loopGeneration`. **Terakhir, selalu.**
    Ia memuat 9 listener top-level termasuk `chrome.runtime.onMessage` (2535),
    `chrome.alarms.create` (2645), dan `ensurePullLoop()` (2646) — tiga pernyataan
    yang dievaluasi saat load. Setelah konstanta di atas ikut pindah, tidak ada
    lagi yang membaca binding `background.js` saat load. Ini satu-satunya langkah
    yang membaca binding header saat load, jadi tes load wajib hijau setelahnya.
13. `extension/worker/burst.js` — 142 baris, 2 fungsi, `chrome.*` sebagai kode 0.
    Berkas ini lahir di Task 16 dari pembagian item 10: rencana memutuskan
    **membagi** alih-alih menaikkan ambang 550, sehingga rencana tumbuh dari
    dua belas modul menjadi tiga belas.

## Batasan

**File tidak di-rename.** `background.js` disebut 23 file, `content.js` 21, dan
keduanya dikunci manifest. Nama keduanya sudah sesuai konvensi MV3 dan akurat.

**Fungsi tidak di-rename.** **24** dari 100 fungsi dirujuk sebagai *deklarasi*
di dalam string atau regex — `indexOf('async function trustedClick')`,
`/function boundedResult/` — dan **36** nama muncul di dalam string sama sekali.
Menamai ulang akan memutus asersi itu tanpa mendapat apa-apa. Bahwa penamaannya
bukan masalah dibuktikan oleh angka yang bisa dicek ulang: **0 tumbukan nama**
antara 100 fungsi `background.js` dan 80 fungsi di 17 modul `extension/lib/`
(lihat *Konvensi yang sudah berjalan*).

**`dispatch` tidak disentuh isinya.** Baris 1647-2018 tetap di `background.js`.

**`content.js` tidak disentuh.** Tahap terpisah. Ia tetap IIFE klasik satu file —
`manifest.content_scripts` tidak mendukung `type: module`, jadi itu batasan
MV3, bukan kelalaian.

**Siklus empat itu diterima, bukan ditambal.** Tidak ada dependency injection,
tidak ada registry callback. Yang menjamin tetap berfungsi: semua pembacaan ada di
dalam badan fungsi, plus tes load di Fase A.

**`chrome.runtime.onMessage` tetap terdaftar.** Listener itu pindah ke
`worker/execute-pull.js` dan didaftarkan saat modul dievaluasi. Karena
`background.js` mengimpornya, registrasi tetap terjadi saat startup. Urutan
relatif listener `tabs.onRemoved` (dua: `803` action-focus, `2632` execute-pull)
boleh berubah — kedua handlernya independen (`popupLog` vs `screenshotCache`),
diverifikasi tidak berbagi state.

## Pengujian

Semua dalam `npm test` (743 tes) plus `npm run check`, tanpa browser hidup.
Tiap perpindahan diakhiri kedua perintah itu.

### Yang ditambahkan

**Tes load** `tests/background-load.test.mjs` — mengimport
`extension/background.js` sungguhan dengan mock `chrome`, lalu menyatakan modul
termuat tanpa `ReferenceError`/`SyntaxError`. Ini satu-satunya cara menangkap
ekspor yang salah tempat, impor yang putus, dan siklus yang gagal.

Mock `chrome` harus menutup 12 pernyataan top-level ini:

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
2645  chrome.alarms.create(...)   harus mengembalikan Promise dengan .catch
```

plus `chrome.storage.local.get` → `{}` dan `chrome.storage.local.set` → resolve.
Dengan `get` mengembalikan `{}`, `cfg.paired` false, `pullLoop` keluar setelah
`setState` (baris 2435), `.finally()` tidak memicu `setTimeout` — jadi tidak ada
jaringan dan tidak ada loop yang menggantung. `crypto.randomUUID()` tersedia di
Node. `agent-log.js` dan `role-reconcile.js` terverifikasi nol `chrome.*`, jadi
keduanya termuat bersih.

**Gerbang `lib/` bebas `chrome.*`** dengan daftar kecualian tertulis berisi
`debugger-session.js`.

**Ukuran** — `background.js` di bawah 600 baris (target sekitar 460); tiga belas
modul baru ada dan masing-masing di bawah 550.

### Yang berubah: 17 file, satu baris per file

17 file membaca `background.js` sebagai teks. Di dalamnya ada **296 literal**
bermakna (≥10 karakter, string maupun regex) yang ada secara verbatim di
`background.js` dan lokasinya berpindah ke modul baru. Menjarah 296 literal satu
per satu bukan rencana.

Solusinya satu helper baru — `tests/helpers/extension-source.mjs`:

```js
// Mengembalikan background.js + semua modul baru, diurutkan sesuai
// urutan region asli supaya asersi indexOf tetap masuk akal.
export async function extensionSource() { /* join dalam urutan di bawah */ }
```

Urutan, dan dua syarat yang membatasinya:

```
1  extension/background.js          header + dispatch
2  worker/utils.js
3  worker/tab-content.js
4  worker/private-tabs.js
5  worker/capture.js
6  worker/listen.js
7  worker/capture-page.js
8  worker/action-focus.js
9  worker/loop-engine.js
10 lib/serialize.js                 HARUS sebelum watch-registry
11 worker/watch-registry.js
12 worker/execute-pull.js           HARUS terakhir
```

Dua syarat itu sudah diverifikasi cukup. Seluruh pemakaian `indexOf` pada 17 file
diurutkan: satu pasang saja yang **lintas modul** —
`hygiene.test.mjs:276` `function boundedResult` (serialize) →
`// ---- Event-Triggered Workflows` (watch-registry) — dan urutan 10 → 11
memenuhinya. `hygiene.test.mjs:295` `async function executeCommand` tanpa batas
kedua menuntut nomor 12 terakhir. Semua sisanya satu-anchor tunggal atau berada
di dalam satu modul (`ensureContent`→`contentCall`→`executeInTab` semua
`tab-content`; lima anchor `focus-and-keyboard` semua `action-focus`;
`trustedFill`, `trustedHover` satu-anchor). Tidak ada pasangan lain yang
bergantung pada posisi antar-modul.

Tiap dari 17 file mengganti **satu baris** (`readFile(background.js)` →
`extensionSource()`). Tidak ada asersi yang dihapus. Daftarnya:

```
scripts/check.mjs
tests/action-pipeline.test.mjs
tests/ax-observation.test.mjs
tests/burst-atomic-actions.test.mjs
tests/burst-tab-switching.test.mjs
tests/debugger-session-lifecycle.test.mjs
tests/efficiency.test.mjs
tests/endpoint-source.test.mjs
tests/etw-watch-engine.test.mjs
tests/focus-and-keyboard.test.mjs
tests/hover-settle.test.mjs
tests/hygiene.test.mjs
tests/landing-claims.test.mjs
tests/model-client.test.mjs
tests/role-reconcile.test.mjs
tests/timeout-retry-popup-parity.test.mjs
tests/workflow-dsl.test.mjs
```

**Yang aman tanpa sentuhan.** Tepat empat `assert.doesNotMatch` memakai variabel
yang isinya `background.js`, dan keempatnya memeriksa string yang **tidak ada** di
`background.js`:

| file | pola | status sebenarnya |
|---|---|---|
| `etw-watch-engine.test.mjs:120` | `set-bridge-url` | aksi popup yang sudah dihapus; tak ada di `extension/` |
| `hygiene.test.mjs:345` | `export function isPlainObject` | fungsinya `function isPlainObject` (tanpa `export`) di `lib/loop.js:41` dan `lib/protocol.js:89` |
| `role-reconcile.test.mjs:268` | `function implicitRole(` | `role-reconcile.js` |
| `role-reconcile.test.mjs:269` | `const TAG_ROLES` | `role-reconcile.js` |

Karena modul baru adalah **subset** dari `background.js` (kode dipindah verbatim),
string yang tidak ada di file induk tidak mungkin muncul di anaknya — keempatnya
lulus sebelum dan sesudah. `doesNotMatch` lain yang terlihat relevan ternyata
membaca berkas lain: `Key is not allowlisted.` (`content.js`) dan seluruh pola
MCP (`source` membaca sumber MCP, bukan `background.js`). `npm test` tetap jalan
tiap langkah sebagai bukti, bukan sebagai asumsi.

**Yang bertambah.**

- Gerbang `lib/` bebas `chrome.*` dengan satu kecualian tertulis.
- Tes load `background.js`.
- `background.js` di bawah 600 baris.
- Tiga belas modul baru, masing-masing di bawah 550.

**Yang tidak berubah.** `PUBLIC_SURFACE_LOCKS`, jumlah 39 MCP tool,
`manifest.json`, perilaku `dispatch`.

## Risiko

**Anchor yang sudah mati sekarang.** Dua `indexOf` sudah menghasilkan `-1` hari
ini: `// U-V Action Pipeline` (diperbaiki Tahap 0, angka blok terverifikasi 33
baris) dan `async function pull(` di `efficiency.test.mjs:43` — yang terakhir
ini membaca `bridge`, **bukan** `background.js`, jadi di luar cakupan. Jangan
"memperbaiki" yang kedua sebagai bagian dari pekerjaan ini.

**Bundel mengubah arti `doesNotMatch`.** Membaca 13 file sekaligus berarti
asesi `doesNotMatch` memeriksa lebih banyak kode daripada sebelumnya. Itu lebih
ketat, bukan lebih longgar — tapi bisa menghasilkan kegagalan baru yang sah.
Kalau muncul, keputusannya adalah memperbaiki kodenya, bukan memperkecil
bundelnya.

**State yang tidak sengaja terduplikasi.** 35 state top-level. Kalau sebuah state
dipakai region yang dipindah *dan* `dispatch`, memindahkannya berarti dua salinan
yang bisa menyimpang. Daftar lengkap di *Penempatan state* sudah dihitung per
baris. Aturannya: kalau tidak ada di tabel itu dan tidak ikut regionnya, ia tetap
di `background.js` dan dikirim lewat argumen — diperiksa tiap langkah, bukan di
akhir.

**Listener yang tidak terdaftar.** Tiga pernyataan load-time di `execute-pull`
dan dua listener di `action-focus` hanya hidup kalau modulnya diimpor.
`background.js` mengimpor keduanya — tes load yang membuktikannya, bukan
pembacaan kode.

**Angka `chrome.*` yang bergeser.** Tabel di *Fakta terverifikasi* dihitung sekali
pada pohon bersih. Setelah tiap langkah, hitung ulang. Kalau berbeda, yang
diperbaiki tabelnya, dan alasannya dicatat.
