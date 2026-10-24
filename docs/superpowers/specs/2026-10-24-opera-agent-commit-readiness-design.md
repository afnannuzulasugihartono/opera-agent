@last-edited: 2026-10-24 UTC+7.
@related: [`../../../AGENTS.md`](../../../AGENTS.md) - [`../../handoff.md`](../../handoff.md) - [`../../uec-north-star.md`](../../uec-north-star.md) - [`../../naming.md`](../../naming.md) - [`2026-10-23-local-run-task-design.md`](2026-10-23-local-run-task-design.md)

# Spec: Opera Agent commit readiness — document_build verification, docs, and migration cleanup

Disetujui sebagai arah pada 2026-10-24. Spec ini belum membangun apa pun; ia
memutuskan bentuk, batas, dan urutan langkah sebelum kode disentuh. Targetnya
adalah repo siap commit/PR, bukan deploy produksi.

## Intent

`document_build` menjanjikan paper yang aman karena setiap graph diperiksa
terhadap tabelnya. Implementasi saat itu tidak menepati janji itu: graph
non-`count` dengan nilai salah tetap diterima, graph `count` tanpa tabel juga
diterima, dan figure ledger hanya menyimpan jumlah baris, bukan baris yang
menghasilkan angkanya.

Spec ini menutup celah itu. Sebuah graph harus menunjuk sumbernya secara
eksplisit, dan recheck harus menghitung ulang angka graph dari baris yang
dinunjuknya. Output produk tetap JSON plan; tidak ada generator DOCX atau PDF
baru dalam scope ini.

Target keberhasilan yang dapat diukur:

- `document_build` menolak graph tanpa sumber, kolom tidak ada, tabel tidak ada,
  nilai non-numerik, dan graph yang tidak sama dengan hasil hitung tabelnya.
- `verifyDocument` menangkap graph yang diubah setelah build.
- `npm test`, `npm run check`, gitleaks working tree, dan gate browser Python
  hijau.
- Dokumentasi lokal menyebut jumlah tool yang benar dan mengenalkan
  `document_build` sebagai recipe.
- Migration Supabase yang masuk tree adalah satu migration final, bukan dua
  versi eksperimental yang belum applied.

## Non-goals

- Tidak deploy ke produksi dan tidak apply migration ke Supabase.
- Tidak membuat file DOCX atau PDF.
- Tidak menambah dependency baru.
- Tidak mengganti `report_build`; spec ini hanya menyamakan disiplin verifikasinya
  untuk `document_build`.
- Tidak melakukan refactor besar `local/` di luar file yang perlu disentuh untuk
  mencapai Definition of Done.
- Tidak push branch dan tidak membuka PR tanpa persetujuan terpisah.
- Tidak mengubah surface cloud.

## Fakta terverifikasi

Angka dan status ini diambil dari pohon pada 2026-10-24.

- Branch aktif `report-job` berada di `6aac3eb`, ahead 12 commit dari
  `origin/report-job`.
- PR #107 terbuka dengan head remote `fef3dff`, base `statement-drill`; check run
  unit, browser, secret-scan, dan SonarCloud hijau pada head remote itu, tetapi
  belum mencakup 12 commit lokal terakhir.
- `npm test` pada working tree: 1436 test, 1434 lulus, 2 gagal.
  - `tests/comment-placement.test.mjs:232` gagal karena `tmp_client.mjs:20`.
  - `tests/hygiene.test.mjs:41` gagal karena empat file tidak canonical:
    `supabase/migrations/20261023000000_docs_insert_table_v2.sql`,
    `supabase/migrations/20261023000001_docs_insert_table_v3.sql`,
    `tmp_burst.mjs`, dan `tmp_client.mjs`.
- Clone bersih dari HEAD `6aac3eb` lulus 1424/1424 test dan `npm run check`,
  sehingga kegagalan working tree berasal dari file untracked, bukan HEAD.
- `npm run check` pada working tree lulus: 31 allowlisted browser primitives, 180
  runtime safety files, version 1.6.27.
- `node --test tests/document-job.test.mjs` lulus 12/12, tetapi test itu belum
  menguji kontrak graph bersumber.
- `py tests/browser_extension_test.py` selesai tanpa exit error.
- `gitleaks detect --no-git --source . --redact` tidak menemukan secret.
- `local/tools.js` saat ini mendaftarkan 39 tool tanpa nama duplikat, dan
  `document_build` sudah ada di surface.
- `local/README.md:103` masih menulis 38 tools, sementara daftar tool di
  `local/README.md:105-111` sudah memuat `document_build`.
- Remote Supabase migration terakhir yang tercatat adalah
  `20261022090639 opera_price_decision`; dua migration `docs.insert_table` baru
  di working tree belum applied.

## Arsitektur

```
MCP tools/call document_build
  -> documents.documentFromFile(source)
    -> read JSON source
    -> parseDocument: JSON object dengan title dan sections
    -> buildDocument:
       - validate tables, images, headings
       - validate graph.source terhadap tabel di section yang sama
       - hitung data graph dari source
       - bandingkan data yang diberikan dengan hasil hitung
       - tulis figure ledger dengan row indices eksplisit
    -> verifyDocument:
       - hitung ulang dari doc sumber, bukan dari artefak build
       - tolak figure yang kehilangan baris, kolom, tabel, atau nilainya beda
    -> tulis .document.json hanya jika verified.ok
  <- { source, out, verified, document }
```

Gate berjalan sebelum file output ada. Itu bukan detail: paper dengan angka
yang tidak bisa dibenarkan harus gagal sebelum menjadi artefak.

## Skema graph

Setiap graph wajib berbentuk:

```json
{
  "kind": "bar",
  "title": "Revenue by item",
  "source": {
    "table": 0,
    "labelColumn": "Item",
    "valueColumn": "Amount",
    "aggregate": "sum"
  },
  "data": [
    { "label": "A", "value": 10 }
  ]
}
```

Aturan yang dijaga:

- `source.table` adalah integer non-negatif dan menunjuk tabel dalam section yang
  sama.
- `source.labelColumn` wajib ada dan harus cocok dengan header tabel.
- `source.aggregate` hanya menerima `count` atau `sum`.
- `count` tidak memerlukan `valueColumn`.
- `sum` wajib memiliki `valueColumn`, dan setiap sel di kolom itu harus menjadi
  angka finite.
- `data` wajib ada, tidak kosong, dan setiap point wajib punya label non-kosong
  serta value finite.
- Build menghitung nilai graph dari seluruh tabel sumber, dikelompokkan menurut
  `labelColumn`.
- Untuk `count`, value adalah jumlah baris per label.
- Untuk `sum`, value adalah jumlah nilai `valueColumn` per label.
- Data yang diberikan harus memiliki label dan value yang sama dengan hasil
  hitung. Urutan array tidak wajib sama; perbandingan dilakukan sebagai peta
  label ke value.
- Figure ledger menyimpan row indices eksplisit, bukan hanya jumlah baris:

```json
{
  "id": "graph:0:0",
  "section": 0,
  "table": 0,
  "labelColumn": "Item",
  "valueColumn": "Amount",
  "aggregate": "sum",
  "data": [{ "label": "A", "value": 10 }],
  "source": { "section": 0, "table": 0, "rows": [0] }
}
```

Input lama tanpa `source` tidak dinferensikan. Tool menolak dengan pesan yang
menyebut field yang kurang.

## Langkah

1. **Tulis test merah untuk kontrak graph.**
   - graph tanpa `source` ditolak.
   - graph `count` tanpa tabel ditolak.
   - graph `sum` dengan nilai salah ditolak.
   - graph dengan kolom tidak ada ditolak.
   - graph dengan value non-numerik ditolak.
   - graph benar diterima.
   - figure yang diubah setelah build tertangkap `verifyDocument`.

2. **Perbaiki `local/documents.js`.**
   - tambahkan validasi `source`.
   - hitung graph dari tabel sumber.
   - bandingkan data yang diberikan dengan hasil hitung.
   - tulis figure ledger dengan row indices eksplisit.
   - pertahankan output artifact sebagai JSON plan.

3. **Migrasikan fixture.**
   - `docs/paper-all-menus.json` diberi `source` eksplisit pada setiap graph.
   - `docs/paper-all-menus.document.json` tidak di-commit karena memuat path
     absolut machine-specific.

4. **Tambahkan test MCP.**
   - `tests/local-mcp-server.test.mjs` mendapat test `document_build`, sejajar
     dengan test `report_build`, tanpa browser hidup.

5. **Kunci regression focus_window.**
   - `focusWindow('')` tetap menjawab state tanpa memindahkan window.
   - tambah test untuk jalur no-match yang sudah diperbaiki.

6. **Sinkronkan dokumentasi.**
   - `local/README.md` menulis 39 tools, bukan 38.
   - `local/agent-guide.js` mendapat recipe `document_build`.

7. **Rapikan migration.**
   - hapus `supabase/migrations/20261023000000_docs_insert_table_v2.sql`.
   - simpan satu migration final
     `supabase/migrations/20261023000000_docs_insert_table_v3.sql`.
   - jangan apply ke Supabase.

8. **Bersihkan scratch.**
   - baca setiap `tmp_*` dan `tmp_testout.txt`.
   - hapus hanya script sekali pakai yang sudah dilaporkan fungsinya.

9. **Commit lokal terpisah.**
   - fix graph dan tests.
   - test focus_window.
   - docs sync.
   - migration final.
   - cleanup scratch.

## Batasan

- **Tidak ada inferensi sumber.** Sumber graph harus eksplisit; tool tidak
  menebak dari tabel.
- **Tidak ada graph tak terverifikasi yang lolos.** Graph tanpa sumber atau
  dengan nilai yang tidak sama dengan tabel ditolak.
- **Tidak ada output DOCX/PDF.** Output tetap `.document.json`.
- **Tidak ada apply migration.** Migration disiapkan untuk commit, bukan
  dijalankan ke database.
- **Tidak ada push/PR.** Commit lokal saja sampai persetujuan berikutnya.
- **Tidak ada penghapusan buta.** File scratch hanya dihapus setelah dibaca dan
  dinyatakan sekali pakai.

## Pengujian

Semua wajib hijau sebelum commit akhir:

- `node --test tests/document-job.test.mjs`
- `node --test tests/local-mcp-server.test.mjs`
- `node --test tests/window-focus.test.mjs`
- `npm test`
- `npm run check`
- `gitleaks detect --no-git --source . --redact`
- `py tests/browser_extension_test.py`

Test graph yang wajib ada:

- graph tanpa `source` ditolak.
- graph `count` tanpa tabel ditolak.
- graph `sum` dengan nilai salah ditolak.
- graph dengan kolom tidak ada ditolak.
- graph dengan value non-numerik ditolak.
- graph benar diterima.
- figure yang diubah setelah build tertangkap `verifyDocument`.
- MCP `document_build` menulis artifact terverifikasi untuk input valid dan
  menolak input invalid.

## Risiko

- **Fixture menjadi tidak valid.** `docs/paper-all-menus.json` harus dimigrasikan
  dalam commit yang sama dengan kontrak baru, jika tidak gate akan gagal.
- **Migration salah urutan.** Karena dua file eksperimental belum applied, tree
  harus menyimpan satu migration final saja supaya rebuild baru tidak mereplay
  versi yang dibuang.
- **Scratch dihapus terlalu dini.** File `tmp_*` bisa memuat probe yang masih
  berguna, jadi setiap file dibaca dan dilaporkan sebelum dihapus.
- **CI hijau menipu.** PR #107 hijau pada head remote lama; spec ini tidak
  mengklaim CI lokal sebelum 12 commit dan perubahan working tree dipush.
- **Deskripsi tool melampaui implementasi.** Klaim “graph yang bertentangan
  ditolak” harus benar untuk setiap aggregate yang didukung, bukan hanya count.
