# Spesifikasi: Plan habis terlihat di tools + rebuild dashboard

@last-edited: 2026-11-09 UTC+7.
@related: [AGENTS.md](../../../AGENTS.md) - [docs/superpowers/specs/2026-11-08-plans-and-tiers-design.md](2026-11-08-plans-and-tiers-design.md) - [docs/releases/1.6.34.md](../../releases/1.6.34.md) - [docs/api.md](../../api.md)

Semua keputusan disetujui in-chat pada 2026-11-09. Satu rilis **1.6.35** membawa dua hal yang berbagi satu tokoh: paket langganan akun. Sebelumnya paket habis hanya terlihat setelah ditabrak refusal di tengah kerja; sekarang paketnya **terlihat sebelum ditabrak** — di opencode tools dan di dashboard.

## Intent

- opencode tools dan dashboard: pelanggan tahu sisa kuota hari ini tanpa menabrak refusal; saat refusal terjadi, pesannya 429-style yang menyebut paket, kuota, dan kapan reset (tengah malam UTC).
- Dashboard: halaman yang terlihat seperti produk berbayar untuk pelanggan pilot, sekaligus jujur dan lengkap untuk operator.
- **Kuota, gate, billing, dan wallet tidak diubah.** Yang ditambah hanya cara state paket itu terlihat.

## Perubahan 1: opencode tools — jalan lokal (`local/mcp-server.js`)

`linkedDevices()` saat ini membuang `meter` dari `/health` bridge. Teruskan:

```
devices: [{ name, id, instanceId, extensionVersion, slot, port,
            plan: { plan, allowance, dailyQuota, usedToday, remaining, resetsAt } }]
```

- `browser_status` membawa `planExhausted: true` dan `planExhaustedDevices: [<nama device>]` bila ada device linked dengan `remaining <= 0`.
- `resetsAt` = tengah malam UTC berikutnya (ISO string), dihitung sisi klien MCP.
- Refusal per command tidak berubah (sudah `PLAN_LIMIT_REACHED` dengan nama paket).

## Perubahan 2: opencode tools — jalan hosted (`supabase/functions/opera-agent-mcp`)

Gap nyata: `executeStatus` hanya menggabungkan `planInfo` bila jawaban command **sukses** (`if (answer.isError) return answer`) — persis saat paket habis dan command gagal, info paket justru tidak terlihat.

- `planInfo` (`plan-info.ts`) menambah `planRemaining` (`dailyQuota - planUsed`) dan `planExhausted` (`planUsed >= dailyQuota`).
- `executeStatus` menggabungkan `planInfo` **juga** pada jawaban `isError` (browser_status selalu membawa plan), dan menambah `planRemaining` / `planExhausted` pada kedua jalur.
- Tidak ada perubahan pada gate, kuota, atau `browser.ping`.

## Perubahan 3: Dashboard di-rebuild (`landing/dashboard.html` + `landing/dashboard.css`)

Batas yang disetujui in-chat: **rebuild penuh, evolusi brand situs, app shell (rail + konten), fokus pelanggan — operator dipisah, id+en.**

### Yang dipertahankan

- Statis, vanilla JS, tanpa framework; `site.css` tetap basis; brand situs (latar gelap `#0b0d10`, aksen `#3ecf8e`, mark Opera Agent, tipografi situs, dark-only).
- Semua RPC & alur yang sudah ada: `opera_my_devices`, `opera_my_listen`, `opera_konsol_tables` / `opera_konsol_table` (+ CSV export, editor), `opera_create_pairing_code` / `opera_revoke_my_device` / `opera_run_on_my_device`, billing FK (`opera-agent-billing`), refresh-token auth, i18n id/en, Ctrl-K palette, hash routing.
- Aksesibilitas: `aria-live` status lines, `focus-visible`, `prefers-reduced-motion`, target sentuh jelas.

### Information architecture (rail dua grup)

- **Pelanggan** (default, selalu terlihat): Ringkasan, Device, Riwayat, Aksi, Saldo, Pairing, Akun.
- **Operator** (di belakang disclosure, collapsed by default): Tabel (konsol editor), Dengar. Perilaku persis seperti sekarang; hanya dipindah dan di-de-emphasize.
- Mobile: rail jadi bar tab horizontal di atas konten.

### Ringkasan — tokoh utama: kartu plan

- Plan hero: nama plan, chip status (`active`/`paused`), progress bar `usedToday / dailyQuota`, sisa, allowance sesi, `resetsAt` ("reset besok 00.00 UTC").
- State merah saat ≥ 100%: **"Plan habis — reset besok (UTC)"** + tautan ke `/harga`.
- Kartu plan membaca RPC `opera_my_plan()` (sudah live; mengembalikan plan, status, dailyQuota, usedToday). `resetsAt` dihitung client-side (tengah malam UTC berikutnya).
- Di bawah hero: strip metrik (device ter-pairing, daring sekarang, perintah selesai) dan kartu checklist install — tetap, dipadatkan.

### Yang tidak dikerjakan

- Tidak ada mode/paginasi baru untuk konsol — hanya dipindah ke grup Operator.
- Tidak ada RPC baru, tidak ada table path baru, tidak ada kolom baru.
- Tidak ada perubahan kuota, billing, wallet, atau harga.

## Perubahan 4: Rilis 1.6.35

- Pin versi 1.6.35 di semua sumber (`package.json`, `local/package.json`, `store/store-manifest.json`, `supabase/functions/opera-agent-mcp` bila ter-pin, `docs/releases/1.6.35.md`, `CHANGELOG.md`, `docs/handoff.md`).
- Deploy ulang fungsi `opera-agent-mcp` dari main checkout (satu per satu); dashboard naik ke Pages lewat alur deploy yang sudah ada.
- CRX **tidak** di-sign (extension tidak berubah).
- npm: staging saja — **publish menunggu persetujuan eksplisit**; `opera-agent-mcp@1.6.34` masih menunggu approval di npmjs staged packages.
- Gates: `npm run gates:refresh` dengan alasan; `npm test`, `npm run check`, `py tests/browser_extension_test.py` hijau sebelum merge.

## Testing

- `tests/landing-dashboard.test.mjs` diperbarui untuk bentuk baru (pin panggilan RPC yang sama + `opera_my_plan`).
- Test baru: `planInfo` mengembalikan `planRemaining`/`planExhausted`; `executeStatus` menggabungkan plan pada jalur `isError`; `linkedDevices` meneruskan `meter` (termasuk `resetsAt`).
- Verifikasi live: `browser_status` lokal via stdio MCP menampilkan plan; dashboard di-render di browser (signed-out flow dan struktur); state signed-in diverifikasi user setelah deploy (saya tidak bisa login ke akun user).

## Keputusan yang diambil in-chat

- "Notif plan habis" = **rate limit yang terlihat**, bukan token/credit allowance persisten (wallet tetap seperti sekarang).
- Rebuild penuh dashboard; audiens = operator + pelanggan pilot (keduanya).
- Komposisi = app shell (rail + konten), evolusi brand situs, fokus pelanggan / operator dipisah, id+en.

## Batas yang jujur

- Halaman tetap membaca lewat RPC `opera_*` — tidak ada jalur data baru yang mengubah model keamanan tabel.
- Tanpa sesi signed-in, verifikasi saya terbatas pada test + render signed-out; angka plan/device/tabel hanya bisa diverifikasi oleh akun yang login.
