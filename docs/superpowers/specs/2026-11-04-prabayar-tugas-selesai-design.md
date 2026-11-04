# Spesifikasi: Prabayar Tugas Selesai (Pay Once, Use Anytime)

@last-edited: 2026-11-04 UTC+7.
@related: [AGENTS.md](../../../AGENTS.md)

Disetujui sebagai arah pada 2026-11-04. Spec ini mendefinisikan subsistem billing berbasis wallet prabayar dengan penyelesaian reserve → settle / refund, khusus untuk V1.

## Intent

Pengguna membayar per pekerjaan yang selesai, bukan per token, menit, atau langkah. Uang berjalan lewat satu jalur: deposit QRIS satu kali menjadi saldo wallet; setiap task menahan dana (reserve) sebelum jalan; dana dipotong (settle) kalau task selesai, dikembalikan penuh (refund) kalau gagal. Tidak ada langganan di V1.

Keputusan yang menjadi fondasi (hasil riset 2026-11-04, bukan preferensi):

- Biaya marginal per task praktis nol: eksekusi di device pengguna, model dibayar pengguna ke providernya sendiri (BYOM), relay Supabase flat $25/bulan, deposit QRIS ≤ Rp100.000 kena MDR 0% (aturan BI per 1 Oktober 2026). Tidak ada yang perlu di-meter per unit untuk menutup biaya variabel — karena tidak ada biaya variabel.
- Flat rate adalah harga yang benar secara psikologis (taxi-meter effect, insurance effect, flat-rate bias — plus preseden Anchor: hanya completed task yang ditagih, gagal = Rp0).
- Unit tagihan adalah *pekerjaan selesai*, bukan token/menit/langkah. Meter internal hanya untuk kalibrasi tarif, tidak pernah muncul di tagihan.

## Non-goals V1

- Tanpa subscription, tanpa tier, tanpa diskon volume.
- Tanpa antrean offline: task butuh koneksi saat reserve (settle/refund yang gagal terkirim diulang saat online kembali, sebelum task baru diizinkan; hold kedaluwarsa 30 menit → refund otomatis).
- Tanpa pekerjaan kreatif panjang (paper/skripsi/buku): V1 hanya task yang selesai-atau-gagal biner (lihat definisi selesai). Milestone bertahap adalah V1.1.

## Definisi selesai (mengikat, bisa diuji mesin)

Selesai = tiga syarat kumulatif, dinilai tanpa manusia:

1. Status terminal biner: `completed` atau `failed` (termasuk varian `failed_overrun` dan `failed_offline_timeout` — varian menjelaskan, tidak mengubah akibat). Tidak ada status ketiga.
2. Artefak yang dijanjikan jenis task ada dan bisa dibuka (file ada, ≥1 baris data untuk laporan; semua item berstatus untuk batch).
3. Checklist verifikasi jenis task lolos (didefinisikan per jenis, dieksekusi kode — bukan penilaian).

Gagal = refund penuh. Selalu. Tanpa proporsi, tanpa pengecualian, tanpa memandang berapa aksi sudah jalan. Task yang berhenti di tengah karena batas 10 aksi = `failed_overrun` = refund penuh.

## Klasifikasi tanpa katalog

Tidak ada tabel jenis task yang dirawat manual. Aturannya mekanis dari struktur rencana:

- Hasil tunggal + estimasi ≤ batas 10 aksi → satu task, tarif dasar.
- Hasil daftar independen → pecah otomatis per 10 item, masing-masing task dengan reserve sendiri.
- Estimasi > batas → tolak di depan dengan tawaran pecahan, bukan gagal di tengah.

Estimator boleh meleset: deviasi wajar (±3 langkah atau replan yang mempertahankan artefak valid) bukan kegagalan. Dua replan gagal = gagal = refund penuh. Estimasi meleset dicatat untuk kalibrasi, bukan untuk menghukum pengguna.

## Tarif V1 (angka sementara, ditandai di kode sebagai ilustrasi)

- Dasar per task selesai, ditampilkan sebelum reserve diminta. Angka awal: sederhana Rp100, sedang Rp500, laporan Rp1.000, batch Rp80/pekerjaan.
- Tarif dibaca dari tabel harga server (`opera_price_list`), bukan hardcode di client — angka bisa diubah tanpa rilis extension.
- Satu-satunya hal yang dijanjikan: harga yang disetujui di depan adalah harga yang dipotong kalau selesai. Tidak pernah lebih.

## Alur uang (server adalah satu-satunya penulis kebenaran)

1. Deposit QRIS → webhook terverifikasi → tulis `deposit` ke ledger wallet pengguna. Saldo = SUM(deposit + refund − settle); tidak ada kolom saldo yang ditimpa.
2. `task.reserve(kind)` → server cek saldo ≥ tarif → tulis `reserve_hold` (kedaluwarsa 30 menit) → kembalikan `reservation_id`. Tidak cukup: tolak sebelum task mulai, tanpa jejak selain penolakan.
3. Task jalan 100% lokal (browser/CDP di device, model milik pengguna). Server tidak terlibat, tidak ada callback per aksi.
4. `task.settle(reservation_id, artifact_hash)` → verifikasi milik-pengguna + belum kedaluwarsa → tulis `settle`, tutup hold.
5. `task.refund(reservation_id, reason)` → tulis `refund` sebesar hold, tutup hold.
6. Semua tulis ledger append-only; settle/refund idempoten via `reservation_id` unik (retry jaringan aman).

Yang eksplisit TIDAK ada: saldo di client (selalu baca server, beri label waktu kalau offline tampil terakhir), tarif di client (selalu dari server), penagihan per aksi/token/menit.

## Permukaan persetujuan

- Jalur extension: popup persetujuan sebelum reserve (jenis, estimasi, tarif, saldo sesudah).
- Jalur driver lokal (CDP tanpa extension): prompt CLI/desktop yang sama isinya, kontrak API sama.
- Dashboard: saldo real-time, riwayat ledger per task, tombol isi ulang.

## Target keberhasilan yang dapat diukur

- Satu task sederhana end-to-end (reserve → jalan → settle) di local + Supabase lokal, saldo berkurang tepat Rp100.
- Satu task gagal end-to-end, saldo kembali utuh, tanpa baris settle.
- Satu task melewati 10 aksi berhenti otomatis, status `failed_overrun`, refund penuh.
- `npm test` hijau; tidak ada `console.log` baru; komentar WHY satu kalimat per aturan bisnis.

## Risiko yang diterima

- Overdraw race: dua reserve bersamaan melebihi saldo dicegah dengan kunci baris wallet di transaksi yang sama (SELECT ... FOR UPDATE) — bukan cek-baca-tulis terpisah.
- Hold yatim (client crash sebelum settle/refund): sweep 30 menit → refund otomatis.
- Tarif salah kalibrasi: diterima sebagai data, bukan bug — median dan p95 jumlah aksi per task dipantau dari kolom hitung yang ditulis sekali per task selesai/gagal.

## Skala berikutnya (di luar spec ini)

- Milestone bertahap untuk pekerjaan kreatif panjang, dengan definisi selesai per milestone yang disetujui di depan.
- Eksekusi offline penuh dengan antrean settle/refund persisten.
