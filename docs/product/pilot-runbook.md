@last-edited: 2026-10-21 UTC+7.
@related: [first three bookkeepers](first-three-bookkeepers.md) - [statements job](../jobs/statements.md)

# Runbook sesi pilot (operator)

Satu sesi, satu klien, satu bulan. Waktu realistis: 30 menit (10 menit siap, 15 menit
drive, 5 menit penutup). Jangan gabung tiga klien dalam satu panggilan — angka
waktunya jadi tidak bisa dibandingkan.

## Sebelum sesi (operator, di komputer sendiri)

- Model key aktif, opencode terpasang, branch `statement-job` atau lebih baru di-pull.
- Chrome debug di mesin klien sudah terbuka? Belum tahu — siapkan dua rencana:
  rencana A (remote desktop, disarankan) dan rencana B (tunnel, belum terbukti).
- Buka `docs/product/first-three-bookkeepers.md` bagian 6 dan 7 — lembar tawaran
  dan tiga pertanyaan penyaring.
- Siapkan folder kosong untuk hasil: `C:\opera-pilot\{nama-klien}\` di mesin klien.

## Di mesin klien (remote desktop, operator yang mengetik)

1. Tutup Chrome yang sedang berjalan. Tanya dulu apakah ada tab yang belum disimpan.
2. Buka Chrome dengan profil yang biasa dipakai, plus debug port:

   chrome.exe --remote-debugging-port=9333 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data"

   Catatan: ini membuka CDP di localhost. Aman selama sesi berlangsung dan ditutup
   setelahnya. Jangan biarkan port ini terbuka semalaman.
3. Minta pemilik akun login ke portal bank sendiri. Operator tidak mengetik password,
   tidak menjawab OTP, tidak melihat layar saat login. Setelah login, operator kembali.
4. Verifikasi koneksi:

   node -e "fetch('http://127.0.0.1:9333/json/version').then(r=>r.json()).then(x=>console.log(x.Browser))"

   Harusnya mencetak versi Chrome. Kalau gagal, port atau profil salah.
5. Pasang opencode bila belum ada (Node 20+), lalu jalankan:

   npx opera-local

   dengan `OPERA_LOCAL_PORT=9333` (default). MCP client (opencode/Claude Desktop)
   diarahkan ke server ini.

## Sesi (operator drive, klien menonton)

1. `statement_card` — client, portal, period (YYYY-MM), url bila diberikan, root folder.
   Baca `steps`, `proof`, `refuse` keras-keras ke klien: ini aturan mainnya.
2. `open_url` portal. Kalau halaman minta login: berhenti, klien login, lanjut
   `read_page` yang sama.
3. `read_page` — cocokkan akun dan bulan di layar dengan kartu. Kalau tidak cocok,
   jangan lanjut; catat dan ganti bulan.
4. `find_elements` untuk tombol unduh dengan kata yang portal pakai.
5. `download` dengan `dir` dan `saveAs` dari kartu. Bertindak hanya pada
   `downloaded:true`. Kalau `downloaded:false`, baca `why` dan catat sebabnya.
6. Baca saldo akhir dari halaman, lalu `statement_delivered` dengan path dan saldo.
7. Baca balik: `duplicate:true` kalau diulang, `duplicate:false` pertama kali.
8. `manifest.json` dibuka untuk klien: satu baris, ukuran file, halaman, saldo,
   sumber saldo ("halaman portal").

## Setelah sesi

1. Tutup Chrome debug. Pastikan port 9333 tidak lagi menjawab.
2. Kirim ke klien: file PDF + `manifest.json` (atau cuplikan barisnya).
3. Catat di papan pelacakan (`first-three-bookkeepers.md` bagian 9): nama, kanal,
   klien/portal, hasil, sebab kalau gagal.
4. Catat angka: waktu per klien, jumlah panggilan, karakter, ms download. Ini
   menjadi angka perbandingan sesudah sesi.

## Kalau gagal

- Halaman login tidak terdeteksi tapi tidak ada tombol unduh: kemungkinan portal
  memakai iframe atau menu. Coba `find_elements` dengan kata lain; kalau tetap
  kosong, catat "kontrol unduh tidak ditemukan" dan hentikan.
- `download` menjawab `downloaded:false` dengan `navigated`: portal membuka viewer,
  bukan file. Catat, jangan klaim berhasil.
- `statement_delivered` menolak file: baca pesan (`.crdownload`, 0 byte, path salah).
  Perbaiki, jangan bypass.
- Saldo tidak terbaca dari halaman: catat `balance: null`, jangan mengarang angka.
  Manifest tetap jujur.

## Yang tidak dilakukan di sesi ini

- Tidak memindahkan statement job ke cloud surface. Pilot ini jalan di mesin klien.
  Kalau nanti mau tanpa remote desktop, itu pekerjaan terpisah dan belum diuji.
- Tidak menambah tool baru. Kalau sesi menunjukkan kebutuhan baru, catat dulu;
  jangan tambah di tengah sesi.
- Tidak mengubah harga. Pilot gratis; angka ditetapkan sebelum bulan kedua.

## Ukuran keberhasilan

Sesi dianggap berhasil kalau: file ada di disk dengan nama yang benar, manifest punya
satu baris lengkap, dan klien mengatakan "ini yang saya butuh" tanpa ditanya dua kali.
Sesi dianggap gagal kalau salah satu dari tiga itu tidak terpenuhi — dan itu dicatat,
bukan disembunyikan.