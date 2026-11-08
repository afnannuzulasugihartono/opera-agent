# Spesifikasi: Paket Berlangganan dan Kuotanya

@last-edited: 2026-11-08 UTC+7.
@related: [AGENTS.md](../../../AGENTS.md) - [docs/agent-call.md](../../agent-call.md) - [docs/superpowers/specs/2026-11-08-installable-mcp-design.md](2026-11-08-installable-mcp-design.md)

Disetujui sebagai arah pada 2026-11-08. Spec ini membuat Opera Agent bisa dijual: paket dan kuotanya ditegakkan di **bridge** dan di **MCP hosted**, sementara kliennya (extension dan paket CLI) tetap gratis dan bebas dibaca.

## Intent

Pertanyaanowners: "kalau orang bisa mengunduh dan menjalankan dengan bebas, bagaimana aku bisa menguangkannya?"

Jawabannya: **yang dijual bukan unduhannya, melainkan apa yang hanya server bisa berikan.** repo ini sudah punya separuh alatnya ✓: `plan.pilot` / `plan.firm` ✓, `opera_price_list` ✓, dompet ✓, invoice ✓, QRIS ✓, dan `opera_devices` yang terikat ke akun ✓. Yang belum ada: **bridge tahu siapa yang menelepon ✓✓, tapi belum tahu apa yang boleh ia pakai** ✗.

Keputusan yang mengikat:

- **Gerbang di bridge dan di MCP hosted** ✓; bukan di dalam binari ✗.
- **Klien gratis dan bisa dibaca** ✓✓ — extension dan paket CLI bebas diunduh ✓.
- **Paket gratis dibatasi** ✓; paket berbayar membuka batasnya ✓.
- **Yang dijual**: drive jarak jauh ✓, tim & multi-perangkat ✓, artefak tertahan ✓, kuota besar ✓, dukungan ✓.

## Batas yang jujur

**Otomatisasi lokal tidak bisa di-paywall** ✗. Protocol bridge adalah perintah CDP biasa ✓, extension berupa folder JS biasa ✓, dan soket loopback terbuka untuk proses lokal mana pun ✓ (pemeriksaan origin hanya meminta id extension ✓ yang publik ✓). Siapa pun yang mau menulis skrip kecil bisa_NO bypass_) ✗✗ — tanpa membayar ✗.

Maka gerbang tidak pernah diletakkan di kode yang dibaca pengguna ✗ (itu teater ✗): ia diletakkan di **layanan** ✓✓, dan nilai yang dijual adalah hal yang drive lokal tidak bisa berikan ✓.

## Data

### Paket

| paket | untuk siapa | batas |
|---|---|---|
| `plan.pilot` | satu orang, penggunaan sendiri | kuota perintah harian ✓, tanpa mode `all` ✓, tanpa statement delivery ✓, tanpa VM ✓ |
| `plan.firm` | tim dan penggunaan serius | kuota harian besar ✓, mode `all` ✓, statement delivery ✓, VM ✓, drive jarak jauh ✓ |

Batasnya Bernilai di kode bersama (`supabase/functions/_shared/plans.js` ✓✓) — bridge dan MCP hosted mengimpor modul yang sama ✓✓ (satu sumber kebenaran ✓; repo ini punya preseden: `lib/secret-pattern.js` ✓).

### Paket langganan sebuah akun

Tabel baru `opera_account_plans` ✓:

| kolom | |
|---|---|
| `user_id` | akun pemiliknya ✓ |
| `plan` | `plan.pilot` atau `plan.firm` ✓ |
| `status` | `active` atau `paused` ✓ |
| `updated_at` | kapan paket terakhir berubah ✓ |

RPC baca `opera_my_plan()` ✓ (mengembalikan paket + kuota harian + pemakaian hari ini ✓) untuk dipakai bridge ✓, MCP hosted ✓, dan dashboard ✓.

Perubahan paket terjadi lewat invoice yang sudah ada ✓ (`invoice_create` sudah menyebut `plan.pilot`/`plan.firm` ✓) — jadi tidak ada jalur pembayaran baru ✓✓.

## Gerbang di bridge

1. **Handshake.** Bridge memvalidasi token ✓ (yang sudah ada ✓) lalu membaca paket akun ✓.=device yang tidak punya paket aktif → soket ditutup dengan pesan yang menyebut paket ✓✓.
2. **Kuota per perintah.** Setelah handshake, bridge menghitung perintah hari ini ✓ vs kuota paket ✓. Melewati kuota → perintah dijawab dengan `PLAN_LIMIT_REACHED` ✓ dan nama paketnya ✓ (bukan diam ✗).
3. **Fitur paket.** `page.read` dengan `all: true` (peta satu halaman penuh ✓) dan `statement.*` ✓ hanya untuk `plan.firm` ✓.

Bridge tidak pernah menolak karena tagihan ✓ — ia menolak karena kuota ✓.

## Gerbang di MCP hosted

- `browser_status` menjawab paket dan kuota yang tersisa ✓ (`plan`, `planQuota`, `planUsed` ✓) — jadi agent tahu batasnya sebelum menabrak ✓✓.
- Panggilan yang melewati kuota dijawab `PLAN_LIMIT_REACHED` ✓ dengan nama paket ✓ (peta jalan lain sudah punya bentuk kegagalan yang sama ✓✓).
- Mode `all` di hosted: hanya `plan.firm` ✓ (satu fitur yang jelas bernilai ✓).

## Yang terlihat di klien

- `opera-agent-mcp doctor` mencetak paket aktif ✓, kuota harian ✓, sisa hari ini ✓, dan tautan pembelian ✓.
- Mode lokal memakai bridge yang sama ✓ → batas paket berlaku di sana juga ✓✓ (tanpa satu pun pemeriksaan di kode klien ✗✓).
- Extension tidak berubah ✗ — ia sudah speaking ke bridge ✓ (tapi安定arto tetap).

## Uji

- **Handshake bridge.** Unit: device tanpa paket → ditolak dengan menyebut paket ✓; device dengan `plan.pilot` → diterima ✓.
- **Kuota.** Unit: perintah ke-N pada kuota → ditolak ✓; hari berikutnya kuota kembali ✓ (dihitung per hari ✓).
- **Paket=firm.** `all: true` diizinkan ✓; di pilot → ditolak ✓.
- **Status.** `browser_status` melaporkan paket dan kuota ✓ dari akun yang benar ✓ (akun lain tidak terlihat ✓✓).
- **Kuotanya tidak terlihat dari akun lain** ✓ (RPC-nya scoped ✓).

## Risiko yang diterima

- **Skrip lokal bisa melewati gerbang** ✗ (dinyatakan di atas ✓). Yang dijual tetap layanan ✓.
- **Kuota harian dibaca dari database tiap perintah** ✗ → satu pembacaan tambahan per perintah ✓ (biayanya kecil ✓; kalau jadi mahal ✗, hitungannya dipindah ke memori bridge ✓ dengan penyegaran berkala ✓✓).
- **Paket yang belum punya invoice** ✗ → akun tanpa baris `opera_account_plans` diperlakukan sebagai `plan.pilot` ✓ (default aman ✓).

## Di luar spec ini

- Penyualan ke reseller ✓ (belum ada kebutuhan nyata ✓).
- Kuota per menit (bukan per hari) ✗ (hari cukup untuk sekarang ✓).
- Paket yang的不是├── harga berbeda per jenis perintah ✗ (harga sudah ada di `opera_price_list` ✓).
