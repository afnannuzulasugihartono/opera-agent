@last-edited: 2026-11-02 UTC+7.
@related: [`../../../AGENTS.md`](../../../AGENTS.md) - [`../../handoff.md`](../../handoff.md) - [`../../product/billing.md`](../../product/billing.md) - [`../../product/qris-rail-probe.md`](../../product/qris-rail-probe.md) - [`2026-10-27-site-agnostic-drive-design.md`](2026-10-27-site-agnostic-drive-design.md)

# Spec: Rel pembayaran QRIS — nominal terkunci, lunas sendiri, tanpa HP menyala

Disetujui sebagai arah pada 2026-11-02. Spec ini belum membangun apa pun; ia
memutuskan bentuk, batas, dan urutan langkah sebelum kode disentuh. Lingkupnya
adalah **satu rel pembayaran baru** (QRIS) yang menyatu dengan rel Midtrans yang
sudah ada. Kartu, dolar, dan pelanggan asing tidak tersentuh.

## Intent

Invoice Indonesia dibayar dengan QRIS yang dibuat dari QRIS statis merchant
GoPay Merchant milik sendiri:

- **Nominal terkunci.** Payer memindai QR, nominal invoice muncul di aplikasi
  pembayar, dan payer tidak pernah mengetik nominal.
- **Setiap invoice lunas sendiri.** Detector di server membaca feed merchant,
  mencocokkan uang masuk ke invoice, dan menutup invoice tanpa operator.
- **Tidak ada HP nyala 24 jam.** Server yang mengelola; HP hanya diperlukan
  satu kali saat login token kedaluwarsa.
- **Tanpa biaya per transaksi.** Tidak ada PJP, tidak ada fee aggregator.
- **Midtrans tetap** untuk kartu, dolar, dan pelanggan asing.

Target pemakaian: tiga firma pertama, invoice Rp 99.000 dan Rp 249.000.

## Non-goals

- **Kartu, USD, pelanggan asing** → tetap Midtrans SNAP. Spec ini tidak
  menyentuhnya.
- **Menjadi PJP atau escrow.** Dana tidak pernah menyentuh sistem kita; QRIS
  diteruskan langsung ke merchant yang tercatat di QR.
- **Multi-merchant atau multi-acquirer.** Satu merchant, satu static payload,
  satu feed.
- **Kode unik per invoice.** Keputusan pengguna: nominal persis + FIFO.
- **Aplikasi HP notifier.** Hanya jalur server yang dibangun.
- **Menulis ulang Midtrans sebagai kelas adapter.** Lihat "Antarmuka rail".

## Fakta terverifikasi

Diukur pada 2026-11-02. Sumber lengkap di
[`../../product/qris-rail-probe.md`](../../product/qris-rail-probe.md).

### Payload QRIS

| Fakta | Bukti |
|---|---|
| QR statis merchant terbaca | payload `00020101021126610014COM.GO-JEK.WWW…62070703A01…6304F47E` dari screenshot QR GoPay Merchant |
| CRC16 payload statis cocok dengan hitungan CCITT-FALSE | `F47E` dihitung ulang dari isi payload → sama |
| Mengubah tag 01 saja tidak cukup | ShopeePay menjawab "QR code tidak sah" untuk payload dengan tag 01 `12` tetapi tag 62/07 masih `A01` |
| Tag 62/07 adalah kategori QRIS | `A01` statis, `A02` dinamis; dengan `A02` payload diterima |
| Payload dinamis diterima aplikasi pembayaran | ShopeePay menampilkan nominal Rp 1.000 terkunci, tanpa kolom nominal yang bisa diedit |
| Bentuk payload dinamis yang terbukti diterima | tag 01 `12`, tag 54 `1000` (bulat rupiah), tag 62/07 `A02`, CRC16 dihitung ulang; urutan tag 54 sebelum tag 58 |

### Jalur server GoBiz (L0)

| Fakta | Bukti |
|---|---|
| Login server tanpa browser berhasil | `login` → OTP SMS → tukar token → session tersimpan; `feed` membaca profil merchant dan transaksi dari proses Node biasa |
| `x-uniqueid` harus satu per sesi | UUID baru tiap panggilan ditolak `401 "Harap perbarui versi aplikasi"`; server mengikat OTP ke id itu, bukan ke versi aplikasi |
| Bentuk query feed | `merchant_id`, `from` (offset, wajib), `size`, `start_time` + `end_time` RFC3339; `days` saja → 400 `start_time_required`; epoch → 400; tanpa `from` → 422 |
| Feed merchant | user id 199296253, role `verified_admin`, merchant `G274351871`; transaksi: kosong |
| Akun belum pernah menerima pembayaran QRIS | feed 7 hari dan 30 hari: 0 transaksi |

### Belum terverifikasi (pintu untuk mode live)

| Yang belum diketahui | Kenapa penting |
|---|---|
| **Satuan nominal di feed** (rupiah atau subunit/"minor") | Cocokkan invoice bergantung pada ini; salah satuan = invoice salah lunas |
| **Apakah pembayaran QRIS buatan sendiri muncul di feed** | Kalau tidak muncul, detector buta dan rail ini mati |
| **Apakah acquirer menerima QR dinamis hasil konversi sendiri** | Bukti baru ada di sisi payer; sisi acquirer baru terbukti saat dana masuk |
| **Grant `refresh_token` hidup** | Token akses kedaluwarsa; tanpa refresh, detector berhenti |
| **Umur token akses dan refresh** | Menentukan kapan operator perlu login ulang |

Sampai lima hal ini terbukti, detector berjalan dalam **mode dry**: membaca
feed, mencatat apa yang akan dilakukan, **tidak pernah menutup invoice**.

## Arsitektur

```
pelanggan ── buka invoice ──▶ halaman invoice (QR inline SVG)
                                  │
                                  │ scan dengan app bayar apa pun
                                  ▼
                         DANA / ShopeePay / GoPay / app bank
                                  │
                                  ▼
                    dana masuk ke merchant GoPay Merchant
                                  │
        server: pg_cron ──▶ opera-agent-qris-detect ──▶ feed GoBiz
                                  │
                                  └── cocok FIFO ──▶ invoice lunas (otomatis)
```

### `_shared/qris.js` — pembuat payload (murni)

Fungsi murni, tanpa jaringan, tanpa jam, tanpa rahasia. Ekspor:

- `parseQrTags(payload)` → `[{ id, len, value }]`
- `buildQrTag(id, value)`
- `qrCrc16(text)` → CCITT-FALSE, empat hex
- `qrisDynamicPayload(staticPayload, amountCents, currency)` →
  `{ ok: true, payload, amountRupiah }` atau `{ ok: false, why }`

Aturan dan penolakan:

| Aturan | Kenapa |
|---|---|
| mata uang harus `IDR` | QRIS hanya IDR |
| nominal ≥ 100 sen → rupiah bulat, tanpa desimal | QRIS tanpa subunit; `1000.00` ditolak acquirer |
| payload harus diawali `000201` | bentuk EMVCo |
| CRC payload statis harus cocok dengan hitungan kita | kalau tidak cocok, kita salah membaca payload; menolak lebih aman daripada membuat QR rusak |
| payload harus membawa tag 26 (acquirer) dan tag 51 (merchant) | tanpa identitas merchant, QR tidak milik siapa pun |
| tag 01 harus `11` atau `12`, disetel `12` | `12` = dynamic |
| tag 54 diisi/disisipkan sebelum tag 58 | bentuk yang terbukti diterima |
| tag 62 harus punya sub-tag 07, disetel `A02` | kategori QRIS; `A01` ditolak payer |
| CRC16 dihitung ulang di tag 63 (`6304` + CRC) | QRIS memverifikasi CRC |

Payload statis adalah data publik (tertuang di QR merchant sendiri), tapi tetap
disimpan sebagai secret edge, bukan di repo: identitas merchant kita tidak
pernah masuk source, dan pindah merchant adalah perubahan konfigurasi.

### `_shared/qr.js` — matriks QR → SVG inline (murni)

- **Tanpa dependensi baru.** Repo ini punya nol dependensi npm dan CI menjalankan
  `npm test` tanpa `npm install`. Menambah paket berarti mengubah aturan itu.
- Encoder di-vendor ke repo: mode byte, level ECC `M`, versi 1–20, mask dipilih
  dengan aturan penalti.
- Ekspor `qrSvg(payload, { margin })` → string SVG berisi `<svg>` + `<path>`
  saja: tanpa `<image>`, tanpa referensi luar, tanpa script.
- **Mengapa inline SVG dan bukan `<img>`:** CSP halaman adalah
  `default-src 'none'` dan halaman melarang `<img>`; markup inline bukan
  permintaan jaringan, jadi ia lolos tanpa melonggarkan CSP.
- Yang dirender hanya matriks modul, tidak ada teks merchant di dalam SVG, jadi
  tidak ada yang perlu di-escape.
- **Bukti kebenaran:** fixture matriks untuk payload uji dibangkitkan dari
  implementasi lain (`qrcode` npm, MIT, dipakai offline di mesin operator)
  dan disimpan sebagai teks di repo; test membandingkan matriks modul kita
  dengan fixture itu, modul demi modul. Preseden yang sama sudah dipakai untuk
  vektor signature Midtrans di `_shared/billing.js`.

### Antarmuka rail

Rail bukan kelas dan bukan hierarki. Rail adalah **nama** (`provider` yang
sudah ada di `opera_invoices`) plus **dua titik pemanggilan**:

1. **Membuka attempt.** `opera-agent-billing` memilih rail dari env
   `BILLING_RAIL` (`midtrans` | `qris-self`, default `midtrans`).
   - `midtrans`: jalur SNAP yang ada, tidak berubah satu baris pun.
   - `qris-self`: `qrisDynamicPayload` membangun payload; tidak ada panggilan
     provider saat membuka attempt, jadi tidak ada transaksi yang bisa gagal
     separuh jalan.
2. **Menutup invoice dari settlement.** Detector membangun objek berbentuk
   notifikasi `{ order_id, gross_amount, transaction_status: 'settlement',
   payment_type: 'qris', transaction_id }` lalu memanggil `markPaid` yang sudah
   ada. Jadi pengecekan nominal, pencarian invoice lewat
   `provider_order_ids`, `paid_at` yang tidak pernah digeser dua kali, dan
   pencatatan `paid_method`/`provider_transaction_id` — semuanya aturan yang
   sudah terbukti, tanpa ditulis ulang.

Attempt milik rail QRIS memakai `provider_order_id` lokal (misalnya
`qr-<hash>`), sehingga pencarian invoice dan array attempt bekerja tanpa
perubahan.

### Data model

Satu migrasi baru:

| Objek | Isi |
|---|---|
| `opera_invoices.qris_payload text` | payload persis yang ditampilkan ke payer (audit dan bukti ulang) |
| `opera_invoices.provider` | dipakai sebagai nama rail (`qris-self`); tidak ada kolom rail baru |
| indeks unik parsial | `unique (amount_cents) where provider='qris-self' and status='open' and qris_payload is not null` → **satu QR aktif per nominal** |
| `opera_qris_settlements` | `provider_transaction_id` (unik), `invoice_id`, `amount_cents`, `currency`, `method`, `status` (`matched`/`unmatched`), `raw jsonb`, `settled_at` |
| `opera_qris_detector` | satu baris: `last_polled_at`, `last_ok_at`, `last_error`, `seen_count` — supaya halaman bisa jujur soal kapan terakhir diperiksa |
| Vault | `opera_agent_qris_detector_token_v1` (token pemanggil detector), secret token GoBiz |
| RPC `security definer` | baca/tulis token GoBiz dan token detector untuk service_role; cron membaca token yang sama dari `vault.decrypted_secrets` |

**Kenapa indeks unik per nominal.** Dua pelanggan bisa berutang nominal yang
sama (Rp 99.000). Kalau keduanya memegang QR aktif, uang yang masuk bisa
menutup invoice yang salah. Dengan indeks itu, hanya satu invoice per nominal
yang boleh memegang QR; invoice kedua menunggu giliran ("another payment of
this amount is clearing first"). Begitu invoice pertama lunas, indeks melepas
dan invoice kedua bisa membuka QR-nya sendiri.

### Detector

Fungsi edge baru `opera-agent-qris-detect`, dipanggil `pg_cron` tiap menit
(pola `net.http_post` yang sama seperti keepwarm yang sudah ada). Token pemanggil
berada di Vault, jadi token tidak pernah ada di repo maupun di cron job.

Satu putaran:

1. Ambil token akses + refresh + device id dari Vault.
2. `GET https://api.gojekapi.com/merchant-analytics/v2/merchants/transactions`
   dengan header portal yang sudah tertangkap (`Authentication-Type: go-id`,
   `Authorization: Bearer`, `x-uniqueid` = device id, `X-AppVersion`,
   `x-appId`, `X-Platform`, `x-DeviceOS`, `X-User-Type`, `Gojek-Country-Code`,
   `Gojek-Timezone`) dan query yang sudah terbukti diterima.
3. Bila `401`: tukar refresh token (`POST https://api.gobiz.co.id/goid/token`,
   `grant_type: refresh_token`), simpan ke Vault, coba sekali lagi.
4. Setiap transaksi yang statusnya settled dan `provider_transaction_id`-nya
   belum pernah tercatat: cocokkan ke invoice.
   - **Cocok:** `status='open'`, `provider='qris-self'`, `amount_cents` sama,
     **FIFO** — `created_at` paling lama lebih dulu.
   - **Tidak cocok:** tulis settlement `unmatched` dan log. Uang datang tanpa
     tujuan; operator menutupnya lewat `settle-manual` dengan catatan yang
     menyebut id transaksi provider.
5. Tulis heartbeat.

**Idempotensi dua lapis.** Unik per `provider_transaction_id` di
`opera_qris_settlements` (transaksi sama tidak pernah dicatat dua kali), dan
penutupan invoice memakai `paid_at is null` (invoice yang sudah lunas tidak
bergerak). Payer yang memindai QR dua kali tidak menyebabkan uang terbayar
dua kali.

**Mode dry adalah default.** `QRIS_DETECTOR_MODE` default `dry`: detector
membaca feed dan mencatat apa yang akan dilakukan, tanpa menutup invoice.
Naik ke `live` hanya setelah L1 akhir dan L2 terbukti.

### Halaman invoice

- Rail `qris-self` dengan payload → tampilkan nominal terkunci + QR inline SVG
  + "This QR stays payable until the invoice is paid" (QRIS buatan kita tidak
  punya masa berlaku, jadi halaman tidak boleh mengarang kedaluwarsa).
- Baris "last checked": dari `opera_qris_detector`. Lebih lama dari 5 menit →
  "payment verification is delayed — we are still watching for your payment".
- Invoice kedua dengan nominal yang sama → "another payment of this amount is
  clearing first; your QR follows".
- `payLinkState` dan jalur Midtrans tidak disentuh. `invoice-page.js` menerima
  QR sebagai string dari luar, jadi modul halaman tetap murni dan bisa diuji
  tanpa encoder.

### Akuntansi

- **Tanpa pemecahan utang vs dibayar.** Nominal QR = nominal invoice persis,
  jadi `amount_cents` adalah utang sekaligus jumlah yang harus dibayar.
  Kolom `payable_cents`/`unique_code_cents` **tidak dibuat sekarang**; kalau
  nanti ada rail yang menambah kode unik, pemecahan itu datang bersama rail
  itu.
- `paid_method` diisi `qris`, `provider_transaction_id` diisi id transaksi dari
  feed — bukti cara uang datang, seperti yang sudah dijanjikan halaman.

### Rahasia dan data

| Nama | Tempat | Isi |
|---|---|---|
| `QRIS_STATIC_PAYLOAD` | Supabase secret (edge) | payload QRIS statis merchant; merchant id dibaca dari tag 26 sub-tag 03, jadi tidak ada secret kedua |
| token GoBiz (access, refresh, device id) | Vault | sesi merchant; detector bisa memperbaruinya sendiri |
| `opera_agent_qris_detector_token_v1` | Vault | token pemanggil detector, dibaca cron dari `vault.decrypted_secrets` |
| `BILLING_RAIL` | env edge | `midtrans` atau `qris-self` |
| `QRIS_DETECTOR_MODE` | env edge | `dry` (default) atau `live` |

Nomor HP merchant dan token tidak pernah masuk repo, log, atau halaman.

**Bagaimana token GoBiz masuk ke Vault.** `scripts/gobiz-probe.mjs` tetap alat
operator: `login` menulis `session.json` di direktori temp. Perintah baru
`push-vault` membaca file itu dan menulis access token, refresh token, dan
device id ke Vault lewat RPC — nilainya tidak pernah dicetak, tidak pernah
dilewati argumen baris perintah, dan tidak pernah masuk repo. Setelah itu
detector bisa memperbarui tokennya sendiri tanpa operator.

## Model bahaya

| Bahaya | Akibat | Catch |
|---|---|---|
| Satuan nominal feed salah | invoice salah lunas | mode dry lebih dulu; L2 mengukur satuan dari transaksi nyata; `live` hanya setelah itu |
| Pembayaran QRIS buatan sendiri tidak muncul di feed | detector buta, invoice tak pernah lunas | heartbeat terlihat di halaman; heartbeat basi → halaman mengatakannya; `settle-manual` adalah jaring pengaman |
| API GoBiz berubah atau memblokir | detector mati | satu rail; pindah ke vendor (EQRIS/RavaPay) tanpa mengubah halaman atau invoice; `settle-manual` sementara |
| Token refresh tidak berlaku | detector berhenti setelah umur token | heartbeat error; operator login ulang (satu kali, bukan per invoice) |
| Dua invoice nominal sama | uang menutup invoice yang salah | indeks unik per nominal: satu QR aktif per nominal, FIFO untuk sisanya |
| Pembayaran masuk setelah invoice dibatalkan | uang tanpa tujuan | settlement `unmatched` + log; operator `settle-manual` |
| Payer memindai QR berkali-kali | uang terpotong dua kali | unik per `provider_transaction_id` + `paid_at is null` |
| QR rusak karena payload salah baca | payer scan dan gagal | CRC statis diverifikasi sebelum konversi; payload tanpa tag 26/51 ditolak |
| Aturan BI tentang konversi statis→dinamis | risiko kepatuhan | [UNVERIFIED] tidak ada aturan eksplisit yang ditemukan; dana tetap ke merchant yang sama; ini keputusan bisnis yang perlu dicatat |

## Penanganan galat

| Kondisi | Yang dilakukan sistem | Yang dilihat payer |
|---|---|---|
| Feed `401` | tukar refresh token, coba sekali lagi | tidak ada perubahan bagi payer |
| Refresh gagal | heartbeat `last_error`, detector berhenti menebak | "payment verification is delayed" |
| Feed `5xx`/timeout | heartbeat error, coba lagi menit berikutnya | "payment verification is delayed" |
| Transaksi tanpa invoice cocok | settlement `unmatched` + log | tidak ada; invoice tetap terbuka |
| Nominal feed ≠ nominal invoice | settlement `unmatched` + log | invoice tetap terbuka |
| QR belum bisa dibangun (payload/refusal) | invoice tetap terbuka, QR tidak ditampilkan | "we are preparing your payment QR; a transfer is also accepted" |
| Nominal sudah dipakai invoice lain | tidak ada QR untuk invoice kedua | "another payment of this amount is clearing first" |

## Pengujian

- `tests/qris.test.mjs`:
  - payload builder: tag 01, tag 54 (sisip & ganti), tag 62/07, CRC16 (vektor
    dari payload statis asli), determinisme, setiap penolakan (mata uang,
    nominal, CRC rusak, tanpa tag 26/51, tanpa sub-tag 07);
  - pencocok FIFO: nominal sama → invoice terlama dulu; nominal berbeda tidak
    boleh cocok; invoice yang sudah lunas tidak boleh dicocokkan;
  - idempotensi: transaksi yang sama dicatat sekali;
  - QR: matriks modul sama dengan fixture dari implementasi lain; SVG tidak
    memuat `<image>`, `<script>`, atau referensi luar.
- `tests/invoice-page.test.mjs`: halaman QRIS menampilkan nominal dan SVG,
  menampilkan pesan QR menunggu giliran, dan menampilkan penundaan verifikasi;
  jalur Midtrans tidak berubah.
- Uji manual (wajib, tidak bisa diabadikan):
  1. bayar Rp 1.000 dari app non-GoPay (L1 akhir) → saldo merchant naik;
  2. `opera-agent-qris-detect` dalam mode dry melihat transaksi itu → satuan
     nominal feed terukur dari data nyata (L2);
  3. detector `live` → invoice tertutup tanpa operator;
  4. scan QR dari app kedua → nominal tetap terkunci.
- `npm test` dan `npm run check` hijau.

## Definisi selesai

- [ ] `_shared/qris.js` + test: payload dinamis yang diterima ShopeePay dibangun
      dari payload statis merchant, deterministik, dan menolak input rusak.
- [ ] `_shared/qr.js` + test: SVG inline dari matriks yang dicocokkan dengan
      fixture implementasi lain.
- [ ] Migrasi: kolom payload, indeks unik per nominal, tabel settlement,
      heartbeat, secret Vault, RPC.
- [ ] `opera-agent-billing`: `BILLING_RAIL=qris-self` membuka attempt QRIS
      tanpa panggilan provider; halaman menampilkan QR; jalur Midtrans utuh.
- [ ] `opera-agent-qris-detect`: poll feed, mode dry default, heartbeat, FIFO,
      idempotensi.
- [ ] `pg_cron` memanggil detector tiap menit dengan token dari Vault.
- [ ] Pembayaran Rp 1.000 nyata: saldo naik (L1) dan transaksi terlihat di feed
      (L2) → detector `live` menutup invoice tanpa operator.
- [ ] `docs/product/billing.md` dan `docs/handoff.md` menyebut rail, secret, dan
      cara logout ulang token.

## Urutan kerja

1. `_shared/qris.js` + test. Paling kecil, paling murni, paling banyak yang
   dibuktikan.
2. `_shared/qr.js` + fixture test.
3. Migrasi.
4. `opera-agent-billing`: rail switch + blok QR di halaman.
5. `scripts/gobiz-probe.mjs push-vault` + `opera-agent-qris-detect` (dry) +
   `pg_cron`.
6. Ukur satuan feed dari transaksi nyata, lalu `live`.
7. Dokumentasi dan handoff.

Setiap langkah berhenti di tes yang hijau. Tidak ada kode produksi sebelum
langkah 1, dan tidak ada mode `live` sebelum langkah 6.
