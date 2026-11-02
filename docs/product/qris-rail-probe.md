@last-edited: 2026-11-02 UTC+7.
@related: [billing](billing.md) - [first three bookkeepers](first-three-bookkeepers.md) - [pilot runbook](pilot-runbook.md)

# Probe rel QRIS (operator, tanpa kode)

Tujuan file ini: putuskan **satu** rel QRIS otomatis sebelum ada spesifikasi dan sebelum ada kode.
Semua langkah manual, di browser atau aplikasi. Tidak ada yang ditulis ke repo sampai L1 lolos.

Yang dibuktikan, tiga hal terpisah:

| Level | Yang dibuktikan | Kalau gagal |
|---|---|---|
| **L0** | Akun GoPay Merchant bisa dibaca dari server: login portal, daftar merchant, QRIS statis, riwayat transaksi | tidak ada rel server-side; pilihan tinggal agregator pihak ketiga atau HP menyala 24 jam |
| **L1** | QRIS statis yang diubah jadi dinamis (tag 01 jadi `12`, tag 54 berisi nominal, CRC16 tag 63 dihitung ulang) **diterima acquirer**, dan uang masuk ke saldo GoPay dengan nominal yang terkunci | tidak ada QRIS buatan sendiri; rel resmi (GoBiz Payment API) atau agregator |
| **L2** | Settlement terlihat di feed transaksi portal, untuk app pembayaran yang benar-benar dipakai pelanggan | deteksi otomatis tidak bisa; kanal lain atau konfirmasi manual |

L0 dan L1 boleh gagal terpisah. Rel yang menang harus lolos ketiganya.

## Batas yang tidak boleh dilanggar

- Dana **tidak pernah** menyentuh sistem kita. Pembayar → QRIS → saldo GoPay Merchant → rekening bank.
  Jadi ini bukan payment gateway dan bukan PJP: tidak ada penatausahaan sumber dana, tidak ada
  inisiasi pembayaran atas nama orang lain, tidak ada remitansi.
- Rahasia tidak masuk chat, tidak masuk git. Kredensial hanya di file `.env` lokal dan
  `[UNVERIFIED]` berarti belum diuji, bukan berarti pasti.
- Akses resmi ke GoBiz hanya lewat jalur aktivasi atau tim MAM (syarat §5 Developer Portal).
  Semua yang di bawah memakai dashboard merchant, bukan API resmi, jadi **risiko banned ada**.
  Siklus polling harus pendek dan hanya jalan saat ada invoice terbuka.
-_[UNVERIFIED]_: tidak ada aturan BI yang ditemukan secara eksplisit mengizinkan atau melarang
  pihak ketiga mengubah QRIS statis jadi dinamis. Yang pasti: identitas merchant (NMID, tag 26-51)
  tidak berubah, jadi dana tetap ke merchant yang sama.

## Langkah 0 — portal merchant (L0)

1. Buka `https://portal.gofoodmerchant.co.id/auth/login`, masuk dengan nomor HP akun GoPay Merchant
   lalu OTP. Kalau ada email, pakai `https://portal.gofoodmerchant.co.id/auth/login/email`.
2. Catat: **berhasil atau tidak**. Akun UMI perorangan belum pernah dipastikan bisa masuk ke portal ini.
   [UNVERIFIED]
3. Kalau masuk, catat empat hal, jangan screenshot ke chat:
   - Merchant ID / NMID (format `G...` atau `UMI...`)
   - QRIS statis: string QR-nya. Halaman QRIS biasanya menyediakan unduh; string-nya juga bisa
     diambil dari menu QRIS. Kalau tidak ada string di portal, ambil dari aplikasi GoPay Merchant
     (Bagikan / Salin QR). **NMID saja tidak cukup**: mengubah statis jadi dinamis butuh payload
     lengkap, karena tag acquirer (26-51), MCC, nama, dan kota ikut menentukan tag 54 dan CRC.
     Kalau hanya NMID yang didapat, tulis itu di laporan: payload bisa dirakit ulang, tapi
     strukturnya harus persis sama dengan yang diterbitkan acquirer, dan itu yang harus diuji.
   - Outlet / cabang yang terdaftar
   - URL halaman riwayat transaksi (Keuangan → Aktivitas terakhir)
4. Buka riwayat transaksi dan lihat apakah **transaksi QRIS** terlihat di sana, lengkap dengan
   nominal dan waktu. Ini yang akan dibaca poller.
5. Tidak perlu ganti password dulu. Jangan sentuh pengaturan akun apa pun yang tidak diminta.

** Laporkan L0:** `login: ya/tidak`, `NMID: <tersimpan di .env, tidak di chat>`, `qr_static: ada/tidak`,
`riwayat_qris: ya/tidak`, `outlet: <jumlah>`.

## Langkah 1 — Rp 1.000 lewat QRIS dinamis buatan sendiri (L1)

Ini uji paling menentukan. Kalau acquirer menolak nominal pada QR yang terdaftar statis, seluruh
rencana QRIS buatan sendiri mati, dan ini diketahui sebelum kode apa pun ditulis.

1. Ambil string QRIS statis dari Langkah 0.
2. Ubah jadi dinamis dengan tool apa pun yang bisa dijalankan lokal (repo `verssache/qris-dinamis`,
   atau `npm:` paket QRIS statis-ke-dinamis). String QRIS statis bukan rahasia publik, jadi
   konverter daring pun boleh untuk uji ini; jangan pernah masukkan kredensial ke sana.
   Yang wajib: tag 01 `11` → `12`, tag 54 berisi `1000` (bukan `1000.00`), CRC16-CCITT-FALSE
   dihitung ulang di tag 63.
3. Render QR-nya, pindai dari **aplikasi pembayaran yang berbeda dari GoPay** (misalnya DANA
   atau aplikasi bank), lalu bayar **tepat Rp 1.000**.
4. Yang harus terjadi: aplikasi menampilkan nominal terkunci Rp 1.000 (tidak ada kolom nominal
   yang bisa diedit), pembayaran berhasil, saldo GoPay Merchant naik Rp 1.000.
5. Kalau aplikasi menampilkan "bayar sejumlah", berarti tag 01 belum jadi `12`.
   Kalau pembayaran ditolak, catat **pesan errornya persis** — itu data acquisitions.

** Laporkan L1:** `render_qr: ya/tidak`, `nominal_kunci: ya/tidak`, `bayar: berhasil/gagal`,
`pesan_gagal: <persis>`, `saldo_naik: ya/tidak`, `selisih_saldo: <angka>`.

## Langkah 2 — settlement terlihat dari feed (L2)

Bayar tiga kali, dari tiga app berbeda, masing-masing Rp 1.001 (nominal berbeda biar jelas):

| App bayar | Nominal | Terlihat di riwayat portal? |
|---|---|---|
| GoPay | Rp 1.001 | ya / tidak |
| Aplikasi bank (BCA / Mandiri / BRI) | Rp 1.002 | ya / tidak |
| DANA atau OVO | Rp 1.003 | ya / tidak |

Buka riwayat transaksi portal dan cek tiap nominal. Yang dibutuhkan: **nominal dan waktu** per
transaksi. Kalau transaksi dari app bank tidak muncul, kanal server-side hanya menutup GoPay dan
itu harus tertulis di keputusan rel, bukan dikarang.

** Laporkan L2:** satu baris per app: `app, nominal, terlihat: ya/tidak, waktu_tersedia: ya/tidak`.

## Langkah 3 — jalur lain, paralel (tidak bergantung L0)

Cek tiga hal, supaya tidak hanya satu jalan:

1. **Rel resmi.** `https://developer.gobiz.com/` → hubungi tim untuk integrasi Payment.
   Akses Developer Portal disebut invite-only dan lingkupnya GoFood, jadi formulir ini hanya
   permintaan, bukan jaminan. Isi formulir, jangan menunggu jawabannya.
2. **WebQRIS.** Daftar di `https://webqris.com`, pakai kanal **GoBiz Detector** (bukan APK): dia
   yang polling portal GoBiz, bukan HP kita. Catat batas kuota harian gratis dan apakah
   unique code ditambahkan ke nominal.
3. **APIQris.** Gratis per transaksi, tapi pendeteksinya lewat aplikasi di HP, jadi tetap butuh
   HP menyala. Catat saja sebagai pembanding biaya, bukan pilihan utama.

## Bentuk laporan

Tempel hasil di respons, satu blok per level, tanpa nilai rahasia:

```
L0: login=<ya/tidak> qr_static=<ada/tidak> riwayat_qris=<ya/tidak> outlet=<n>
L1: nominal_kunci=<ya/tidak> bayar=<berhasil/gagal> pesan=<teks> saldo_naik=<ya/tidak>
L2: goPay=<ya/tidak> bank=<ya/tidak> dana=<ya/tidak>
L3: gobiz_official=<form terkirim> webqris=<terdaftar/terbatas> apqris=<terdaftar>
```

## Keputusan setelah probe

| Hasil probe | Rel yang dipilih |
|---|---|
| L0 ya, L1 ya, L2 ya (semua app) | QRIS sendiri: payload dinamis buatan kita, feed portal dibaca server, tanpa HP |
| L0 ya, L1 ya, L2 hanya GoPay | QRIS sendiri, dengan catatan cakupan; HMAC dari webhook resmi sebagai jaring pengaman |
| L0 ya, L1 tidak | WebQRIS GoBiz Detector (polling portal, tanpa HP) |
| L0 tidak | WebQRIS atau APIQris, dan detector HP disiapkan sebagai cadangan |
| L0 ya, L1 ya, L2 ya, dan Developer Portal memberi akses | GoBiz Payment API resmi: `gross_amount` tepat, tanpa kode unik, webhook HMAC |

## Konsekuensi yang sudah terlihat sekarang

- Kalau rel memakai **kode unik** (agregator, atau QRIS sendiri dengan mencocokkan feed),
  nominal yang dibayar ≠ utang invoice. `amount_cents` (utang) dan `payable_cents` (yang benar-benar
  dibayar) jadi dua angka, dan kode unik bukan pendapatan. Halaman invoice harus menyebut nominal
  yang harus dibayar persis.
- Kalau rel memakai **`gross_amount` tepat** (GoBiz Payment API resmi), satu angka saja, dan
  `settle-manual` tidak perlu dilonggarkan.
- Halaman invoice sekarang melarang `<img>` dan `<script>`. QR tidak bisa berupa gambar terpisah
  kalau halaman tetap tanpa aset; opsi yang tersisa QR inline (SVG atau data URI) atau halaman
  pembayaran terpisah milik provider.
- Official rail punya `Idempotency-Key` maksimal 32 karakter, sedangkan `providerOrderId` sekarang
  boleh 50. Rel manapun yang butuh kunci idempoten harus punya format sendiri.
