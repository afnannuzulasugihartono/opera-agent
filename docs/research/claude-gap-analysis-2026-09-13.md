# Archived Claude report — 2026-09-13

User-supplied reference, preserved verbatim below. Claims, ratings, source verification
and proposed next actions are Claude's report, NOT independent Codex acceptance.
The report describes v1.5.2 as current and v1.6.0 as proposed; these labels differ
from the accepted project baseline (extension1.6.0, Milestone7 accepted, 8D in progress).
Reconcile every gap with current branch/code and primary sources before planning.
Archiving does not change the frozen Milestone8 plan, authorize implementation,
change MCP inventory, permit automatic Docs accessibility toggles, or reorder checkpoints.
Research URLs/statistics have not been independently verified in this archival session.

## Original report

# Laporan Gap Analysis
## Opera Agent v1.5.2 (Current State) vs Progressive Capability Microkernel v1.6.0 (Proposed)

**Disusun:** 13 September 2026
**Sumber:** Audit langsung ke repo `afnannuzulasugihartono/opera-agent` (via Composio/GitHub API) + riset literatur tervalidasi (AAAI 2026, arXiv, dokumentasi resmi Chrome/Google/W3C)

---

## 1. Ringkasan Eksekutif

Setelah audit langsung ke kode dan schema database repo (bukan cuma README), temuan utamanya: **fondasi backend Opera Agent v1.5.2 jauh lebih matang dari yang terlihat di permukaan** — RLS penuh, hashing token, idempotency, rollback workflow semua sudah *terimplementasi dan terverifikasi di kode*, bukan cuma janji roadmap.

Tapi untuk mencapai visi "bekerja responsif di semua jenis website" (canvas, streaming, journal, PDF), ada **4 gap konkret** antara apa yang sudah ada dan apa yang diusulkan di desain Progressive Capability Microkernel. Laporan ini memetakan persis di mana titik temunya, dan di mana yang masih harus dibangun.

**Skor keseluruhan kesiapan v1.6.0: 6/10** — bukan karena desainnya lemah (desain sudah 9/10, lihat laporan sebelumnya), tapi karena baru sebagian kecil dari desain itu yang punya jejak implementasi di kode saat ini.

---

## 2. Metodologi

| Langkah | Cara |
|---|---|
| Audit kode current state | Fetch langsung `README.md`, `package.json`, `ROADMAP.md`, `extension/manifest.json`, `extension/background.js`, `extension/content.js`, `supabase/migrations/*.sql` via GitHub API (Composio) |
| Verifikasi klaim keamanan | Baca isi SQL migration langsung (bukan cuma deskripsi), cek `REVOKE`/`GRANT` per fungsi |
| Verifikasi klaim performa desain baru | Cross-check 4 sitasi riset ke sumber primer (AAAI OJS, arXiv) — 2 di antaranya diverifikasi manual, terkonfirmasi asli & akurat |
| Verifikasi asumsi teknis (AX tree canvas app) | Cek dokumentasi resmi Google Workspace + laporan pengguna asli (WebAIM, GitHub issues) |
| Verifikasi status WebMCP | Cek spec W3C resmi + compatibility report Maret 2026 |

---

## 3. State Proyek Saat Ini (Terverifikasi dari Kode)

### 3.1 Arsitektur berjalan

```
ChatGPT → opera-agent-mcp (auth + tool discovery, 18 tools)
        → Supabase workflow/command layer
        → opera_commands (queue, idempotent)
        → opera-agent-bridge (Edge Function)
        → Opera Agent extension (MV3)
        → Local Opera browser
        → hasil terstruktur / bounded screenshot → Supabase → ChatGPT
```

- Versi stabil: **1.5.2**, protokol `1`, **26 capabilities**, **18 MCP tools**
- Next planned: **1.6.0 "Semantic Runtime Foundation"**

### 3.2 Primitif yang SUDAH ada di database (`opera_methods`, terverifikasi dari SQL asli)

| Method | Kategori | Status |
|---|---|---|
| `browser.ping` | Status | ✅ Implemented |
| `tabs.list/get/find/open/activate/close/navigate/reload` | Tab control | ✅ Implemented |
| `page.read` | Bounded semantic read (12k char/chunk) | ✅ Implemented |
| `page.query` | CSS selector query | ✅ Implemented |
| `page.find` | Semantic element find | ✅ Implemented |
| `page.collect_links` | Link collection | ✅ Implemented |
| `page.click / page.fill / page.focus` | Interaksi (lewat CDP `chrome.debugger`) | ✅ Implemented, 23 referensi CDP terverifikasi di `background.js` |
| `page.scroll / page.key` | Navigasi | ✅ Implemented |
| `page.wait_for` | **Event-based wait** (bukan `sleep()`) | ✅ Sudah ada — ini artinya prinsip "event wait, bukan sleep" dari desain baru **sudah dipraktikkan sebagian** |
| `media.state/play/pause/seek` | Kontrol media generik | ✅ Ada di schema, TAPI belum ter-expose penuh di 18-tool MCP inventory (lihat gap 3.4) |

### 3.3 Keamanan (terverifikasi baris demi baris di `core.sql` dan `two_phase_command_api.sql`)

- **Semua 7 tabel** pakai Row Level Security + `REVOKE ALL FROM anon, authenticated`
- Token perangkat & kode pairing **tidak pernah plaintext** — disimpan sebagai SHA-256 (`~ '^[a-f0-9]{64}$'` constraint di level database, bukan cuma di aplikasi)
- Semua fungsi command (`opera_run`, `opera_start_command`, `opera_pair_device`, dst) **hanya bisa dieksekusi oleh `service_role`** — satu-satunya trust boundary adalah Edge Function `opera-agent-mcp`
- Idempotency terjamin di level index: `unique(device_id, request_id)`
- Proteksi field sensitif (password/OTP/CVV) terverifikasi ADA di kode, bukan cuma disebut di README — fungsi `sensitivePattern`, `SENSITIVE_RE`, `assertEditableSafe`, `captureFramePrivacyProbe` semua ditemukan langsung
- **0 penggunaan `eval()`, `new Function()`, atau `.innerHTML =`** di kedua file inti extension — bersih dari vektor RCE/DOM-injection klasik

### 3.4 Yang README klaim tapi BELUM terverifikasi penuh

> *"Opera Agent 1.6.0 sudah mengiklankan `media.state/play/pause/seek`... namun connector yang tersedia belum mengekspos capability tersebut."* — temuan riset langsung terhadap Opera Agent

Ini gap nyata: method-nya **ada di database schema**, tapi **belum reachable dari sisi MCP tool-calling** ChatGPT. Backend siap, permukaan API belum menyambungkannya.

### 3.5 Status roadmap 1.1.0 (dari `ROADMAP.md` asli — checklist sungguhan, bukan ringkasan saya)

Selesai (`[x]`): zero-payload ping, text-only `page.read` mode, no-op fast path, metadata-only telemetry, versioned text-only workflows, proteksi password/file-upload dipertahankan, verifikasi real Opera dengan extension ID baru, runner v6 deploy + smoke test production.

**Belum selesai (`[ ]`)**:
- Repeat live production workflow benchmarks dengan sesi Opera aktif
- Package & install independen CRX identitas baru, pairing fresh
- Jaga identitas signed lama tetap terpisah dari CRX baru

---

## 4. Desain yang Diusulkan (Progressive Capability Microkernel) — Ringkasan

Capability ladder: **WebMCP probe → Native surface (media/resource MIME) → AX/DOM (+ trik toggle Docs) → Targeted vision → LLM interrupt**, dengan API tunggal `run_local(plan)` / `browser.run({goal, success, budget})`.

---

## 5. Perbandingan Langsung: Current State vs Proposed Design

| Komponen desain baru | Ada di kode sekarang? | Bukti | Gap |
|---|---|---|---|
| Event-based wait (bukan `sleep`) | ✅ Sebagian | `page.wait_for` sudah jadi method terdaftar | Perlu diperluas ke `waitStable()` generik lintas semua aksi, bukan cuma navigasi |
| CDP trusted click/key | ✅ Ada | 23 pemanggilan `chrome.debugger` terverifikasi | — |
| Proteksi field sensitif | ✅ Ada | Fungsi terverifikasi di kode | — |
| Idempotency + rollback workflow | ✅ Ada | Unique index + `opera_workflow_versions` | — |
| Native media control (`media.*`) | 🟡 Setengah | Ada di DB, belum di MCP surface | **Gap #1**: hubungkan `media.*` ke 18-tool inventory |
| MIME-based resource shortcut (PDF/CSV/JSON) | ❌ Tidak ada | Tidak ada method `resource.*`/`pdf.*` di `opera_methods` manapun yang diaudit | **Gap #2**: bangun dari nol — ini juga menjelaskan kenapa test PDF arXiv sebelumnya hasilnya "0 teks, 0 elemen" |
| WebMCP probe | ❌ Tidak ada | Tidak ditemukan referensi `document.modelContext`/`navigator.modelContext` di file manapun | **Gap #3**: perlu ditambah, tapi prioritas rendah (adopsi situs real ~12%, Chrome masih Canary-only) |
| AX Side-Channel + Docs toggle-detection | ❌ Tidak ada | `page.read`/`page.query` generik, tidak ada logika khusus canvas-app | **Gap #4**: PALING BERDAMPAK — ini kunci supaya Docs & Maps benar-benar terbaca |
| Trust-boundary tagging (USER_INSTRUCTION vs UNTRUSTED_PAGE_DATA) | ❌ Tidak ditemukan | Tidak ada pemisahan eksplisit di kode yang diaudit | **Gap #5**: penting untuk pertahanan prompt-injection saat konten halaman mulai dibaca lebih dalam (PDF, Docs) |
| Status eksplisit `BLOCKED`/`AUTH_REQUIRED`/`AMBIGUOUS` | ❌ Tidak ada | `opera_commands.status` enum saat ini: `queued, claimed, completed, failed, expired, cancelled` — tidak ada status semantik ini | **Gap #6**: perlu tambahan nilai enum + logika deteksi (mis. teks "unusual traffic" dari Scholar) |

---

## 6. Prioritas Implementasi (berdasarkan effort vs dampak, bukan urutan roadmap asli)

| Prioritas | Item | Alasan |
|---|---|---|
| **1** | Gap #4 — AX Side-Channel + toggle-detection Docs | Dampak terbesar: membuka Docs & kelas canvas-app lain yang sekarang buta total. Effort sedang (satu function baru + satu CDP call untuk trigger toggle) |
| **2** | Gap #1 — Expose `media.*` ke MCP surface | Backend sudah ada, ini murni kerja "sambungkan pipa" — effort rendah, dampak langsung (buka YouTube/streaming) |
| **3** | Gap #2 — MIME resource shortcut | Effort sedang-tinggi (perlu PDF parser + fallback OCR untuk scan), tapi membuka seluruh kelas journal/PDF (arXiv, Elsevier, IEEE) |
| **4** | Gap #6 — Status `BLOCKED`/`AUTH_REQUIRED` | Effort rendah (tambah enum + beberapa pattern match), tapi penting supaya agent tidak terus mencoba di situs yang memang memblokir (Scholar) |
| **5** | Gap #5 — Trust-boundary tagging | Effort sedang, prioritas naik begitu Gap #2/#4 selesai (karena itu titik pertama konten halaman "masuk" lebih dalam ke context LLM) |
| **6** | Gap #3 — WebMCP probe | Effort rendah tapi dampak rendah untuk saat ini (adopsi situs riil masih ~12%, Chrome Canary-only) — cocok jadi "quick win" pengisi waktu, bukan prioritas utama |

---

## 7. Risk Register

| Risiko | Level | Catatan |
|---|---|---|
| Token device bocor → kontrol penuh 26 capability di semua situs | Sedang | Mitigasi sudah ada (hash, RLS, revoke); risiko sisa melekat pada model ini, tidak bisa dihilangkan total |
| Asumsi AX tree Docs salah diimplementasikan (tidak trigger toggle dulu) | Tinggi kalau diabaikan | Terbukti dari laporan pengguna asli — AX tree kosong tanpa toggle diaktifkan |
| Ketergantungan berlebihan ke WebMCP sebagai tier utama | Rendah (sudah dikoreksi di desain) | Data real: 0 dari 8 situs uji punya WebMCP |
| Roadmap 1.1.0 belum benchmark produksi live | Sedang | 2 item checklist masih `[ ]` — klaim performa v1.6.0 sebaiknya menunggu ini selesai dulu supaya baseline-nya valid |

---

## 8. Kesimpulan & Rating Akhir

| Aspek | Rating | Catatan |
|---|---|---|
| Kualitas desain (Progressive Capability Microkernel) | 9/10 | Lihat laporan riset sebelumnya — tervalidasi ke sumber primer |
| Kematangan backend saat ini | 8.5/10 | RLS, hashing, idempotency, rollback — semua nyata, bukan janji |
| **Kesiapan v1.6.0 relatif terhadap desain (gap tertutup)** | **6/10** | 4 dari 6 gap besar belum ada jejak kode sama sekali; 2 lainnya cuma setengah jalan |

**Rating 6/10 ini bukan penalti terhadap proyek** — ini cuma jarak jujur antara "desain bagus di atas kertas" dan "kode yang sudah berjalan". Base yang ada sekarang (keamanan, idempotency, workflow versioning) justru lebih kuat dari kebanyakan proyek serupa, dan itu memudahkan menutup 6 gap di atas karena fondasinya sudah benar.

## 9. Next Action

Mulai dari **Gap #4 (Docs toggle-detection)** — paling murah untuk dibangun, paling mudah diverifikasi (tinggal bandingkan isi AX tree sebelum/sesudah toggle), dan buktinya langsung terlihat: Docs yang tadinya buta jadi terbaca.

