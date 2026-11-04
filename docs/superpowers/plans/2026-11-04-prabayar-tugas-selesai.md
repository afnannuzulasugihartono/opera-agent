# Rencana Implementasi: Prabayar Tugas Selesai (V1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pengguna membayar per pekerjaan selesai dari saldo wallet prabayar (deposit QRIS), dengan alur reserve → settle / refund penuh, tanpa subscription.

**Architecture:** Uang hanya bergerak lewat tabel ledger append-only di Supabase; saldo dihitung sebagai SUM ledger, tidak ada kolom saldo. Edge function `opera-agent-billing` menambah endpoint `wallet/*` dan `task/*` di atas modul `_shared/billing.js` + `_shared/wallet.js` baru. Extension memanggil endpoint itu sebelum dan sesudah task; tidak ada angka uang di client.

**Tech Stack:** Supabase (Postgres migration + Deno edge function), MV3 extension (JS), Midtrans Snap (sudah ada), node:test untuk unit, Deno test untuk edge function.

**Spec:** `docs/superpowers/specs/2026-11-04-prabayar-tugas-selesai-design.md`

## Global Constraints

- Ledger append-only; tidak ada UPDATE/DELETE pada `opera_ledger`. Koreksi = baris `adjust` baru dengan alasan.
- Saldo selalu dihitung server-side dari ledger; client tidak pernah menyimpan saldo.
- Tarif dibaca dari `opera_price_list` (sudah ada), tidak hardcode di client.
- settle/refund idempoten via UNIQUE constraint pada `reservation_id`.
- Hold kedaluwarsa 30 menit → sweep refund otomatis.
- Tidak ada penagihan per aksi/token/menit di mana pun.
- Tidak ada subscription di V1.
- Setiap tugas diakhiri `npm test` hijau dan commit.
- Komentar WHY satu kalimat per aturan bisnis.
- Migrasi dan deploy edge function dilakukan SATU per satu dari main checkout, setelah branch ini merge — tidak dari worktree.

## Review Focus

1. **Double-spend reserve** — dua reserve bersamaan melebihi saldo harus satu sukses satu ditolak; tes palu dua transaksi bersamaan.
2. **Double-settle via retry** — settle yang sama dikirim dua kali (retry jaringan) harus menagih sekali; tes idempotency key.
3. **Hold yatim** — client crash setelah reserve, sebelum settle/refund: sweep harus mengembalikan dana tepat 30 menit.
4. **Client mengubah tarif/saldo** — semua keputusan uang harus dibuktikan server-side; tes menolak input tarif dari client.
5. **Webhook palsu mengkreditkan saldo** — deposit hanya dari notifikasi Midtrans dengan signature valid + amount match; tes dengan signature salah.

---

### Task 1: Migrasi database wallet + ledger + reservations

**Files:**
- Create: `supabase/migrations/20261104120000_opera_wallet.sql`
- Test: `tests/wallet-migration.test.mjs` (assert struktur via ledger-map entry + SQL parse)

- [ ] **Step 1: Tulis tes struktur migrasi (RED)** — parse file SQL, assert tabel/kolom/constraint ada:
  `opera_wallets(user_id PK, currency default 'IDR', created_at)`, `opera_ledger(id PK, wallet_id FK, kind check in ('deposit','reserve_hold','settle','refund','adjust'), amount_cents bigint, ref_type, ref_id, reservation_id nullable unique, created_at)`, `opera_reservations(id PK, wallet_id FK, kind, amount_cents, status check in ('open','settled','refunded','expired'), created_at, expires_at, settled_at nullable)`.
- [ ] **Step 2: Run, lihat gagal (file belum ada).**
- [ ] **Step 3: Tulis migrasi SQL dengan komentar WHY:** ledger tanpa kolom saldo; `reservation_id` UNIQUE di ledger untuk idempotency; RLS: user hanya baca wallet/ledger miliknya sendiri, tulis hanya via edge function (service role).
- [ ] **Step 4: Run tes → hijau.**
- [ ] **Step 5: Update `supabase/migrations/ledger-map.json` sesuai aturan repo, commit.**

### Task 2: Modul bersama `_shared/wallet.js` (pure, bisa di-test)

**Files:**
- Create: `supabase/functions/_shared/wallet.js`
- Test: `tests/wallet.test.mjs`

**Interfaces:**
- Produces: `balanceCents(ledgerRows)` → int (SUM deposit+refund−settle, abaikan reserve_hold); `canReserve(balance, price)` → bool; `classifyPlan(plan)` → `{ mode: 'single'|'batch', chunks: number, estSteps }`; konstanta `ACTION_CAP = 10`, `HOLD_MS = 30*60*1000`; `ledgerKind` enum.

- [ ] **Step 1: Tes RED** — `balanceCents([{kind:'deposit',amount_cents:1000000},{kind:'reserve_hold',amount_cents:50000},{kind:'refund',amount_cents:50000}]) === 1000000`; `classifyPlan({artifact:'list', items:30, estSteps:35})` → `{mode:'batch', chunks:3}`; `classifyPlan({artifact:'single', estSteps:7})` → `{mode:'single'}`; estSteps>10 single → `{mode:'reject'}`.
- [ ] **Step 2: Implementasi minimal.**
- [ ] **Step 3: Hijau, commit.**

### Task 3: Endpoint wallet + task di edge function

**Files:**
- Modify: `supabase/functions/opera-agent-billing/index.ts` (tambah route)
- Create: `supabase/functions/_shared/wallet-api.js` (handler murni, bisa di-test tanpa network)
- Test: `tests/wallet-api.test.mjs` (panggil handler dengan mock supabase client)

**Interfaces:**
- Produces endpoint: `POST /wallet/balance` (auth user), `POST /task/reserve {kind}` → `{reservation_id}` atau 402 `{why:'insufficient'}`, `POST /task/settle {reservation_id, artifact_hash}`, `POST /task/refund {reservation_id, reason}`, webhook notifikasi Midtrans yang sudah ada ditambah cabang: invoice ber-kind `wallet.deposit` → tulis `deposit` ke ledger.
- Kunci baris saat reserve: transaksi `SELECT ... FOR UPDATE` pada wallet row dulu, baru cek saldo, baru insert hold.

- [ ] **Step 1: Tes RED** per Review Focus 1–4 (double-spend, double-settle, hold yatim, tarif dari client ditolak).
- [ ] **Step 2: Implementasi handler + route.**
- [ ] **Step 3: Hijau, commit.**

### Task 4: Sweep hold kedaluwarsa

**Files:**
- Modify: `supabase/functions/opera-agent-billing/index.ts` (tambah `POST /internal/sweep` dipanggil cron/pg_cron; untuk V1 tes panggil manual)
- Test: tambah kasus di `tests/wallet-api.test.mjs`

- [ ] **Step 1: Tes RED** — reservation `open` dengan `expires_at` lewat → refund otomatis, status `expired`.
- [ ] **Step 2: Implementasi, hijau, commit.**

### Task 5: Client extension — reserve/settle/refund di sekitar eksekusi

**Files:**
- Create: `extension/lib/wallet-client.js` (panggil endpoint dengan token sesi; tidak pernah simpan saldo)
- Modify: titik eksekusi task di extension worker (bungkus: reserve → jalan → settle/refund)
- Test: `tests/wallet-client.test.mjs` (mock fetch)

- [ ] **Step 1: Tes RED** — reserve gagal (402) → task tidak jalan; settle idempoten.
- [ ] **Step 2: Implementasi, hijau, commit.**

### Task 6: Dashboard — saldo + riwayat + isi ulang

**Files:**
- Modify: `landing/dashboard.html` + `landing/dashboard.css` (panel baru "Saldo")
- Test: `tests/landing-dashboard.test.mjs` (tambah: panel saldo menampilkan saldo dari server, riwayat ledger, tombol isi ulang)

- [ ] **Step 1: Tes RED, step 2: implementasi, step 3: hijau, commit.**

### Task 7: Halaman harga di situs (copy sederhana)

**Files:**
- Modify: `landing/beranda.html` / halaman baru `landing/harga.html` (nav sudah punya `/harga`)
- Test: `tests/landing-*.test.mjs` (copy: deposit Rp10.000, bayar per pekerjaan selesai, gagal = gratis)

- [ ] **Step 1–3 seperti biasa, commit.**

### Task 8: Verifikasi penuh

- [ ] `npm test` hijau semua, `npm run check`, formatter, `py tests/browser_extension_test.py` exit 0.
- [ ] Commit akhir; push branch; buat PR dengan template repo.
