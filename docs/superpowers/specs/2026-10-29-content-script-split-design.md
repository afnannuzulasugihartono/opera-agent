@last-edited: 2026-10-29 UTC+7.
@related: [`../../../AGENTS.md`](../../../AGENTS.md) - [`../../../README.md`](../../../README.md) - [`2026-10-09-background-modularization-design.md`](2026-10-09-background-modularization-design.md)

# Spec: pecah `extension/content.js` jadi delapan modul content script

Disetujui di percakapan 2026-10-29. Satu file **1945 baris** menjadi entry tipis plus
**delapan** modul baru, tanpa perubahan perilaku. Ini tahap yang sengaja ditunda oleh
spec 2026-10-09 (`content.js` tidak disentuh — tahap terpisah), dan ia terbuka karena
satu klaim yang menjaga file itu tetap besar ternyata **salah**, dan repo ini sendiri
sudah membuktikannya.

## Intent

`extension/content.js` adalah "separuh halaman dari setiap primitive browser" — baca,
temukan, klik, isi, scroll, tunggu, media, watch — dalam satu IIFE 1945 baris: **90
fungsi**, **49 deklarasi level-IIFE** (`const` 37, `let` 12), dan state yang tersebar
dari baris 29 sampai 1805. Tidak ada penanda wilayah; pembaca menebak batasnya sambil
menggulir 700 baris.

Batas ukuran repo sendiri (`FILE_LINE_CAP = 1200` di `tests/code-standard.test.mjs`)
membebaskan file ini dengan satu alasan tertulis:

> *Chrome loads a content script as one unit, so splitting extension/content.js means
> separate manifest entries and separate isolated worlds, which is a project of its own
> and not a line count.*

Alasan itu **faktual salah**, dan buktinya ada di repo ini sendiri:

```
manifest.json  content_scripts[0].js =
  lib/agent-log.js, semantic-identity.js, semantic-views.js,
  role-reconcile.js, hover-settle.js, content.js          — 6 file
```

Enam file itu adalah **satu** entri `content_scripts`, **satu** isolated world, dimuat
berurutan pada `document_start`. `role-reconcile.js` (157 baris) hidup persis seperti
yang diusulkan spec ini: IIFE klasik, guard `globalThis.OperaAgentRoleReconcile`, lalu
mempublikasikan permukaannya di `globalThis`. Memecah `content.js` berarti **menambah
baris ke daftar yang sama** — bukan entri manifest baru, bukan isolated world baru.

Jadi yang mengunci ukuran file ini adalah sebuah kalimat yang tidak benar, bukan
batasan platform. Spec ini mencabut kalimat itu dan memindahkan kodenya.

Hasil akhir: `content.js` sekitar **200 baris** — bootstrap, wiring mesin semantik,
dispatcher `handle`/`onMessage` — plus **delapan** modul baru di `extension/`.

## Non-goals

Tidak ada perubahan perilaku, tidak ada rename fungsi, tidak ada rename file yang ada,
tidak ada perubahan `manifest.json` selain menambah path ke daftar yang sama, tidak ada
perombakan isi `handle`/`onMessage`, dan tidak ada file worker yang disentuh. Dua area
lainnya (JS inline `landing/dashboard.html`, setup yang berulang di edge function) adalah
**PR terpisah** di repo ini, tidak bagian dari spec.

## Fakta terverifikasi

Angka diambil dari pohon bersih (`git status` kosong kecuali 59 file milik sesi lain)
sebelum spec ditulis. Kalau setelah tiap langkah angkanya berbeda, yang diperbaiki
angkanya — bukan langkahnya.

### Ukuran

`extension/content.js`: **1945 baris**, **90 fungsi**, `const` level-IIFE **37**,
`let` level-IIFE **12**.

### Delapan region, batas dari posisi deklarasi fungsi

| region | baris | fungsi | isi |
|---|---|---|---|
| bootstrap + helper murni | 17-112 | 6 | `markInstalled`, `clamp`, `clean`, `normalizeObservableText`, `normalizeText`, `currentRouteKey` |
| refs & revalidasi | 113-309 + 716 | 11 | `actionRefDescriptor` … `resolveActionRef`, `resetActionRefs` |
| fakta elemen: nama, identitas, geometri, actionability | 310-560 | 17 | `getAssociatedLabel` … `prioritizeActionableNodes`, `stableHash`, `stableElementIdentity`, `viewportState`, `userInputState`, `sensitiveDescriptor`, `assertEditableSafe` |
| lapisan semantik (baca/temukan/amati) | 563-1058 | 16 | `serialize` … `collectLinks` |
| jalur tulis + bukti pasca-aksi | 1059-1342 | 15 | `nativeSetValue` … `actionState` |
| pointer, capture policy, scroll | 1343-1538 | 9 | `pointerTarget` … `scroll` |
| tunggu & tombol | 1539-1625 | 3 | `key`, `stateMatches`, `waitFor` |
| media & watch | 1626-1874 | 11 | `mediaElement` … `scheduleWatchCheck` |
| dispatcher | 1875-1945 | 2 | `handle`, `onMessage` |

Jumlah: **90 fungsi**. `resetActionRefs` (716) duduk di tengah region semantik tetapi
memangkas state milik region refs, jadi ia pindah bersama state-nya ke
`action-refs.js` — itulah sebabnya angkanya 11 + 16 dan bukan 10 + 17. Batas pasti
tiap fungsi ditetapkan saat pemindahan, bukan di spec: yang dikunci spec adalah
**region** dan **urutan muat**, bukan nomor baris akhir.

### State: 49 deklarasi, tersebar, dan tempatnya sudah bisa dihitung

| state | baris | pindah ke | alasan |
|---|---|---|---|
| `MAX_TEXT_CHUNK`, `MAX_ELEMENTS`, `MAX_QUERY`, `MAX_LINKS` | 49-52 | `page-kit.js` | dipakai lintas region; daun, tanpa dependensi |
| `roleRuntime`, `hoverRuntime`, `semanticRuntime`, `implicitRole`, `hoverSettle` | 29-47 | `content.js` | wiring antar content script, hanya dibaca dispatcher |
| `documentId` | 53 | `content.js` | identitas dokumen, dipakai `handle` |
| `semanticIdentity`, `semanticViews` | 54-56 | `content.js` | mesin dari `semantic-identity.js`/`semantic-views.js` |
| `refCounter`, `refs`, `reverseRefs`, `actionRefDescriptors` | 58-61 | `action-refs.js` | seluruh pemakaian di region itu |
| `semanticRouteKey`, `semanticRuntimeEpoch` | 62-63 | `semantic-page.js` | dipakai `syncSemanticScope`/`observeSemanticBounded` |
| `disposed`, `mutationVersion`, `mutationObserver` | 64-67 | `content.js` | siklus hidup halaman |
| `NAV_KEYS` | 73 | `page-wait.js` | hanya dipakai `key` |
| `SENSITIVE_RE` | 78 | `element-facts.js` | hanya dipakai `sensitiveDescriptor` |
| `PUA_GLYPH_RE`, `VISITED_SUFFIX_RE` | 90-91 | `page-kit.js` | hanya dipakai `normalizeObservableText` (2 pemakaian masing-masing: deklarasi + satu call), yang ikut ke `page-kit` |
| `GEOMETRY_DRIFT_TOLERANCE_PX` | 153 | `element-facts.js` | hanya dipakai pencocokan geometri |
| `lastUserInputAt` | 521 | `element-facts.js` | hanya dipakai `userInputState` |
| `INTERACTIVE_SELECTOR`, `MAX_SHADOW_ROOTS`, `MAX_COLLECTED_NODES` | 615-622 | `semantic-page.js` | hanya dipakai `collectInteractiveNodes` |
| `EXPECT_VERIFY_WINDOW_MS` | 1138 | `page-actions.js` | hanya dipakai `waitForExpectVerification` |
| `LISTEN_WINDOW_MS`, `listenCapture` | 1630-1632 | `page-media.js` | hanya dipakai region media |
| `watchRules`, `watchState`, `watchChecking`, `watchCheckQueued` | 1802-1805 | `page-media.js` | hanya dipakai region watch |

Aturannya satu kalimat: **state pindah ke modul yang memakainya; modul lain membacanya
lewat namespace; arah tidak boleh membalik.** Kalau sebuah state ternyata dipakai dua
region, ia naik ke `page-kit.js` atau tetap di `content.js` dan dikirim lewat argumen
— diputuskan per langkah, bukan di akhir.

### Content script tidak bisa ES import

`manifest.content_scripts` tidak mendukung `type: module`. Semua komunikasi antar file
content script sudah memakai pola namespace di `globalThis`, dibuktikan
`role-reconcile.js:145` (`globalThis.OperaAgentRoleReconcile = Object.freeze({...})`)
dan `content.js:29-47` yang membacanya. Modul baru mengikuti pola itu — bukan impor
ESM, bukan variabel global telanjang.

`tests/extension-source.test.mjs` sudah memaksa pola ini: tes *every cross-module name
is imported where it is used* menyatakan sebuah nama lintas-berkas sebagai miss kalau
dipakai tanpa dideklarasikan/diimpor/diekspor di berkas itu. Nama global telanjang akan
gagal di sana; akses properti (`globalThis.OperaAgentX.y`) lolos, dan itu memang cara
kerja content script.

### Empat belas berkas tes membaca `content.js` sebagai teks

`tests/action-pipeline.test.mjs`, `ax-observation`, `burst-atomic-actions`, `efficiency`
(dua tempat), `focus-and-keyboard`, `hover-settle`, `landing-claims`, `landing-dashboard`,
`ref-reacquire`, `role-reconcile` (dua tempat), `semantic-engine`,
`timeout-retry-popup-parity` (dua tempat), `ui-surface`, `workflow-dsl`. Semua `readFile`
— pola asersi dua macam: `/function collectInteractiveNodes\(/` (fungsi ada di berkas ini) dan
`source.indexOf('function resolveActionRef(ref) {')` lalu `slice` sampai kurung tutup
(blok fungsi). Keduanya pindah bersama fungsinya.

Jumlah ini **14 berkas dan 17 titik baca**, bukan sebelas seperti yang tertulis
di versi pertama spec ini. Angka itu dihitung dari `content.js` saja; pembacaan
di luar `tests/` baru ketahuan ketika pohon diaudit seluruhnya:

| pembaca | apa yang berubah |
|---|---|
| `scripts/check.mjs:82` | memeriksa **tujuh** marker (`password`, `one-time-code`, `cvv`, `cvc`, `type === 'file'`, `args.includeElements !== false`, `case 'content.ping'`) di dalam `content.js`; enam di antaranya pindah ke modul, jadi ia harus membaca bundel |
| `store/store-manifest.json` | cermin `manifest.content_scripts`, dibandingkan `deepEqual` oleh `check.mjs`; harus ikut di setiap task yang mengubah manifest |
| `tests/helpers/boundary-locks.mjs` | meng-pin SHA-1 `extension/content.js` **dan** `extension/manifest.json`; keduanya berubah di setiap task |

Preseden yang sudah terbukti ada di spec 2026-10-09: 17 berkas yang membaca
`background.js` sebagai teks diperbaiki dengan **satu baris per berkas** — mengganti
`readFile(background.js)` dengan `extensionSource()` — dan **nol asersi dihapus**.

## Arsitektur

```
extension/
├── content.js        entry: bootstrap + wiring + dispatcher        (~200 baris)
├── page-kit.js       helper murni + batas yang dipakai lintas modul
├── action-refs.js    ref, revalidasi, resetActionRefs
├── element-facts.js  nama, identitas stabil, geometri, hit-test, actionability
├── page-wait.js      key, stateMatches, waitFor
├── semantic-page.js  serialize, collect, observe, read, query, find, links
├── page-actions.js   jalur tulis + bukti pasca-aksi
├── page-scroll.js    pointer target, capture policy, scroll
└── page-media.js     listen, media, watch
```

Delapan modul baru diletakkan **flat di `extension/`**, bukan di `extension/lib/`:
empat dari enam content script yang ada sudah flat (`semantic-identity`,
`semantic-views`, `role-reconcile`, `hover-settle`), dan mereka dimuat oleh entri
manifest yang sama. `lib/agent-log.js` adalah pengecualian yang sudah ada, bukan
pola yang perlu ditiru.

**Tujuh modul bebas `chrome.*` sebagai kode; `page-media` bukan.** Seluruh
`extension/content.js` hari ini memakai `chrome.*` di tiga tempat, dan ketiganya
terpetik ke region yang sudah dipetakan:

| baris | pemakaian | region | ikut ke |
|---|---|---|---|
| 1646 | `chrome.runtime.sendMessage` (chunk listen) | media | `page-media.js` |
| 1854 | `chrome.runtime.sendMessage` (watch.facts) | watch | `page-media.js` |
| 1932 | `chrome.runtime.onMessage.addListener` | dispatcher | `content.js` |

Jadi gerbang "bebas `chrome.*`" harus memuat **satu kecualian tertulis** untuk
`page-media.js`, dengan alasan yang sama seperti `debugger-session.js` dan `burst.js`
di gerbang yang sudah ada: file itu memang berbicara ke service worker. Mengecualikannya
secara tertulis lebih jujur daripada memindahkan dua pemanggilan itu ke modul kesembilan
— yang akan mencampur "pindah" dengan "rombak", dan itu yang ditolak spec ini.

### Namespace per modul

| modul | namespace |
|---|---|
| `page-kit.js` | `globalThis.OperaAgentPageKit` |
| `action-refs.js` | `globalThis.OperaAgentActionRefs` |
| `element-facts.js` | `globalThis.OperaAgentElementFacts` |
| `semantic-page.js` | `globalThis.OperaAgentSemanticPage` |
| `page-actions.js` | `globalThis.OperaAgentPageActions` |
| `page-scroll.js` | `globalThis.OperaAgentPageScroll` |
| `page-wait.js` | `globalThis.OperaAgentPageWait` |
| `page-media.js` | `globalThis.OperaAgentPageMedia` |

Tiap modul: IIFE klasik, guard `if (globalThis.X) return;`, lalu
`globalThis.X = Object.freeze({ ... })` — persis `role-reconcile.js`. `content.js`
membaca semuanya di awal, dengan **degradasi**, bukan lempar: helper yang tidak ada
mencatat `semanticRuntime` palsu dan halaman tetap hidup. Itu properti yang sudah
dikunci `tests/efficiency.test.mjs` dan tidak boleh hilang.

### Dua daftar path yang harus tetap identik

Ini cara repo menjaga injeksi tetap benar, dan spec ini tidak mengubah mekanismenya:

```
manifest.json                          content_scripts[0].js  (6 → 14 file)
extension/worker/tab-content.js         files: [...]          (dipakai ensureContent saat runtime)
```

Lokasi daftar runtime itu **bukan** `background.js:232` seperti dicatat spec 2026-10-09: daftar tersebut ikut pindah ke `worker/tab-content.js` saat `background.js` dipecah. Diverifikasi hari ini — `extension/worker/tab-content.js` adalah satu-satunya tempat di `extension/` yang menuliskan keenam path itu.

`tests/extension-source.test.mjs` — *the ensureContent script list still matches the
manifest* — memaksa kedua daftar itu **identik: isi dan urutannya sama**. Jadi menambah path di
manifest **wajib** disertai di `worker/tab-content.js`, dan tes itu yang membuktikannya, bukan
ingatan. **Isi daftar tidak boleh disentuh selain menambah path baru di posisi yang
benar** — kalau urutan salah, modul dipanggil sebelum namespace-nya ada.

### Urutan muat

```
lib/agent-log.js → semantic-identity.js → semantic-views.js → role-reconcile.js
→ hover-settle.js → page-kit.js → action-refs.js → element-facts.js
→ page-wait.js → semantic-page.js → page-actions.js → page-scroll.js
→ page-media.js → content.js
```

Urutan ini **urutan topologis**, bukan selera: `page-wait` harus mendahului
`page-actions`, `page-scroll`, dan `page-media` karena ketiganya memanggilnya, dan
`semantic-page` harus mendahului `page-actions` karena jalur tulis membaca hasil
observasinya. Urutan muat dan urutan pemindahan sengaja dibuat sama, supaya setiap
langkah menghasilkan pohon yang masih utuh.

`content.js` **terakhir**, selalu: ia dispatcher, dan ia membaca semua namespace di
awal. Delapan modul baru berurutan dari daun ke batang; `page-kit` lebih dulu karena
semua yang lain memakainya.

## Langkah

Tahap 0 berjalan **sebelum** langkah pertama, karena ia memperbaiki alat yang dipakai
memverifikasi semua langkah berikutnya.

### Tahap 0

1. **Cabut klaim yang salah.** `tests/code-standard.test.mjs` — hapus
   `extension/content.js` dari `FILE_LINE_EXCEPTIONS` dan hapus komentar yang
   menjelaskannya, ganti dengan kalimat yang menyatakan kenyataannya: satu entri
   `content_scripts` memuat banyak berkas dalam satu isolated world, dan
   `role-reconcile.js` sudah hidup seperti itu. Berkas ini **tidak** dipin
   `gates.lock` (terverifikasi: hanya `tests/hygiene`, `structure-gates`,
   `boundary-locks`, `comment-format`, `comment-claims`, dan tiga helper yang dipin),
   jadi tidak ada `gates:refresh`. Setelah langkah ini suite **gagal** dengan
   `extension/content.js is 1945 lines` — itu benar, dan itu yang membuat langkah
   berikutnya wajib.
2. **Helper bundel content script** — `tests/helpers/content-source.mjs`: membaca
   `manifest.content_scripts[0].js` **sesuai urutan manifest** dan menggabungkannya.
   Sumber kebenarannya manifest, bukan daftar hard-code, supaya tidak ada daftar kedua
   yang bisa menyimpang. Baseline dulu: dengan berkas hari ini (enam file), asersi
   yang pindah ke helper harus lulus **sebelum** satu baris pun dipindah.
3. **Empat belas berkas tes, satu baris per titik baca** — `readFile(content.js)` →
   `contentSourceSync()`. Nol asersi dihapus. `doesNotMatch` yang ada tetap diperiksa:
   sekarang membaca lebih banyak berkas, jadi lebih ketat, bukan lebih longgar.
   `scripts/check.mjs` yang memeriksa tujuh marker di `content.js` ikut membaca bundel.
4. **Ulangi seluruh tabel angka** di *Fakta terverifikasi*.

### Delapan pemindahan, tiap akhir diakhiri `npm test` + `npm run check`

Urutannya urutan topologis (lihat *Urutan muat*): tiap langkah hanya membaca modul yang
sudah pindah, jadi setiap langkah menghasilkan pohon yang masih utuh.

1. `page-kit.js` — 5 fungsi murni (`clamp`, `clean`, `normalizeObservableText`,
   `normalizeText`, `currentRouteKey`) + 4 batas + 2 regex. Tidak ada dependensi.
   `content.js` mengganti sebelas definisi dengan satu baris destructuring.
   `markInstalled` **tetap** di `content.js` — ia bagian dari bootstrap, bukan helper.
2. `action-refs.js` — region refs (11 fungsi) + 4 state. Hanya membaca `page-kit`.
3. `element-facts.js` — region fakta elemen (17 fungsi) + state-nya. Membaca
   `action-refs` (pencocokan descriptor) dan `page-kit`.
4. `page-wait.js` — tunggu & tombol (3 fungsi) + `NAV_KEYS`. Membaca `page-kit` dan
   `element-facts`. **Sebelum** `page-actions`, `page-scroll`, dan `page-media` karena
   ketiganya memanggilnya.
5. `semantic-page.js` — region semantik (16 fungsi) + state-nya. Membaca ketiga modul
   di atas.
6. `page-actions.js` — jalur tulis (15 fungsi) + bukti pasca-aksi. Membaca
   `semantic-page`, `element-facts`, `page-wait`.
7. `page-scroll.js` — pointer + scroll (9 fungsi). Membaca `element-facts`, `page-wait`.
8. `page-media.js` — media + watch (11 fungsi) + state-nya. Membaca `page-wait`.

### Penutup

Setiap pemindahan menambah path ke `manifest.json` **dan** ke `worker/tab-content.js`, dan
tes byte-identity di atas membuktikan keduanya cocok. `py tests/browser_extension_test.py`
dijalankan setelah langkah 3 dan setelah langkah 8 — dua titik di mana halaman sungguhan
bekerja atau tidak: setelah seluruh lapisan fakta elemen pindah, dan setelah modul
terakhir pindah.

## Batasan

**Fungsi tidak di-rename.** Sebagian nama dirujuk sebagai deklarasi di dalam string atau
regex (`indexOf('function resolveActionRef(ref) {')`, `/function collectInteractiveNodes\(/`).
Menamai ulang memutus asersi itu tanpa mendapat apa-apa.

**`handle` dan `onMessage` tidak disentuh isinya.** Keduanya tetap di `content.js`.

**Isi daftar injeksi hanya boleh bertambah.** Boleh kurangi, boleh disusun ulang — tapi
hanya dengan menambah path modul baru di posisi yang ditentukan urutan muat di atas.

**Pola namespace, bukan ESM.** Batasan MV3, bukan pilihan selera. Setiap modul baru
memakai guard + `Object.freeze` seperti `role-reconcile.js`.

**Tidak ada file worker yang disentuh.** 59 berkas milik sesi lain (`extension/lib/`,
`extension/worker/`, `local/`, `docs/`, `supabase/functions/_shared/billing.js`) tidak
masuk cakupan sama sekali.

## Pengujian

Semua dalam `npm test` (1634 tes hari ini) plus `npm run check` plus
`py tests/browser_extension_test.py`. Tiap pemindahan diakhiri ketiganya — bukan tiap
fase, bukan cuma di akhir.

### Yang ditambahkan

- Helper `tests/helpers/content-source.mjs` + empat belas berkas tes yang memakainya,
  plus `scripts/check.mjs`.
- Gerbang ukuran: `extension/content.js` di bawah 300 baris, dan delapan modul baru
  masing-masing di bawah 550 — plafon yang repo sudah tetapkan untuk worker, dipakai
  juga di sini.
- Gerbang urutan muat, gerbang namespace-terbit, dan gerbang state-tak-terduplikasi.
  Yang terakhir **menggantikan** bukti yang tadinya dikira sudah ada: gate
  *no state is declared twice* di `tests/extension-source.test.mjs` berjalan di bundel
  **worker**, yang tidak memuat satu pun content script, jadi ia tidak pernah mengukur
  risiko yang paling besar di pemindahan ini.
- Bukti bebas `chrome.*` untuk tujuh modul baru, dengan satu kecualian tertulis untuk
  `page-media.js` — dihitung, bukan dijanjikan.
- Pin SHA-1 di `tests/helpers/boundary-locks.mjs` pindah ke delapan modul baru, supaya
  kunci permukaan publik tidak ikut melemah ketika `content.js` menyusut.

### Yang tidak berubah

`tests/extension-source.test.mjs` (byte-identity), jumlah tool MCP, `manifest.json`
selain daftar path, dan seluruh asersi yang ada — yang berubah hanya berkas yang dibaca.

### Bukti perilaku, bukan hanya struktur

Helper bundel membuktikan kode masih ada. Yang membuktikan halaman masih hidup adalah
`py tests/browser_extension_test.py`, yang mengendarai halaman sungguhan: baca, temukan,
klik, scroll, tunggu, media. Itu bukti terkuat untuk spec ini dan tidak boleh dilewatkan
karena hijau di Node.

## Risiko

**Namespace dipanggil sebelum ada.** Urutan muat adalah satu-satunya penjaga. Kalau
`content.js` mendahului modul yang dibutuhkannya, ia mendapat `undefined` — dan karena
degrasi adalah properti yang dikunci, kegagalannya **sunyi**, bukan lempar. Penjaga:
tes byte-identity + tes browser setelah langkah 4 dan 8, bukan pembacaan kode.

**`doesNotMatch` menjadi lebih ketat.** Empat belas berkas kini membaca 14 berkas,
bukan satu. Pola yang dulu tidak ada di `content.js` sekarang diperiksa terhadap modul
baru. Kalau ada yang gagal, keputusannya adalah memperbaiki kodenya — bukan mengembalikan
helper ke satu berkas.

**State terduplikasi.** 49 deklarasi. Kalau sebuah state ternyata dipakai dua region dan
dipindah ke satu modul, salinan kedua menyimpang tanpa suara. Tabel di atas sudah
dihitung per baris; yang tidak ada di tabel dan tidak ikut regionnya tetap di
`content.js` dan dikirim lewat argumen — diperiksa tiap langkah, dan sekarang juga
diperiksa gerbang yang membandingkan deklarasi entry dengan deklarasi modul.

**Degrasi yang hilang.** `tests/efficiency.test.mjs` mengunci bahwa helper yang tidak
ada tidak menjatuhkan seluruh content script. Delapan modul baru berarti delapan
kesempatan untuk melempar di load. Guard + pembacaan namespace yang toleran nol wajib
dipertahankan di setiap langkah.

**Angka yang bergeser.** Tabel dihitung sekali pada pohon bersih. Setelah tiap langkah,
hitung ulang. Kalau berbeda, yang diperbaiki tabelnya dan alasannya dicatat.

## Setelah spec ini

Dua area berikutnya adalah PR terpisah dengan spec sendiri, bukan kelanjutan ini:

- `landing/dashboard.html` — 917 baris JS inline menjadi `landing/dashboard.js`, dan
  CSP halaman itu tidak lagi butuh hash karena `script-src 'self'` sudah ada.
- Sembilan edge function — 147 kemunculan setup yang sama (`createClient`, CORS, auth,
  `json(`) menjadi satu `supabase/functions/_shared/edge-runtime.ts`.
