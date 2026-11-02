@last-edited: 2026-11-02 UTC+7.
@related: [billing](billing.md) - [first three bookkeepers](first-three-bookkeepers.md) - [pilot runbook](pilot-runbook.md)

# Probe rel QRIS (operator, tanpa kode)

Tujuan file ini: putuskan **satu** rel QRIS otomatis sebelum ada spesifikasi dan sebelum ada kode.
Semua langkah manual, di browser atau aplikasi. Tidak ada yang ditulis ke repo sampai L1 lolos.

Yang dibuktikan, tiga hal terpisah:

| Level | Yang dibuktikan | Kalau gagal |
|---|---|---|
| **L0** | Akun GoPay Merchant bisa dibaca dari server: login API, daftar merchant, QRIS statis, feed transaksi | tidak ada rel server-side; pilihan tinggal agregator pihak ketiga atau HP menyala 24 jam |
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
  Semua yang di bawah memakai API merchant yang sama dengan aplikasi HP, bukan API resmi, jadi
  **risiko banned ada**. Siklus polling harus pendek dan hanya jalan saat ada invoice terbuka.
-_[UNVERIFIED]_: tidak ada aturan BI yang ditemukan secara eksplisit mengizinkan atau melarang
  pihak ketiga mengubah QRIS statis jadi dinamis. Yang pasti: identitas merchant (NMID, tag 26-51)
  tidak berubah, jadi dana tetap ke merchant yang sama.

## Detector ada tiga, dan HP cuma salah satu

"HP harus nyala 24 jam" bukan syarat teknis. Yang dibutuhkan: **satu sumber yang tahu pembayaran
sudah masuk**. Tiga kanal yang tersedia:

| Kanal | Cara tahu pembayaran masuk | HP nyala? | Biaya |
|---|---|---|---|
| **Polling API merchant (server)** | Akun GoBiz/GoPay Merchant dibaca dari server, feed transaksi dicek | tidak | Rp 0 kalau kita bangun sendiri |
| **APK notifikasi (HP)** | Aplikasi di HP membaca notifikasi GoPay Merchant, meneruskannya ke server | **ya** | Rp 0 (APIQris) atau paket |
| **API resmi** | Provider mengirim webhook | tidak | Tergantung provider |

Jadi "upload foto QRIS lalu pasang aplikasi detektor di HP" itu **satu** pola, cara paling mudah
bagi pemakai awam, bukan satu-satunya. Yang tidak bisa dihindari: **dana harus sampai ke akun
merchant**, jadi minimal satu kanal baca mutasi wajib ada.

Polling API adalah kanal tanpa HP: pola yang sama dipakai WebQRIS (kanal "GoBiz Detector"),
EQRIS (`/api/gomerch-mutasi`), TemanQRIS (Gateway Otomatis), dan RavaPay. Yang polling API
bisa lakukan: baca mutasi, cocokkan nominal, webhook ke server kita.

## Yang bisa kita bangun sendiri, dan apa yang tidak

| Yang | Bisa? | Kenapa |
|---|---|---|
| Mengubah QRIS statis jadi dinamis (nominal terkunci) | **ya** | aritmetika EMVCo saja: tag 01 `11`→`12`, tag 54, CRC16 tag 63. Tidak ada panggilan jaringan, tidak ada API, tidak ada biaya |
| Membaca mutasi dari API merchant | **ya**, kalau L0 lolos | endpoint yang dipakai aplikasi HP dan dashboard GoFood, bukan API resmi. Risiko ban ada, dan bisa rusak tanpa pemberitahuan |
| Mencocokkan mutasi ke invoice dan mengirim webhook ke sistem kita | **ya** | pekerjaan lokal kita |
| Meneruskan uang, memegang saldo, menginisiasi pembayaran atas nama orang lain | **tidak** | itu aktivitas PJP dan butuh lisensi BI (UU PJP 1/2023, PBI 23/6/2021 Pasal 11-14, PBI 10/2025, PADG 32/2025) |

Batasnya jelas: **dana tidak pernah menyentuh sistem kita**. Pembayar → QRIS → saldo GoPay
Merchant → rekening bank. Yang kita bangun adalah lapisan notifikasi dan rekonsiliasi, bukan
payment gateway. Konsekuensinya, "membangun payment gateway sendiri" dalam arti PJP: tidak
bisa. "Membangun konektor pembayaran sendiri di atas QRIS milik dagang sendiri": bisa, dan itu
persis yang kita mau.

## "Rekening" tanpa input manual berarti virtual account

Opsi kedua yang Anda sebut: bayar lewat rekening bank tanpa mengetik nominal. Yang memenuhi itu
hanya **virtual account (VA) per invoice**: satu nomor rekening khusus per tagihan, jadi nominal
sudah terkunci di sistem bank. Nomor VA tidak bisa kita buat sendiri — penerbitnya bank atau PJP,
dan tiap penerbit punya API sendiri dengan proses review.

| Jalur VA | Biaya | Kenapa belum jadi pilihan |
|---|---|---|
| Midtrans VA | Rp 4.000 per invoice | sudah terhubung dan otomatis, tapi Rp 4.000 = 4% dari invoice Rp 99.000 |
| Bank (BNI, Mandiri, BRI) | sesuai tariff bank | API perorangan/UMI butuh review dan berbulan-bulan, tidak cocok untuk pilot |
| QRIS (yang kita bangun) | Rp 0 | nominal terkunci di QR, payer tidak perlu teller atau input nominal |

Jadi "tanpa input manual" untuk domestic QRIS dijawab QRIS dinamis, bukan VA. VA tetap berguna
kalau ada klien yang butuh transfer rekening manual.

## Langkah 0 — login merchant dari server (L0)

Temuan 2026-11-02: akun GoPay Merchant **tidak punya dashboard web sendiri**. Host
`merchant.gopay.co.id`, `portal.gopay.co.id`, `dashboard.gopay.co.id`, dan `portal.gopaymerchant.co.id`
semuanya tidak ada; yang ada cuma halaman pemesanan di `gopay.co.id/merchant`. Tapi dashboard
GoFood (`portal.gofoodmerchant.co.id`) memakai API yang sama dengan aplikasi HP, jadi **browser
tidak diperlukan**: satu SMS OTP sudah cukup, lalu servernya yang membaca mutasi.

Rute yang sudah dicek langsung ke server pada 2026-11-02 (tanpa kredensial apa pun):

| Panggilan | Jawaban server | Arti |
|---|---|---|
| `POST https://api.gobiz.co.id/goid/login/request` | 400 `goid:error:missing_field` | rute ada, minta nomor HP |
| `POST https://api.gobiz.co.id/goid/token` | 400 `goid:error:missing_field` | rute ada, minta OTP |
| `GET https://api.gobiz.co.id/v1/users/me` | 401 `missing auth header` | rute ada, butuh token |
| `POST https://api.gobiz.co.id/v1/merchants/search` | 401 `missing auth header` | rute ada, butuh token |
| `GET https://api.gojekapi.com/merchant-analytics/v2/merchants/transactions` | 401 `missing auth header` | feed transaksi, butuh token |
| `POST https://api.gobiz.co.id/journals/search` | 401 `missing auth header` | jurnal detail, butuh token |
| `GET https://portal.gofoodmerchant.co.id/goid/login/request` | 404 | di host portal tidak ada; pakai `api.gobiz.co.id` |

Langkah:

1. Simpan nomor HP merchant (format apa pun) di `%TEMP%\opera-gobiz\phone.txt`. Jangan tempel ke
   chat, jangan simpan di repo.
2. Jalankan `node scripts/gobiz-probe.mjs login`. Program meminta OTP lewat SMS, lalu menunggu
   file `%TEMP%\opera-gobiz\otp.txt` berisi 4 angka. Tulis 4 angka itu ke file itu; program
   menghapus file itu sendiri setelah membaca.
3. Jalankan `node scripts/gobiz-probe.mjs feed`. Program mencetak profil merchant dan transaksi
   7 hari terakhir: id, waktu, `gross_amount` (minor unit), status, `payment_type`,
   `channel_type`, `order_id`, dan issuer QRIS.
4. Yang harus terlihat: `merchant_id`, daftar merchant, dan — kalau ada transaksi — baris dengan
   `payment_type` QRIS dan `gross_amount` terisi. Kalau `feed` membalas 401, ulangi `login`.
5. QRIS statis: ambil dari aplikasi GoPay Merchant (menu QRIS → Bagikan/Salin). Payload-nya bukan
   rahasia publik, tapi tetap jangan masuk repo. Payload itu yang dipakai di L1.

** Laporkan L0:** `login=<ya/tidak>`, `merchant_id=<ada/tidak, nilainya tidak masuk chat>`,
`outlet=<n>`, `qr_static=<ada/tidak>`, `feed_qris=<ya/tidak>`.

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
   Kalau pembayaran ditolak, catat **pesan errornya persis** — itu data akuisisi yang paling berharga.

** Laporkan L1:** `render_qr: ya/tidak`, `nominal_kunci: ya/tidak`, `bayar: berhasil/gagal`,
`pesan_gagal: <persis>`, `saldo_naik: ya/tidak`, `selisih_saldo: <angka>`.

## Langkah 2 — settlement terlihat dari feed (L2)

Bayar tiga kali, dari tiga app berbeda, masing-masing Rp 1.001 (nominal berbeda biar jelas):

| App bayar | Nominal | Terlihat di feed server? |
|---|---|---|
| GoPay | Rp 1.001 | ya / tidak |
| Aplikasi bank (BCA / Mandiri / BRI) | Rp 1.002 | ya / tidak |
| DANA atau OVO | Rp 1.003 | ya / tidak |

Jalankan `node scripts/gobiz-probe.mjs feed` setelah tiap pembayaran, lalu cari nominalnya di
keluaran. Yang dibutuhkan: **nominal dan waktu** per transaksi. Kalau transaksi dari app bank
tidak muncul, kanal server-side hanya menutup GoPay dan itu harus tertulis di keputusan rel,
bukan dikarang.

** Laporkan L2:** satu baris per app: `app, nominal, terlihat: ya/tidak, waktu_tersedia: ya/tidak`.

## Langkah 3 — jalur lain, paralel (tidak bergantung L0)

Cek empat hal, supaya tidak hanya satu jalan. Harga di bawah dari halaman vendor; **[UNVERIFIED]**
karena belum dibeli dan belum diuji.

| Vendor | Bentuk | Harga | HP? | Catatan |
|---|---|---|---|---|
| **GoBiz Payment API resmi** | webhook HMAC, `gross_amount` tepat | gratis | tidak | Akses invite-only, lingkup GoFood. Formulir, bukan jaminan |
| **WebQRIS** | polling portal (GoBiz Detector), webhook | gratis dengan kuota harian | tidak | Kanal APK-nya butuh HP; kanal GoBiz Detector tidak |
| **APIQris** | polling via aplikasi pendamping di HP | Rp 0 per transaksi | **ya** | Biaya per transaksi nol, tapi detector-nya ada di HP |
| **EQRIS** | polling mutasi + QRIS dinamis, token REST | Rp 25.000/30 hari (5 req/mnt) atau Rp 35.000/30 hari tanpa batas | tidak | Butuh login GoPay Merchant (merchantId + nomor HP), jadi cocok kalau L0 lolos |
| **TemanQRIS** | Gateway Otomatis, polling GoPay, webhook | paket Rp 0 (50 req/hari) atau Rp 9.000/bln; **gateway 0,8%** | tidak | Biaya 0,8% lebih mahal dari Midtrans 0,7%, jadi bukan alasan pindah |
| **RavaPay** | polling GoPay, webhook, dana langsung ke GoPay Merchant | langganan Rp 1.000/hari atau Rp 30.000/bln | tidak | Tanpa biaya per transaksi; **[UNVERIFIED]** |

Langkah yang harus dijalankan, bukan cuma dibaca:

1. **Rel resmi.** `https://developer.gobiz.com/` → hubungi tim untuk integrasi Payment.
   Akses Developer Portal disebut invite-only dan lingkupnya GoFood, jadi formulir ini hanya
   permintaan, bukan jaminan. Isi formulir, jangan menunggu jawabannya.
2. **WebQRIS.** Daftar di `https://webqris.com`, pakai kanal **GoBiz Detector** (bukan APK): dia
   yang polling portal GoBiz, bukan HP kita. Catat batas kuota harian gratis dan apakah
   unique code ditambahkan ke nominal.
3. **APIQris.** Gratis per transaksi, tapi pendeteksinya lewat aplikasi di HP, jadi tetap butuh
   HP menyala. Catat saja sebagai pembanding biaya, bukan pilihan utama.
4. **EQRIS.** Pakai kalau L0 lolos: daftar token, isi merchantId + nomor HP merchant, login sekali.
   Catat: apakah mutasi dari app bank dan DANA terlihat, bukan hanya dari GoPay.

## Bentuk laporan

Tempel hasil di respons, satu blok per level, tanpa nilai rahasia:

```
L0: login=<ya/tidak> merchant_id=<ada/tidak> qr_static=<ada/tidak> feed_qris=<ya/tidak> outlet=<n>
L1: nominal_kunci=<ya/tidak> bayar=<berhasil/gagal> pesan=<teks> saldo_naik=<ya/tidak>
L2: goPay=<ya/tidak> bank=<ya/tidak> dana=<ya/tidak>
L3: gobiz_official=<form terkirim> webqris=<terdaftar/terbatas> apqris=<terdaftar> eqris=<terdaftar>
```

## Keputusan setelah probe

| Hasil probe | Rel yang dipilih |
|---|---|
| L0 ya, L1 ya, L2 ya (semua app) | QRIS sendiri: payload dinamis buatan kita, feed portal dibaca server, tanpa HP |
| L0 ya, L1 ya, L2 hanya GoPay | QRIS sendiri, dengan catatan cakupan; HMAC dari webhook resmi sebagai jaring pengaman |
| L0 ya, L1 tidak | WebQRIS GoBiz Detector atau EQRIS (polling portal, tanpa HP) |
| L0 tidak | EQRIS, WebQRIS, atau APIQris, dan detector HP disiapkan sebagai cadangan |
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
