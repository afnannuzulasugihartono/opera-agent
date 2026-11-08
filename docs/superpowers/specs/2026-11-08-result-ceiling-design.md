# Spesifikasi: Satu Plafon Hasil, Yaitu Bingkai

@last-edited: 2026-11-08 UTC+7.
@related: [AGENTS.md](../../../AGENTS.md) - [docs/api.md](../../api.md)

Disetujui sebagai arah pada 2026-11-08. Spec ini menghapus plafon hasil 512 KiB yang berdiri sendiri dan menjadikan anggaran bingkai sebagai satu-satunya plafon, dengan pemangkasan yang terbaca di bawahnya.

## Intent

Hari ini ada lima angka yang mengatur seberapa besar satu hasil perintah, dan yang paling ketat — 512 KiB di `extension/lib/serialize.js` — bukan angka transport: ia hanya konvensi yang kemudian diikuti angka-angka lain (`MAX_FRAME_BYTES >= MAX_RESULT_BYTES * 1.5`, `FRAME_MAX_BYTES >= ...`, `MAX_DECOMPRESSED_BYTES >= ... * 2`).

Akibatnya jawaban yang sah dipangkas bukan karena kabelnya penuh, melainkan karena konvensi: tarik satu kelas peta dengan `limit` 1000 (≈500 KB) dipotong ekornya, padahal bingkainya sanggup membawa jauh lebih banyak.

Tujuan spec ini: satu angka mengepalai seluruh jalur — **anggaran bingkai**. Hasil di bawahnya lewat utuh. Hasil di atasnya dipangkas dengan alasan yang terbaca, bukan gagal dengan `AWAIT_OUTCOME_UNKNOWN`.

Keputusan yang mengikat (hasil brainstorming 2026-11-08):

- **`MAX_RESULT_BYTES` 512 KiB dihapus.** Tidak ada lagi plafon hasil yang berdiri sendiri.
- **Bingkai menjadi plafonnya.** Anggaran hasil diturunkan dari anggaran bingkai, jadi mengubah satu angka menggerakkan seluruh rantai.
- **Pemangkasan tetap ada, tapi di-key ke anggaran bingkai.** Guard `read_page` dan pangkas ekor tarik kelas peta tidak dibuang; keduanya memakai angka yang sama dengan bingkai. Di atas anggaran, hasil dipangkas dengan `truncated: true` dan alasannya, bukan mati.
- **`boundedResult` tetap menolak**, karena jalur yang tidak punya bentuk pangkas (mis. `run_program`) harus gagal cepat dengan pesan yang bisa dibaca, bukan mengirim bingkai yang akan ditolak bridge.

## Angka

| Batas | Sekarang | Sesudah | Pemilik |
|---|---|---|---|
| Anggaran hasil | 512 KiB (`MAX_RESULT_BYTES`) | **3,75 MiB** = `FRAME_MAX_BYTES - 256 KiB` | `extension/lib/serialize.js` |
| Bingkai perangkat | 1 MiB (`FRAME_MAX_BYTES`) | **4 MiB** | `extension/lib/socket-protocol.js` |
| Bingkai bridge | 1 MiB (`MAX_FRAME_BYTES`) | **4 MiB** | `supabase/functions/opera-agent-bridge/bridge-socket.ts` |
| Setelah dekompresi | 8 MiB (`MAX_DECOMPRESSED_BYTES`) | **8 MiB** (tidak berubah; = 2x bingkai) | file yang sama |

Alasan angkanya, bukan selera:

- **4 MiB bingkai** cukup untuk semua yang permukaannya bisa hasilkan. Jawaban terbesar yang nyata adalah tarik satu kelas peta dengan `limit` maksimum: 1000 elemen x ±500 byte ≈ 500 KB. Teks `read_page` maksimum 12.000 karakter, kerangka peta belasan KB, screenshot dibatasi 220 KiB. Jadi 4 MiB memberi ruang delapan kali jawaban terbesar.
- **Bingkai dikompresi** di atas 2048 karakter (`socket-protocol.js`, `GZIP_THRESHOLD_BYTES`), dan JSON halaman menyusut 5-50 kali. Bingkai 4 MiB karena itu membawa hasil 3,75 MiB tanpa bergantung pada rasio kompresi: anggaran hasil sengaja di bawah ukuran bingkai, bukan di atasnya.
- **Dekompresi tetap 8 MiB** karena ia mengikuti aturan `>= 2 x bingkai`, dan angka itu sudah memenuhinya.
- **Anggaran hasil 3,75 MiB** menyisakan 256 KiB untuk amplop perintah, id, dan field di sekitar hasil, sehingga hasil yang pas di anggaran tidak ditolak bingkai karena amplopnya.

## Perubahan per berkas

- `extension/lib/socket-protocol.js`: `FRAME_MAX_BYTES` 1 MiB → 4 MiB. Tidak ada perubahan bentuk frame.
- `extension/lib/serialize.js`: `MAX_RESULT_BYTES` dihapus; `RESULT_BUDGET_BYTES = FRAME_MAX_BYTES - 256 * 1024` diekspor, diturunkan dari `FRAME_MAX_BYTES` yang diimpor. `oversized(value)` membandingkan ke `RESULT_BUDGET_BYTES`. `boundedResult(value)` melempar `Result exceeds ${RESULT_BUDGET_BYTES} bytes. Use bounded/chunked reads.` seperti sekarang, dengan angka baru.
- `supabase/functions/opera-agent-bridge/bridge-socket.ts`: `MAX_FRAME_BYTES` 1 MiB → 4 MiB. `MAX_DECOMPRESSED_BYTES` tidak berubah.
- `extension/background.js`: guard `page.read` memakai `RESULT_BUDGET_BYTES` apa adanya untuk pemangkasan `read_page` dan pangkas ekor tarik kelas peta — anggaran itu sudah menyisakan 256 KiB untuk amplop, jadi guard tidak memotong dua kali. Tidak ada lagi rujukan ke `MAX_RESULT_BYTES`.
- `extension/worker/capture-page.js`: anggaran irisan tile (`TILE_SLICE_BYTES`) menjadi `RESULT_BUDGET_BYTES - 256 * 1024`, menyisakan ruang untuk metadata tile (`index`, `sha256`, `y`, `width`, `height`, `bytes`) yang mengelilingi blok gambarnya.

## Kontrak dan pin

- Uji rantai di `tests/bridge-socket.test.mjs` dan `tests/device-socket-protocol.test.mjs` tetap ada dan tetap mengunci relasi, dengan nama konstanta baru: bingkai >= 1,5 x anggaran hasil, dekompresi >= 2 x anggaran hasil.
- `tests/hygiene.test.mjs` mem-pin sumber `oversized()`; bentuknya berubah nama konstanta, jadi pin ikut diperbarui satu kali dengan alasan.
- `tests/role-reconcile.test.mjs` mem-pin teks `Result exceeds ${...} bytes`; teksnya ikut berganti nama konstanta.
- `gates.lock` untuk `extension/lib/protocol.js` tidak berubah (tidak ada primitive baru). `tests/helpers/boundary-locks.mjs` dan `gates.lock` bergerak untuk `extension/lib/serialize.js` bila pin menyentuhnya, dan untuk `extension/background.js` serta `extension/worker/capture-page.js` yang memang berubah.

## Target keberhasilan yang dapat diukur

- Tarik satu kelas peta dengan `limit` 1000 pada artikel Wikipedia tidak lagi membawa `truncated` dan tidak kehilangan satu elemen pun.
- Sebuah hasil 3 MiB (dibuat di uji) lewat utuh: `boundedResult` menerimanya, `oversized` menjawab `false`, dan bingkainya masih di bawah `FRAME_MAX_BYTES`.
- Sebuah hasil 5 MiB ditolak `boundedResult` dengan pesan yang menyebut angka baru, bukan 524288.
- Uji rantai lama tetap hijau dengan angka baru.

## Risiko yang diterima

- **Memori per hasil naik empat kali.** Worker bisa menahan satu bingkai 4 MiB plus buffer dekompresi 8 MiB. Diterima: batas atas yang jarang tersentuh, dan semua jawaban nyata berada di bawah 1 MiB.
- **Jawaban tool bisa jauh lebih besar ke model.** Sebuah peta penuh kini bisa dikirim utuh, dan biaya tokennya ditanggung pemanggil. Diterima: itu pilihan sadar pemilik, dan paginasi tetap ada sebagai jalan hemat.
- **Bingkai yang ditolak bridge tetap mungkin.** Hasil di atas anggaran pada jalur tanpa bentuk pangkas gagal cepat dengan pesan `Result exceeds …`, bukan `AWAIT_OUTCOME_UNKNOWN`. Diterima: gagal cepat lebih jujur daripada menunggu.
- **Angka baru tersebar di dua runtime** (extension dan edge function). Diterima: uji rantai membandingkan keduanya, jadi pergeseran sepihak jadi merah.

## Di luar spec ini

- Kompresi selektif per jenis hasil (mis. screenshot selalu biner mentah).
- Streaming hasil bertahap di atas satu perintah.
- Menghapus `boundedResult` seluruhnya.
- Memindahkan hasil besar keluar dari jalur perintah (mis. ke storage objek).

## Uji

- `tests/serialize-budget.test.mjs`: `RESULT_BUDGET_BYTES` sama dengan `FRAME_MAX_BYTES - 256 KiB`; hasil 3 MiB diterima; hasil di atas anggaran ditolak dengan pesan yang menyebut anggaran itu.
- `tests/bridge-socket.test.mjs`, `tests/device-socket-protocol.test.mjs`: rantai angka tetap terkunci.
- `tests/browser_extension_test.py`: tarik satu kelas peta dan `read_page` pada halaman uji tidak memangkas apa pun.
- Uji perangkat nyata: tarik `class: "link"` `limit: 1000` di artikel Wikipedia, bandingkan jumlah elemen dengan kerangka.