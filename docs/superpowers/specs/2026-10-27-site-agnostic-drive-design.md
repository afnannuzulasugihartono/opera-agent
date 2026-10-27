@last-edited: 2026-10-27 UTC+7.
@related: [`../../../AGENTS.md`](../../../AGENTS.md) - [`../../handoff.md`](../../handoff.md) - [`../../naming.md`](../../naming.md) - [`../../unknown-site.md`](../../unknown-site.md) - [`../../api.md`](../../api.md) - [`2026-10-23-local-run-task-design.md`](2026-10-23-local-run-task-design.md)

# Spec: Site-agnostic drive — membaca dan bertindak di permukaan kompleks tanpa kode per-situs

Disetujui sebagai arah pada 2026-10-27. Spec ini belum membangun apa pun; ia
memutuskan bentuk, batas, dan urutan langkah sebelum kode disentuh. Lingkupnya
adalah **sub-proyek 1+2** dari dekomposisi generic drive: comprehension dan
action. Mutasi, komposisi task, dan pengiriman artefak adalah sub-proyek
berikutnya dan tidak masuk di sini.

## Intent

Opera Agent hari ini membaca Google Docs dengan kode yang mengenali situs itu
secara eksplisit. Situs canvas lain — Sheets, Slides, dan aplikasi berat yang
belum pernah dilihat — hampir tidak terbaca sama sekali. Tool-nya sendiri sudah
mengakui batas ini: "On other canvas-rendered pages little or no text comes
back".

Tujuannya adalah membalik arah itu: agent menurunkan cara kerja sebuah
permukaan dari **sinyal generik** — bukan dari URL, nama domain, atau selector
khusus situs. Situs yang belum pernah dilihat diperlakukan sama dengan situs
yang sudah dikenal.

Constraint yang mengikat, dari `AGENTS.md`: **tidak ada kode per-situs dan tidak
ada `eval` bebas di extension**. Spec ini melunasi utang yang sudah ada, bukan
menambah utang baru.

Target keberhasilan yang dapat diukur:

- Membaca sebuah Google Doc sungguhan lewat CDP pada profil harian yang sudah
  login, tanpa memindahkan caret user.
- Profil permukaan (`surface_profile`) dikembalikan untuk situs tak dikenal
  dengan bukti terukur untuk setiap klaim, dan tanpa nama situs di dalam kode.
- Nol kemunculan `isDocsDocument`, `.kix-`, atau `DOCS_COPY_EXPRESSION` di
  `local/` setelah perubahan.
- `npm test`, `npm run check`, dan gate browser Python hijau.
- Latensi baca non-destruktif diukur dan dilaporkan, bukan diasumsikan.

## Non-goals

- Tidak menambah wire method baru ke `extension/lib/protocol.js`; jumlah
  primitif allowlisted tetap 31. Driver lokal mengirim CDP langsung, jadi
  kapabilitas baru tidak melewati wire protocol.
- Tidak mengubah surface cloud (`supabase/functions/opera-agent-mcp`).
- Tidak membangun mutasi terverifikasi, komposisi task, atau pengiriman
  artefak — itu sub-proyek 3, 4, dan 5.
- Tidak menambah dependency baru.
- Tidak melakukan refactor besar `local/` di luar file yang perlu disentuh.
- Tidak push branch dan tidak membuka PR tanpa persetujuan terpisah.
- Tidak mengubah perilaku `page.read` untuk halaman DOM biasa; tangga hanya
  mengubah jalur yang hari ini salah atau tidak ada.

## Fakta terverifikasi

Semua angka di bawah diukur pada 2026-10-27 di mesin pemilik, terhadap profil
harian Brave v156 yang sedang berjalan, dengan tab Google Docs sungguhan
terbuka. Metode: driver repo sendiri (`local/driver.js`) over CDP, dan
`curl` terhadap port debugging.

### Transport

- Brave v156.1.98.60, Edge v156, Chrome v153 semula terpasang. Ketiganya sudah
  melewati Chrome 136, jadi remote debugging menuntut `--user-data-dir`
  eksplisit.
- Profil harian Brave: 1,58 GB, cookie di
  `Default/Network/Cookies` (491 KB), satu profil `Default`.
- CDP menempel ke profil harian yang sudah login ketika browser dijalankan
  dengan `--remote-debugging-port=9333 --user-data-dir=<profil asli>`.
  Attach terukur **28 ms**.
- Latensi pada profil harian, dengan tab Docs sungguhan: attach **28 ms**,
  baca select-all **332 ms** pertama dan **374 ms** median.
- Latensi pada profil terisolasi, halaman `example.com`: attach **24 ms**,
  baca median **46 ms**, tombol **29 ms**. Angka ini menunjukkan biaya
  transport CDP; angka 332/374 di atas menunjukkan biaya jalur canvas yang
  meminjam seleksi.
- Bridge, dari `docs/handoff.md`: **1.875 ms** rata-rata atas 9.079 command,
  p95 1.914 ms. Jadi CDP sekitar **5x** lebih cepat pada jalur baca canvas,
  dan sekitar **40x** pada transport.

### Tiga jalur baca, diukur

| Jalur | Latensi | Bahaya | Cakupan |
| --- | --- | --- | --- |
| a11y tree (`Accessibility.getFullAXTree`) | **19–30 ms** | nol, read-only | 215 kotak teks, 3.063 karakter, terpotong |
| select-all + copy | 332–374 ms | memindahkan caret | 100%, 7.278 karakter |
| visi (`page.capture`) | tidak diukur di spike | nol | piksel |

- a11y tree membawa struktur dokumen: 155 `InlineTextBox`, 60 `StaticText`,
  2 node `Canvas`, heading 1 sampai 9 utuh.
- Teks a11y **terpotong** oleh Chrome: tail berbunyi
  `6. LEGALITAS DAN DO…7. BENTUK KERJA SAM…`. Ia juga mencampur chrome UI
  ("Mode tampilan", "Screen reader support enabled").
- Kedua jalur saling melengkapi, dan yang non-destruktif adalah yang tercepat.

### Caret tidak bisa dipulihkan lewat DOM

Ini temuan yang mengubah desain, dan ia membantah hipotesis awal.

- Hipotesis yang diuji: caret hidup di iframe, jadi pencarian caret yang
  masuk ke iframe akan memulihkannya.
- Hasil: seleksi di iframe editor selalu `offset: 0` pada node tanpa teks,
  bahkan setelah menekan `Home` dan `End`. Seleksi itu **tidak melacak**
  posisi caret. Select-all mengubahnya (`collapsed: false`), `End`
  mengembalikannya ke keadaan semula — tapi keadaan semula itu bukan posisi
  asli.
- Kesimpulan: aplikasi canvas menyimpan posisi caret di model internalnya
  sendiri, tak terlihat dari DOM. **Caret tidak bisa diingat atau dipulihkan
  melalui DOM selection untuk aplikasi canvas apa pun.**

Konsekuensi langsung: strategi baca yang memindahkan caret **tidak dapat
dijanjikan aman**. Ia harus bergate, bukan dibiarkan sebagai default.

## Arsitektur

Empat modul di `local/`, masing satu fungsi murni dari bukti ke keputusan,
sehingga dapat diuji tanpa browser. Pola ini mengikuti `local/page-expressions.js`
yang sudah mengekspor ekspresi sebagai data.

### `local/surface-profile.js` — probe kapabilitas

Satu ekspresi di-dalam-halaman mengembalikan profil berbukti. Modul ini
**menggantikan** `isDocsDocument(url)`. Tidak ada nama situs, domain, atau
selector khusus di dalamnya.

Bentuk profil:

```
{
  textInDom: { value, evidence },
  canvasCoverage: { value, evidence },
  editable: { value, evidence },
  axRich: { value, evidence },
  focused: { value, evidence }
}
```

Setiap klaim membawa `evidence` berupa angka yang diukur. Klasifikasi yang
salah karena itu terlihat, bukan sunyi — inilah perbedaan dari
`isDocsDocument`, yang menebak dari URL dan tidak punya bukti.

### `local/read-strategy.js` — pemilih strategi baca

Fungsi murni: `profile → strategi berurut + kelas bahaya per strategi`.
Tidak menyentuh browser, jadi dapat diuji sebagai tabel.

### `local/caret-guard.js` — disiplin anti-bahaya

Generik, untuk permukaan editable apa pun. Memegang tiga hal: menyimpan state
user, memulihkannya, dan **melaporkan jujur ketika pemulihan mustahil**. Modul
ini juga memegang focus-gate: menolak strategi destruktif pada permukaan yang
tidak memenuhi syarat.

Ini inti temuan spike. Kode lama melaporkan kegagalan dengan jujur
(`caretRestored: false`) tetapi tetap melakukan kerusakannya. Modul ini
memisahkan keduanya: melapor adalah syarat, bukan pengganti mencegah.

### `local/action-strategy.js` — strategi aksi

Memilih grounding elemen DOM versus koordinat-plus-keyboard untuk permukaan
canvas. Dibatasi pada keputusan; pelaksanaannya tetap primitif yang ada.

## Model bahaya

Setiap strategi baca memiliki satu kelas bahaya.

| Kelas | Arti | Contoh | Syarat |
| --- | --- | --- | --- |
| `none` | tidak mengubah halaman | a11y tree, teks DOM, visi | selalu boleh |
| `caret-move` | mengubah seleksi atau caret | select-all + copy | bukti pemulihan, atau konsent |
| `content-change` | mengubah isi | mengetik | konsent eksplisit di pemanggilan |

Aturan gate: strategi dengan bahaya di atas `none` hanya berjalan bila (a) ada
bukti permukaan dapat dipulihkan, atau (b) ada persetujuan operator yang
tercatat pada pemanggilan.

Karena caret aplikasi canvas terbukti tak dapat dipulihkan lewat DOM, syarat
(a) praktis tidak pernah terpenuhi untuk `caret-move`. Hasilnya benar:
default menjadi non-destruktif, dan select-all hanya jalan ketika operator
secara eksplisit memintanya.

## Kebijakan fokus

Agent **tidak pernah** mencuri fokus. Tab yang tidak fokus bukan alasan untuk
berhenti; ia justru alasan untuk memakai jalur non-destruktif. Ini yang
membuat "berjalan di background" mungkin: pekerjaan background tidak pernah
menyentuh caret, karena default-nya a11y.

## Tangga baca

```
a11y tree  ->  teks DOM  ->  select-all (bergate)  ->  visi
  nol          nol             caret-move              nol
```

Urutan dipilih oleh biaya dan bahaya yang terukur, bukan oleh asumsi.
`read-strategy.js` adalah satu-satunya tempat urutan ini ditulis.

## Tangga aksi

```
elemen DOM  ->  koordinat + keyboard
```

Dipilih oleh `action-strategy.js` dari profil yang sama.

## Naming

Mengikuti `docs/naming.md`, dan dicatat di sini agar tidak menimbul
interpretasi kedua.

- Nama file: kebab-case, seperti `local/page-expressions.js`.
- Nama tool MCP: `snake_case`. Dua nama baru: `surface_profile` dan
  `read_page` yang diperluas.
- Parameter tool: camelCase, seperti `tabId` dan `timeoutMs` yang sudah ada.
  Parameter konsent dinamai `allowCaretMove`.
- Wire method: **tidak ada yang baru.** Driver lokal mengirim CDP langsung,
  jadi `METHOD_SPECS` dan jumlah primitif allowlisted tetap 31.
- Nama tool dinamai untuk pekerjaan yang diminta pemanggil, bukan untuk metode
  yang dikirim di bawahnya.

## Aliran data

### `surface_profile`

Tool baru, read-only, satu panggilan murah. Ia menjawab "permukaan apa ini?"
sebelum agent memutuskan cara membacanya. Tanpa tool ini, agent harus membayar
satu baca penuh hanya untuk mengetahui bentuk permukaan.

Masukan: `tabId` saja. Keluaran: profil dari `surface-profile.js` plus
`strategy`, yaitu tangga yang akan dipakai `read-strategy.js` untuk profil itu.
Ia tidak membaca isi dokumen dan tidak menyentuh caret.

### `read_page`

Tool yang ada, diperluas.

1. `surface-profile.js` memprobe permukaan sekali, menghasilkan profil
   berbukti.
2. `read-strategy.js` membaca profil dan mengembalikan tangga plus kelas
   bahaya.
3. Driver berjalan dari atas tangga. Strategi `none` berjalan langsung.
4. Sebelum strategi `caret-move`, `caret-guard.js` memeriksa gate. Tanpa
   bukti pemulihan dan tanpa `allowCaretMove`, strategi itu dilewati dan
   alasannya dilaporkan.
5. Jawaban membawa `surface` (profil), `strategy` (yang dipakai), `harm`
   (kelas bahaya), dan `skipped` (alasan sebuah strategi dilewati).

Agent karena itu belajar sebuah situs dari satu panggilan, dan tahu mengapa
sesuatu tidak dilakukan.

## Penanganan galat

- a11y domain gagal atau kosong: turun ke teks DOM, lalu ke select-all
  bergate, lalu ke visi. Alasan setiap peluruhan dicatat.
- a11y mencampur chrome UI: dipisahkan secara struktural, bukan dengan daftar
  string. Setiap node a11y membawa `frameId`, dan dokumen editor hidup di
  frame yang berbeda dari chrome-nya. Aturannya: ambil a11y tree **per frame**
  dengan `Accessibility.getPartialAXTree`, lalu pilih frame yang subtree-nya
  membawa paling banyak `InlineTextBox`. Itu wilayah dokumen. Daftar string
  seperti "Mode tampilan" akan menjadi kode per-situs yang menyamar, jadi ia
  dilarang oleh aturan ini.
- Permukaan tidak editable tetapi canvas: lapor, jangan coba select-all.
- `page.read` pada halaman DOM biasa: perilaku tidak berubah.
- Timeout a11y: dilaporkan sebagai galat bernama, bukan kembali ke
  select-all tanpa izin.

## Pengujian

Tiga lapis, sesuai standar repo.

**Unit, tanpa browser.** `read-strategy.js` dan `caret-guard.js` adalah fungsi
murni, jadi diuji sebagai tabel: profil masukan, keputusan keluaran. Termasuk
kasus adversarial: canvas tanpa editable, a11y kaya tetapi teks kosong, dan
profil yang bertentangan.

**Unit, dengan CDP palsu.** `surface-profile.js` diuji terhadap halaman fixtur
yang menyatakan canvas, editable, dan fokus. Fixtur baru, bukan DOM Docs
sungguhan.

**Browser, nyata.** Satu drill yang membuktikan fungsi, bukan hijau: membaca
Google Doc sungguhan pada profil harian lewat CDP, memastikan caret user tidak
berpindah, dan melaporkan latensi terukur. Ini mengulang spike dengan
menggunakan kode yang dikirim, bukan skrip sekali-pakai.

Gate yang harus hijau: `npm test`, `npm run check`, dan
`py tests/browser_extension_test.py`.

## Definisi selesai

- Empat modul baru ada, masing-masing di bawah 1.200 baris, dengan empat field
  header, dan tidak ada ekspor yang tak dipakai.
- `local/primitives.js` merakit mereka; `local/tools.js` mendaftarkan
  `surface_profile`; `local/mcp-server.js` mendispatch keduanya.
- Nol kemunculan `isDocsDocument`, `.kix-`, dan `DOCS_COPY_EXPRESSION` di
  `local/`. `local/canvas.js` berubah dari pembaca Docs menjadi pemakai
  `caret-guard` dan `read-strategy`.
- `local/page-expressions.js` kehilangan ekspresi khusus Docs; ukurannya turun.
- Drill browser lulus dan angkanya dicatat di `docs/handoff.md`.
- Jumlah primitif allowlisted tetap 31, sehingga README dan halaman fitur
  tidak perlu diubah.
- `npm test` dan `npm run check` hijau; pohon LF.

## Urutan kerja

1. Tes untuk `read-strategy.js` lebih dulu, karena ia murni dan menjadi
   kontrak bagi sisanya.
2. `caret-guard.js` dan tesnya, termasuk gate.
3. `surface-profile.js` dan tesnya dengan CDP palsu.
4. `action-strategy.js` dan tesnya.
5. Sambungkan ke `primitives.js`, `tools.js`, `mcp-server.js`.
6. Lunasi utang: hapus jalur Docs khusus dari tiga file.
7. Drill browser nyata, lalu catat angkanya.

Langkah 1 sampai 4 tidak menyentuh browser dan dapat diverifikasi cepat.
Langkah 6 adalah yang berisiko dan dilakukan setelah tangga bekerja.
