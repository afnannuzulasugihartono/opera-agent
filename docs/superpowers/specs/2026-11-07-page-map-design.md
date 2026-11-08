# Spesifikasi: Peta Halaman Penuh (Page Map)

@last-edited: 2026-11-07 UTC+7.
@related: [AGENTS.md](../../../AGENTS.md) - [docs/agent-call.md](../../agent-call.md)

Disetujui sebagai arah pada 2026-11-07. Spec ini mendefinisikan satu jalur baca baru untuk agent AI: memetakan **seluruh** satu halaman web — semua elemen yang bermakna, dikelompokkan menurut kelas, dengan koordinat dokumen — plus menangkap **halaman penuh** (dari atas sampai bawah), bukan satu viewport.

## Intent

Sebuah model yang membaca halaman Wikipedia hari ini harus berjalan seperti orang buta yang membaca koran: satu layar, lalu digeser, lalu digeser lagi. Yang didapat dari `read_page` sekarang adalah 16 elemen interaktif milik viewport dan 6.000 karakter pertama dari 67.674 karakter teks. Sisanya tidak pernah terlihat.

Tujuan spec ini: satu panggilan memberi **peta** halaman itu — kerangkanya dulu (berapa elemen per kelas, di mana bagian-bagiannya), lalu model menarik isi kelas yang ia perlukan. Peta menggantikan pengguliran. Sibling-nya: `capture_page` harus bisa memotret **halaman penuh**, yaitu seluruh dokumen dari atas sampai bawah, bukan jendela yang sedang tampil.

Keputusan yang mengikat (hasil brainstorming 2026-11-07):

- **Peta halaman untuk AI.** Model perlu gambaran utuh halaman supaya bisa bernalar soal seluruh halaman tanpa scroll. Payload besar tidak masalah asalkan terstruktur dan bisa ditelusuri per kelas.
- **Kelas semantik saja.** Elemen = simpul yang punya makna. Wrapper seperti `span`, `div`, `i`, `b` tidak dihitung kalau isinya sudah dibawa elemen di dalamnya. Di artikel Wikipedia `id`: ±3.500–4.500 elemen dari 8.121 node DOM.
- **Kerangka dulu, tarik per kelas.** Panggilan pertama murah dan memberi bentuk halaman; panggilan berikutnya hanya membawa kelas yang diminta.
- **Peta standar per elemen.** `class`, `ref`, `tag`, `role`, teks, kotak dokumen, urutan baca, level, status, identitas, konteks, plus field khas per kelas.
- **Tool baru.** `read_page_map` berdiri sendiri; `read_page` lama tidak berubah bentuk.
- **Full capture utama, tile fallback.** Gambar halaman penuh dicoba dulu; kalau gagal atau tak terbaca, dokumen dipotong jadi tile.
- **K&R JSON untuk semua output.** State sekali, di depan. Koleksi = array. Tidak ada field yang mengulang informasi field lain, tidak ada field kosong yang tidak dibaca siapa pun.

## Non-goals V1

- Tidak mengganti `read_page` yang ada, tidak mengubah `find_elements`, `click_element`, `fill_element`, atau 30 primitive browser lainnya.
- Tidak menarik peta per region (sidebar, artikel, infobox). V1 menarik per kelas; elemen membawa `regionId` supaya model bisa mengelompokkan sendiri.
- Tidak scroll-and-stitch. Gambar diambil lewat clip koordinat dokumen, jadi layar yang sedang dilihat pengguna tidak pernah digeser dan header lengket tidak terulang.
- Tidak menyimpan atribut HTML mentah (`id`, `class`, `aria-*`, `data-*`) per elemen.
- Tidak menyimpan gaya terhitung (warna, font, border).
- Tidak menyentuh MCP lokal stdio (54 tool) — perubahan ini hanya pada surface hosted.
- Tidak membuat primitive browser baru. Peta berjalan di atas `page.read` yang sudah ada.

## Taksonomi kelas

Satu elemen satu kelas. Kalau satu simpul cocok beberapa aturan, aturan yang lebih dulu dalam urutan berikut yang menang — jadi `<a role="button">` adalah `button`, bukan `link`.

| kelas | elemen yang dihitung | field khas |
|---|---|---|
| `button` | `button`, `[role=button]`, `input[type=submit\|button\|reset\|image]` | — |
| `choice` | `input[type=checkbox\|radio]`, `[role=checkbox\|radio\|switch]` | `checked`, `name`, `type` |
| `input` | `input` teks, `textarea` | `type`, `name`, `value`, `placeholder` |
| `select` | `select` | `name`, `options[]` |
| `heading` | `h1`-`h6`, `[role=heading]` | `level` |
| `link` | `a[href]`, `area[href]` | `href` |
| `media` | `video`, `audio` | `src`, `paused`, `currentTime`, `duration` |
| `iframe` | `iframe`, `frame`, `object`, `embed` | `src`, `title` |
| `picture` | `img`, `picture`, `canvas`, `svg` dengan sisi ter-render ≥ 24 px | `src`, `alt` |
| `icon` | `svg`, `img`, `[role=img]` dengan sisi ter-render < 24 px | `src`, `alt` |
| `table` | `table`, `[role=table\|grid]` | `rows`, `cols`, `headers[]` |
| `list` | `ul`, `ol`, `[role=list]` | `itemCount` |
| `form` | `form`, `[role=form]` | `fieldCount` |
| `region` | `header`, `nav`, `aside`, `footer`, `main`, `dialog`, `[role=dialog\|banner\|navigation\|complementary\|contentinfo\|main]` | `kind`, `role` |
| `separator` | `hr`, `[role=separator]` | — |
| `status` | `[role=status\|alert\|progressbar\|meter]`, `output` | `value` |
| `text` | `p`, `li`, `td`, `th`, `blockquote`, `figcaption`, `dd`, `dt`, `pre`, `summary`, `label`, `caption` yang teksnya tidak kosong | `for` (label), `row`/`col` (sel tabel) |

`li` dan `td` bukan kelas sendiri: mereka `text` dengan `tag` yang membedakannya, `depth` yang menyebut kedalaman daftar, dan `row`/`col` yang menyebut posisi sel. `section` bukan `region`: 33 `<section>` di artikel Wikipedia akan membanjiri peta, dan hierarkinya sudah terbawa oleh `outline`.

## Bentuk keluaran

### Kerangka — `read_page_map` tanpa `class`

```json
{ "ok": true, "tabId": 1517046936,
  "documentId": "d8088417-6fb4-4da0-876e-59ee661bee42",
  "url": "https://id.wikipedia.org/wiki/Bahasa_Indonesia",
  "title": "Bahasa Indonesia - Wikipedia bahasa Indonesia",
  "documentWidth": 1521, "documentHeight": 25147,
  "viewport": { "width": 1536, "height": 776, "scrollX": 0, "scrollY": 0, "zoomFactor": 1 },
  "scannedAt": "2026-11-07T15:04:11.902Z",
  "mutationVersion": 185,
  "totalElements": 4123,
  "classes": [
    { "class": "text", "count": 1587, "bbox": { "x": 0, "y": 0, "width": 1521, "height": 25147 } },
    { "class": "link", "count": 2274, "bbox": { "x": 640, "y": 90, "width": 620, "height": 24800 } }
  ],
  "regions": [ { "regionId": "rg_main", "kind": "landmark", "role": "main", "label": "", "bbox": {}, "elementCount": 3901 } ],
  "outline": [ { "level": 1, "text": "Bahasa Indonesia", "y": 97, "ref": "oa_..." } ],
  "tables": [ { "ref": "oa_...", "rows": 12, "cols": 3, "headers": ["Provinsi", "Jumlah", "%"], "bbox": {} } ],
  "images": [ { "ref": "oa_...", "alt": "Sampul ...", "bbox": {}, "caption": "..." } ] }
```

Ukuran gambar ada di `bbox`, jadi tidak diulang sebagai `width` dan `height`.

Kerangka tidak punya amplop: fakta halaman di atas, koleksi di bawah, semuanya satu tingkat. `classes[]` adalah array; tiap butir menyebut jumlah dan kotak pembatas seluruh kelas itu, supaya model tahu di mana kelas itu berada tanpa menarik isinya.

### Tarik satu kelas — `read_page_map { class: "link", offset: 0, limit: 200 }`

```json
{ "ok": true, "tabId": 1517046936, "class": "link",
  "offset": 0, "limit": 200, "total": 2274, "hasMore": true, "nextOffset": 200,
  "elements": [ {
    "class": "link", "ref": "oa_d8088417_3v", "tag": "a", "role": "link",
    "text": "Wikikutip bahasa Banjar",
    "label": "Wikikutip bahasa Banjar (halaman belum tersedia)",
    "href": "https://id.wikipedia.org/w/index.php?title=...",
    "rect": { "x": 660, "y": 98, "width": 137, "height": 14, "centerX": 728, "centerY": 105 },
    "order": 412, "depth": 3, "regionId": "rg_document",
    "visible": true, "actionable": true, "disabled": false,
    "logicalId": "se_ea2a_3a071b9d97_3p", "stableKey": "oa_..."
  } ] }
```

`limit` default 200, maksimum 1000. `hasMore` dan `nextOffset` bersama-sama memberi tahu jalan pagination tanpa menebak.

### Koordinat

`rect` adalah koordinat **dokumen** (`getBoundingClientRect()` ditambah posisi scroll saat pemindaian), bukan koordinat viewport. Alasannya: pada koordinat viewport, setiap angka berubah begitu halaman digeser, jadi peta tidak bisa dipakai sebagai rujukan. `ref` tetap menjadi kunci aksi — `click_element` memakai `ref`, bukan koordinat — sehingga peta yang diambil sebelum scroll tetap bisa dipakai sesudahnya.

## Aturan K&R untuk semua output

Berlaku ke 34 tool hosted yang ada dan ke `read_page_map`:

- Bentuk: `{ ok, ...fakta }`. Tidak ada amplop yang isinya satu payload (`result`, `data`, `output`), dan tidak ada lapisan yang menggandakan isi.
- Setiap koleksi adalah array di bawah field bernama (`tabs`, `items`, `elements`, `classes`, `events`, `rows`, `skills`, `segments`). Tidak ada map yang isinya daftar.
- Objek bersarang hanya boleh kalau ia mengelompokkan fakta dari satu hal (`viewport`, `rect`, `bbox`) — bukan daftar, bukan amplop.
- Setiap fakta disebut sekali. `tabId` tidak boleh muncul dua kali di level berbeda.
- Tidak ada field yang isinya `null` atau array kosong tanpa alasan; array kosong berarti "tidak ada", dan itu tidak dihapus.
- **Nama field tidak berubah dan field yang sedang dipakai tidak dicabut.** `previousHash`, `sessionId`, `watcherId`, `ref`, `tabId`, dan semua field yang dibaca klien lain tetap. Yang dicabut hanya field yang benar-benar duplikat atau tidak pernah dibaca.
- Pengecualian yang diketahui: `read_page` lama tetap punya objek `page` (nama field tidak boleh berubah). Isinya dirapikan — koleksinya jadi array, fakta yang kembar dengan level atas dicabut satu kali.
- Audit 34 tool adalah bagian dari perubahan ini, bukan pekerjaan terpisah.

## Halaman penuh (screenshot)

`capture_page { fullPage: true }` sudah ada di perangkat: CDP `Page.captureScreenshot` dengan `captureBeyondViewport: true` dan clip ke `contentSize`. Yang ditambahkan adalah **fallback tile**.

Fallback menyala kalau full capture:

- gagal: `SCREENSHOT_TOO_LARGE`, `SCREENSHOT_TOO_SMALL`, `BLANK_SCREENSHOT`, `CAPTURE_TIMEOUT`, atau error CDP; atau
- berhasil tapi tak terbaca: skala hasil < 0,2 atau lebar hasil < 320 px. Untuk dokumen setinggi 25.147 px, full capture diskalakan jadi ±54x900 px — itu lolos cek ukuran tetapi tidak bisa dibaca, jadi harus turun ke tile.

Mode tile memotong dokumen menjadi strip pada koordinat dokumen (tanpa scroll), tinggi strip = tinggi viewport, skala 1. Keluarannya:

```json
{ "ok": true, "tabId": 1517046936,
  "page": { "title": "...", "url": "..." },
  "tiles": [ { "index": 0, "sha256": "...", "width": 1521, "height": 776, "bytes": 183421, "y": 0 },
             { "index": 1, "sha256": "...", "width": 1521, "height": 776, "bytes": 191002, "y": 776 } ],
  "documentHeight": 25147, "tileCount": 33, "coveredHeight": 1552,
  "hasMore": true, "nextTileOffset": 2 }
```

Setiap tile menjadi satu blok gambar di `content[]`. `previousHash` tetap berlaku: pada mode tile, hash yang dibandingkan adalah hash gabungan tile-tile pada irisan itu.

**Tile dikirim per irisan, bukan semua sekali.** Hasil perintah perangkat dibatasi 512 KiB (`extension/lib/serialize.js`, `MAX_RESULT_BYTES`), dan 33 tile halaman Wikipedia sekitar 5 MB — lebih besar dari yang boleh melewati kabel. Jadi perangkat mengembalikan irisan tile yang muat di anggaran byte (biasanya 2-4 tile), dan `capture_page` menerima satu parameter baru: `tileOffset` (bilangan bulat >= 0, bawaan 0). Panggilan pertama mengambil irisan pertama; panggilan berikutnya memakai `tileOffset` untuk mengambil sisanya. `tileCount` adalah jumlah tile yang dibutuhkan seluruh dokumen, `coveredHeight` adalah tinggi yang sudah tercakup, dan `hasMore`/`nextTileOffset` memberi tahu jalan sisanya.

Dengan begitu satu halaman penuh tetap satu perjalanan per potongan, dan peta JSON tetap sumber kebenaran untuk bagian yang belum dipotret.

## Arsitektur

Tiga bagian, satu arah:

1. **`extension/lib/page-map.js` (baru).** Tabel aturan klasifikasi (tag/role ke kelas) dan aturan field per kelas, murni data dan fungsi tanpa DOM, supaya bisa diuji di Node tanpa DOM — pola yang sama seperti `extension/lib/protocol.js`. Modul ini tidak tahu apa pun soal transport.
2. **`extension/content.js`.** Pemindaian: satu lintasan seluruh dokumen, klasifikasi per node, pengukuran kotak, urutan baca, kedalaman daftar, posisi sel tabel. Hasil di-cache per `documentId` + `mutationVersion`, jadi menarik kelas berikutnya adalah cache-hit, bukan scan ulang. `pageRead` mendapat cabang ketiga: `view` = `compact` (sekarang), `map` (baru), atau default.
3. **`supabase/functions/opera-agent-mcp/tools.ts`.** Tool baru `read_page_map`; `capture_page` menerima hasil tile; `read_page` tetap.

Aliran data: MCP -> `page.read` dengan `view: "map"` -> content script -> peta -> balik ke MCP -> bentuk datar K&R.

## Protokol dan kontrak

- `page.read` menerima parameter baru `class`, `offset`, `limit`; `view: "map"` memilih mode peta. `validateCommand` tidak punya allowlist parameter untuk `page.read`, jadi tidak ada primitive baru dan jumlah primitive tetap **31**.
- Batas waktu perangkat untuk `page.read` dinaikkan 10.000 -> 30.000 ms, karena pemindaian halaman berat bisa melewati 10 detik di perangkat lambat. Sisi MCP mengirim `timeoutMs` 30.000 untuk mode peta.
- `page.capture` gains exactly one parameter, `tileOffset` (integer >= 0, default 0), because the tile fallback must be walked in slices: the device result is bounded at 512 KiB (`MAX_RESULT_BYTES`), and a full-page tile set is several megabytes. `page.capture`'s allowlist in `validateCommand` gains the same key.
- Kontrak MCP hosted berubah dari 34 menjadi 35 tool. Yang harus dipin ulang, dengan alasan tertulis: `tests/fixtures/mcp-contract-v1.json` (`toolCount`, `tools[]`), peta digest beku di `tests/mcp-surface.test.mjs`, baris "Cloud MCP surface" di `README.md`, pin `index.ts` dan `tools.ts` di `tests/helpers/boundary-locks.mjs`, dan `gates.lock` untuk `extension/lib/protocol.js`.

## Batas dan performa

- Pemindaian satu halaman 8.000 elemen: 200-600 ms di perangkat (satu lintasan DOM + satu kali flush layout). Tarik kelas berikutnya: cache-hit, di bawah 50 ms.
- Kelas terbesar di Wikipedia adalah `link` (2.274 elemen). Tarik semuanya = ±400 KB. Karena itu paginasi ada dan `limit` dibatasi 1.000.
- Peta penuh untuk satu artikel = ±400-800 KB. Kerangka hanya ±15-40 KB.
- Batas `MAX_ELEMENTS` (200) yang berlaku pada mode compact tidak berlaku pada mode peta; peta punya batas sendiri: 20.000 elemen per dokumen, dan lebih dari itu dipotong dengan penanda `truncated`.

## Target keberhasilan yang dapat diukur

- Pada artikel `id.wikipedia.org/wiki/Bahasa_Indonesia`: kerangka melaporkan minimal 3 kelas dengan jumlah lebih dari 0, `classes[]` memuat tepat 17 entri, dan `totalElements` sama dengan jumlah simpul yang cocok tabel klasifikasi pada DOM statis halaman itu (dihitung terpisah saat verifikasi, bukan jumlah semua node DOM yang 8.121).
- Menarik `class: "link"` dengan `offset` dan `limit` berjalan sampai habis: jumlah yang diterima = `total` dari kerangka, tanpa duplikat dan tanpa lompatan (offset 0, 200, 400, ...).
- `rect` pada elemen yang ada di bawah fold memakai koordinat dokumen: nilainya lebih besar dari tinggi viewport, dan `click_element` dengan `ref` dari peta tetap berhasil setelah halaman digeser.
- `capture_page { fullPage: true }` pada artikel yang sama: hasilnya satu gambar, atau `tiles[]` yang jumlah `y` terakhir + tinggi strip minimal `documentHeight`.
- Tidak ada `console.log` baru; komentar mengikuti aturan repo: satu kalimat per aturan, tanpa blok "WHY" baru.
- `npm test` dan `npm run check` hijau di worktree.

## Risiko yang diterima

- **Chrome merender ulang area di bawah fold saat full capture.** Gambar lazy-load yang belum ter-render bisa kosong. Diterima: tile juga memakai clip dokumen, jadi limitation-nya sama, dan model punya peta JSON sebagai sumber kebenaran kedua.
- **DOM bilang visible, mata orang tidak.** Pada 2026-11-07, `read_page` melaporkan dua tautan site-notice Wikipedia sebagai `visible: true, inViewport: true`, sementara teksnya tidak terbaca di tangkapan layar. Peta memakai definisi visible yang sama dengan `read_page` sekarang, jadi ketidaksesuaian ini terbawa, bukan diperbaiki.
- **Kelas `text` mengulang isi anak-anaknya.** Sebuah `li` yang memuat satu tautan memuat teks tautan itu juga. Diterima: model sering butuh kalimat utuh sebuah item, dan `tag` plus `ref` anak sudah menunjuk ke sumbernya.
- **Cache bisa basi pada halaman yang berubah terus.** `mutationVersion` membatalkan cache; pemindaian ulang 200-600 ms. Diterima.
- **Tambah satu tool ke kontrak hosted.** Klien lain (Cline, Claude, dan lain-lain) akan melihat satu tool baru. Tool lama tidak berubah, jadi tidak ada yang rusak.
- **Audit 34 output bisa menyinggung klien yang bergantung pada field lama.** Aturan: nama field tidak berubah; hanya field duplikat atau kosong yang dicabut, dan setiap pencabutan dicatat satu per satu di diff.

## Di luar spec ini

- Tarik peta per region (sidebar, artikel, infobox) — kalau model sering butuh satu bagian saja.
- Peta diff antar waktu (snapshot halaman lalu bandingkan) — `semanticDelta` hari ini hanya sepotong.
- Peta untuk canvas atau remote screen — `capture_page` sudah menjadi jawabannya, dan `axSummary` hanya read-only.
- Scan PDF dan dokumen non-DOM.
- Peta multi-tab (gabungan beberapa tab) — setiap tab punya `documentId` sendiri.

## Uji

- `tests/page-map.test.mjs` (baru): tabel klasifikasi — setiap kelas punya aturan, setiap aturan tag/role ada di allowlist, urutan prioritas benar, dan field per kelas lengkap.
- `tests/mcp-surface.test.mjs`: tool baru terdaftar, punya judul dan kalimat "Returns:", input terdeskripsi, output schema datar, peta digest beku diperbarui.
- `tests/browser_extension_test.py`: pemindaian di dalam halaman — jumlah kelas pada halaman uji, koordinat dokumen, pagination.
- Uji perangkat nyata: artikel Wikipedia asli — kerangka, tarik `link`, tarik `text`, dan full capture; angka dibandingkan dengan spec ini.
- `npm test` dan `npm run check` di worktree `opera-agent-page-map` sebelum commit.
