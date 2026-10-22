@last-edited: 2026-10-22 UTC+7.
@related: [monetization](monetization.md) - [first-three-bookkeepers](first-three-bookkeepers.md) - [billing](billing.md)

# Apa yang orang bayar dari browser agent

## Kesimpulan

Tidak ada yang membayar "browser agent". Yang dibayar adalah pekerjaan portal yang
berulang, punya deadline, dan hasilnya bisa diperiksa: statement bulanan, paket pajak,
dokumen tender, dokumen kepabeanan, invoice supplier. Browser agent hanya cara
mengerjakannya; kalau cara itu terlihat di invoice, harganya jatuh.

Pekerjaan yang layak dijual punya lima ciri:

1. Portal adalah sistem pencatatan, dan API-nya tidak bisa dipakai pembeli.
2. Berulang: harian, mingguan, atau bulanan, dengan deadline yang nyata.
3. Pembeli sudah membayar orang, agen, atau software lain untuk pekerjaan itu.
4. Output-nya bisa diperiksa: file, status, tanda terima, saldo, daftar gagal.
5. Risikonya bisa dijaga: akun sendiri, login sendiri, tanpa password/OTP, dan
   keputusan yang mengikat tetap di tangan manusia.

## Peta pekerjaan

| Pekerjaan portal | Pembeli | Rasa sakit | Bukti sudah dibayar | Nilai |
|---|---|---|---|---|
| **Tutup buku bulanan**: statement, rekap, laporan | Bookkeeper, KJA, tim finance | 12–15 jam per close untuk 50 bank; file tersebar; nama tidak konsisten; telat | LedgerDocs $18 untuk 6 statement; Nexius Rp129.000/laporan; jasa laporan keuangan Rp2,25–5,5 jt/klien/bulan | **Wedge sekarang**; lapisan laporan = uang |
| **Paket pajak bulanan**: e-Faktur, SPT, bukti potong | Konsultan pajak, KJA | Input ulang, dokumen klien telat, deadline SPT | SPT bulanan Rp800 rb–3,5 jt; bundling pajak+keuangan Rp2,5–7,5 jt/bulan | **Berikutnya**; human-in-the-loop |
| **Dokumen tender**: pantau LPSE, unduh dokumen, deadline | Kontraktor, vendor, konsultan | 700+ LPSE; cek harian; dokumen tersebar; peluang lewat | TenderID Rp250 rb/bulan (5.000+ kontraktor); Datalpse Rp1,2 jt/tahun | **Eksperimen murah**; ceiling rendah |
| **Dokumen kepabeanan**: PIB/PEB, INSW, shipping | PPJK, forwarder, importer | Banyak portal, dokumen tidak cocok, demurrage | Clearance Rp1 jt untuk 1–100 kg + Rp3 rb/kg | **Ticket tinggi**; domain berat |
| **AP/AR**: invoice supplier, approval, status bayar | Tim finance, AP outsourcing | Invoice tersebar, 3-way match, telat bayar | Biaya proses invoice $9,40 (global); Mekari AP | **Enterprise**; sales lama |
| **Back office e-commerce**: laporan, payout, listing | Seller, agency | Multi-marketplace, rekonsiliasi fee, admin | Admin Rp100–150 rb/bulan (estimasi rendah); BigSeller gratis; iSeller Rp300 rb–2,16 jt/bulan | **Rame & murah**; jangan dulu |
| **Listing properti** | Agen properti | Posting ulang, listing basi | Komisi agen; tools listing | **Ticket kecil**; ToS |
| **Rekrutmen/lead gen** | Recruiter, sales | Posting, unduh kandidat/lead | Job board/VA | **ToS/legal risk**; hindari |

## Bukti harga

| Yang dibayar | Harga | Sumber |
|---|---|---|
| Statement fetching | $18/bulan untuk 6 statement; sekitar $3/statement | ledgerdocs.com/pricing-for-ledgerdocs |
| Rekening koran → laporan keuangan | Rp129.000/generate, maksimal 35 halaman; 200+ perusahaan | nexiusai.com |
| Software akuntansi | Accurate Online Rp333.000/bulan | accurate.id/harga |
| Jasa laporan keuangan | Rp2.250.000–5.500.000/klien/bulan | isipajak.co.id/harga-jasa-konsultan-pajak |
| Jasa SPT bulanan | Rp800.000–3.500.000/bulan | isipajak.co.id/harga-jasa-konsultan-pajak |
| Jasa bundling pajak+keuangan | Rp2.500.000–7.500.000/bulan | isipajak.co.id/harga-jasa-konsultan-pajak |
| Monitoring tender | Rp250.000/bulan; Rp2.000.000/tahun | tenderid.com/pricing |
| Monitoring LPSE | Rp350.000/3 bulan; Rp1.200.000/12 bulan | datalpse.com |
| Customs clearance | Rp1.000.000 untuk 1–100 kg; Rp3.000/kg berikutnya | kamaraya.com/tarif/jakarta/customs-clearance |
| Gaji bookkeeper | Rp3,5–5 jt/bulan junior; Rp5–8 jt/bulan mid | sgbva.com/id/blog/bookkeeper-adalah |
| Biaya proses invoice | $9,40/invoice (rata-rata global) | wexinc.com (Ardent Partners 2025) |
| Waktu statement manual | 12–15 jam per close untuk 50 bank | arpari.com |

## Apa yang benar-benar mereka bayar

1. **Hasil yang selesai, bukan tool.** Mereka membeli "statement bulan ini beres",
   "SPT terkirim", "dokumen tender sudah di folder", bukan akses ke agent.
2. **Harga flat per klien/akun/bulan.** Jasa pembukuan dan pajak dijual flat; per jam
   adalah tanda tidak ada yang bisa menjanjikan hasil.
3. **Kepastian deadline.** Pajak, tender, dan bea cukai punya tanggal; telat berarti
   denda, kehilangan proyek, atau demurrage.
4. **Kapasitas.** Satu klien lagi tanpa satu karyawan lagi. Ini alasan firma membeli,
   bukan sekadar menghemat menit.
5. **Bukti dan audit trail.** Nama file, waktu, saldo, halaman, daftar yang gagal.
   Angka yang tidak bisa ditelusuri lebih buruk daripada tidak ada angka.
6. **Keamanan.** Login sendiri, tanpa password/OTP, file tidak diunggah. Untuk data
   bank dan pajak, ini bukan fitur; ini syarat masuk.
7. **Tidak perlu belajar tool.** Kalau pembeli harus membuka dashboard baru, mereka
   lebih memilih menambah admin.

## Apa yang tidak mereka bayar

- "AI agent", "browser automation", atau "RPA" sebagai kategori.
- Dashboard baru yang harus mereka operasikan sendiri.
- Download mentah tanpa nama, folder, dan bukti.
- Per jam atau per aksi; mereka ingin harga yang bisa dianggarkan.
- Tugas konsumen bernilai kecil: sekolah, sosial media, booking pribadi.
- Apa pun yang meminta password/OTP, menembus MFA, atau melanggar ToS portal.

## Implikasi untuk tawaran sekarang

- **Statement desk adalah pintu masuk, bukan bisnis utuh.** Untuk download saja, 50
  client-month mungkin 2–4 jam kerja manual per bulan; dengan biaya Rp20–30 rb/jam,
  itu Rp40–120 rb/bulan. Untuk close penuh, Arpari mencatat 12–15 jam per 50 bank.
  Harga Rp99–249 rb sudah masuk akal untuk retrieval saja `[ESTIMATE]`. Nilai yang
  lebih besar datang dari laporan dan kepastian, bukan dari download.
- **Lapisan laporan adalah tempat uangnya.** Nexius menjual Rp129.000/laporan; jasa
  laporan keuangan Rp2,25–5,5 jt/klien/bulan. Tapi `report_build` sekarang hanya CSV,
  sementara statement bank sering PDF. Gap berikutnya adalah jalur data PDF/Excel yang
  bisa dipercaya, bukan menambah verb browser.
- **Paket pajak adalah tetangga terdekat.** Pembelinya sama (KJA/konsultan), siklusnya
  bulanan, harganya lebih tinggi. Mulai dari mengumpulkan dan merapikan dokumen; jangan
  otomatiskan penyampaian SPT tanpa manusia.
- **Tender adalah eksperimen pembeli lain.** Datanya publik, tidak perlu kredensial,
  dan sudah ada yang membayar. Tapi ceiling-nya rendah dan pesaingnya data platform;
  diferensiasinya harus dokumen + deadline, bukan sekadar alert.
- **E-commerce adalah jebakan untuk tim kecil.** BigSeller gratis, iSeller ratusan
  ribu, dan gaji admin rendah. Jangan mulai dari sini.
- **Landing page masih mengatakan gratis.** Prospect yang cek situs akan melihat
  kontradiksi dengan tawaran Rp99.000. Perbaiki sebelum outreach.

## Harga

- Pilot Rp99.000 tetap dipakai sebagai **bukti berbayar**, bukan harga standar.
- Plan Rp249.000 untuk 50 client-month masuk akal untuk retrieval murni. Jangan naikkan
  sebelum laporan ikut masuk.
- Kalau laporan ikut dijual, harga per client-month atau per laporan: misalnya
  Rp25.000–50.000/client-month, atau Rp50.000–100.000/laporan. Anchor-nya Nexius
  Rp129.000/laporan. Ini hipotesis, `[UNVERIFIED]` sampai ada yang transfer.
- Overage Rp10.000/client-month lebih tinggi dari rata-rata plan (Rp5.000). Firma yang
  naik dari 50 ke 51 klien membayar lompatan; pertimbangkan overage Rp5.000–7.500 atau
  plan 50 yang lebih mahal. Jangan ubah produksi sebelum ada pembeli.

## Dua tes berikutnya

### A. Bookkeeper/KJA — paket tutup buku

Tawaran yang sudah ada: statement + bukti, Rp99.000 pilot sampai 15 client-month.
Target: 3 pilot, 1 transfer. Ini yang paling siap; jangan bangun fitur baru dulu.

### B. Konsultan pajak/KJA — paket dokumen bulanan

Tawaran: ambil e-statement, bukti potong, dan dokumen klien dari portal yang sudah
mereka login; simpan per klien/bulan; serahkan folder + manifest. Tidak termasuk
penyampaian SPT. Pilot Rp249.000 untuk 10 client-month, bayar setelah batch diterima.
Target: 5 percakapan, 1 pilot. Ini menguji apakah pembeli yang sama mau membayar lebih
untuk paket yang lebih dekat ke pekerjaan mereka.

### C. Kontraktor — paket dokumen tender (opsional)

Tawaran: pantau LPSE sesuai kata kunci, unduh dokumen tender, kirim folder + daftar
deadline setiap hari. Pilot Rp250.000/bulan. Target: 5 percakapan. Ini pembeli berbeda;
jangan bangun sampai ada minat.

## Batas bukti

- Harga di atas adalah **list price vendor**, bukan transaksi. Mereka membuktikan ada
  pasar, bukan bahwa pembeli kita mau membayar di harga itu.
- Data waktu Indonesia tipis. Angka 12–15 jam berasal dari Arpari (global); angka
  Indonesia masih `[UNVERIFIED]`.
- Belum ada wawancara primer. Sepuluh percakapan pertama adalah riset yang sebenarnya.
- Willingness-to-pay kita sendiri masih `[UNVERIFIED]` sampai ada transfer masuk.

## Sumber

- https://www.ledgerdocs.com/pricing-for-ledgerdocs
- https://nexiusai.com
- https://accurate.id/harga/
- https://isipajak.co.id/harga-jasa-konsultan-pajak
- https://tenderid.com/pricing
- https://www.datalpse.com
- https://kamaraya.com/tarif/jakarta/customs-clearance
- https://sgbva.com/id/blog/bookkeeper-adalah
- https://www.wexinc.com/resources/blog/what-does-it-cost-to-process-an-invoice-ap-benchmarks-every-finance-team-should-know
- https://www.arpari.com/post/the-monday-morning-scramble-thats-costing-your-finance-team-more-than-you-think
- https://everpro.id/blog/marketplace/jasa-admin-online-shop
- https://jubelio.com/integrasi-marketplace
