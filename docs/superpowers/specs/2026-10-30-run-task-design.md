@last-edited: 2026-10-30 UTC+7.
@title: run_task — satu panggilan berbentuk task bahasa natural di surface cloud, di-compile dan dijalankan oleh device.
@state: disetujui sebagai arah pada 2026-10-30; spec ini belum membangun apa pun, ia memutuskan bentuk, batas, dan urutan sebelum kode disentuh.
@dependencies: none.
@related: [AGENTS.md](../../../AGENTS.md) - [security.md](../../security.md) - [api.md](../../api.md) - [reverse-engineering-browser-agents.md](../../reverse-engineering-browser-agents.md) - [superpowers/specs/2026-10-23-local-run-task-design.md](2026-10-23-local-run-task-design.md) - [product/browser-latency.md](../../product/browser-latency.md) - [naming.md](../../naming.md)

# Spec: `run_task` — task dalam bahasa natural, satu panggilan MCP

## Intent

Hari ini surface cloud menjual **verba** (`read_page`, `click_element`, …) dan
workflow yang sudah dikode (`run_workflow`, mis. `youtube.skip_ads`). Pemanggil
harus menyusun sendiri observe → decide → act → verify untuk setiap task.

`run_task` menutup itu: pemanggil cukup menyebut satu task dalam bahasa natural,
lalu device meng-compile task itu menjadi program atau graph, menjalankannya di
atas primitif generic, memverifikasi hasilnya, dan mengembalikan artefak plus
jejak per node. "Bukan hard coded" berarti: tidak ada workflow baru per situs
untuk task baru — task baru cukup task baru.

Keputusan yang sudah disetujui pada 2026-10-30:

- **Pintu masuk dulu di MCP (A), chat UI menyusul (B).** v1 adalah satu tool
  `run_task` di surface cloud; kotak chat di extension/landing menyusul setelah
  A terbukti pada task nyata.
- **Dua jalur, model yang memilih (C).** Model device-local mengembalikan
  `mode: "read"` (program VM read-only, jalur `run_program`) atau
  `mode: "write"` (graph adhoc, jalur `run_adhoc` dengan confirm).
- **Satu panggilan model per task, oleh device itu sendiri** — dikunci oleh
  [security.md](../../security.md): model key tidak pernah keluar dari device.

## Non-goals

- Tidak ada primitif browser baru yang spesifik situs, dan tidak ada `eval`
  bebas di extension — ever (AGENTS.md).
- Tidak mengubah transport socket yang sudah ada; push langsung saat enqueue
  adalah task terpisah (Tahap 3).
- Tidak menyentuh surface lokal (`run_task` graph lokal pada spec 2026-10-23
  tetap berlaku untuknya sendiri).
- Tidak ada kode per-situs di mana pun; hasil RE kemarin justru menunjukkan
  83 tool adalah beban kognitif, bukan kekuatan.

## Fakta terverifikasi

### Mesin yang sudah ada dan bisa dipakai apa adanya

- `extension/lib/goal-plan.js` — prompt + compiler murni: model text → program
  ter-segel, dengan gate allowlist 31 primitif, larangan field milik pemanggil,
  dan budget kedalaman/jumlah command. Sudah teruji dari Node.
- `extension/lib/model-client.js` — `composeModelPlan`: satu panggilan model ke
  endpoint owner, SSE di-assemble, JSON polos diterima juga; `MODEL_NOT_CONFIGURED`
  ditolak sebelum ada network. `fetchImpl` bisa di-inject untuk tes.
- `supabase/functions/_shared/adhoc-compile.js` — compiler murni graph tulis
  (`command`, `if`, `repeat`, `foreach`, `set`, `wait`, `fail`) dengan
  `CONSEQUENTIAL_LABEL` dan cap node/byte.
- Jalur eksekusi yang sudah ada: `run_program` (VM read-only via `callVmHost`)
  dan `run_adhoc` (register adhoc.* → start → poll → delete via RPC
  `opera_register_ephemeral_workflow` / `opera_start_workflow` /
  `opera_get_workflow_run` / `opera_delete_workflow`).
- `skill_save` / `skill_recall` (RPC `opera_skill_save` …) sebagai memori
  pelajaran bersama.
- Transport: satu WebSocket, tanpa polling; insert-to-claim terukur 24–297 ms
  setelah claim poll 100 ms (RPC 0.30 ms di server).

### Pelajaran dari reverse engineering Playwright & Browser Use

Tercatat lengkap di [reverse-engineering-browser-agents.md](../../reverse-engineering-browser-agents.md).
Yang diadopsi: verifikasi sebagai kelas pertama (di kita: klausa `verify` dari
model lalu dibaca ulang via `page.find`/`page.read`); ref dari snapshot, bukan
koordinat; observasi ter-cap (`buildPlanRequest`: goal ≤ 1200 char, teks halaman
≤ 1200 char, ≤ 40 elemen); budget per langkah; loop detection; skills yang
disuntik ke prompt. Yang ditinggalkan: screenshot vision per langkah, 83 tool,
segala bentuk eval.

### Keputusan bahasa

Tetap **JavaScript/TypeScript**. Extension MV3 dan edge Deno mengwajibkan satu
runtime; wire sudah JSON (frame `command`/`complete`) dan DSL program adalah JSON
murni, sehingga harness berbahasa apa pun (Python, .NET, Java) bisa compile
program lalu sekadar enqueue — tanpa ada kode bahasa lain di repo ini.

## Arsitektur

```
MCP caller → run_task { task, tabId?, confirm?, requestId, timeoutMs }
  → server (opera-agent-mcp): validasi input + idempotency via requestId
  → enqueue satu command "task.run" { task, tabId, confirm, requestId } ke device
  → DEVICE:
      1. recall skill lessons yang cocok (via bridge RPC) → disuntik ke goal
      2. buildPlanRequest: goal = task + lessons, page = observasi ter-cap
      3. SATU model call ke endpoint owner (model-client.js)
      4. model menjawab { mode, program|graph, verify }
      5. gate device-local: compileGoalPlan (read) / compileAdhocGraph (write)
      6. eksekusi: read → VM program; write → adhoc.* ephemeral workflow
      7. verify: klausa "berhasil" dibaca ulang via page.find/page.read
      8. hasil + pelajaran → jawaban + skill_save (sekali, generic saja)
  ← { ok, status, mode, trace: [{ node, ok, why }], verify: { ok, evidence } }
```

Server hanya relay; semua keputusan dan model call terjadi di device.

## Skema tool

```jsonc
run_task({
  task: string,          // ≤ 1200 karakter, bahasa natural
  tabId?: number,        // default: tab aktif yang didorong
  confirm?: boolean,     // wajib true untuk mode write
  requestId: string,     // idempotency, pola /^[A-Za-z0-9_-]{1,100}$/
  timeoutMs?: number     // default 60000, max 120000
})
// → { ok, status, mode: "read"|"write", runId?,
//     trace: [{ node, ok, why }], verify: { ok, evidence }, lessonSaved }
```

## Gerbang pengaman (masing-masing dengan tesnya)

- **Allowlist tidak melebar**: 31 primitif; method di luar ditolak sebelum
  browser disentuh. Tidak ada eval.
- **Write butuh konfirmasi**: tool menolak `mode: "write"` tanpa `confirm: true`;
  node konsekuensial (bayar/hapus/kirim/bagi) mengikuti pola
  `CONSEQUENTIAL_LABEL` yang sudah ada.
- **Satu tab**, budget kedalaman/jumlah command/timeout dijepit dari angka yang
  sudah ada (bukan ditemukan baru).
- **Idempotency** via `requestId`; `MODEL_NOT_CONFIGURED` ditolak sebelum network.
- **Tanpa kode per-situs** — dijaga `tests/no-site-code.test.mjs`.

## Kontrol penuh untuk situs complex

Tangga rung generik yang dipilih otomatis oleh `surface_profile` (terukur 42 ms
pada Google Docs asli): `a11y → DOM → select-all → vision`. Canvas/WebGL dikendalikan
lewat `page.pointer` (koordinat) dengan gate `allowCaretMove` untuk caret; ref
membawa geometry + mutationVersion saat mint dan re-find saat stale. Tidak ada
jalan pintas eval.

## Latensi (tuas yang dipakai, bukan diklaim)

| Tuas | Status | Angka terukur |
|---|---|---|
| Socket tanpa polling, claim poll 100 ms | sudah | insert-to-claim 24–297 ms |
| `run_task` = satu command untuk N langkah | Tahap 1 | job 3 langkah 456.94 ms (3 call) → 1 call; burst 3 langkah 76.83 ms |
| Satu model call di device per task | sudah ada mesinnya | tanpa hop tambahan |
| Verifikasi via ref, bukan baca ulang halaman | sudah ada | — |
| Push langsung saat enqueue (hilangkan kaki change-channel) | **Tahap 3, task terpisah** | api.md menamai ini "the next thing to attack" |
| Jalur CDP lokal bila di mesin yang sama | sudah ada | 23–42 ms |

## Tahap

1. **Tahap 1 — tool + jalur read.** `run_task` di MCP, compile device-local,
   jalur VM read-only, verify, trace. Terbukti pada satu job nyata.
2. **Tahap 2 — jalur write.** Graph adhoc dengan `confirm: true` dan
   `CONSEQUENTIAL_LABEL`; dimulai setelah Tahap 1 terbukti.
3. **Tahap 3 — push langsung saat enqueue** di bridge (task terpisah; transport
   tidak diubah-ubah).
4. **Tahap 4 — chat UI (B)** di extension/landing setelah A terbukti.

## Pengujian (semua di `npm test`, tanpa browser hidup)

- Skema ditolak sebelum browser disentuh: task > 1200 char, requestId tidak
  valid, write tanpa confirm.
- Gate: method di luar allowlist, field milik pemanggil, budget terlampaui,
  `MODEL_NOT_CONFIGURED` sebelum network.
- Pembagian jalur: model mock (fetchImpl ter-inject) memilih read/write dengan
  benar; compile refusal mengembalikan kode dan tidak mendaftarkan apa pun.
- Verify: klausa berhasil dibaca ulang, pass/fail dilaporkan dengan evidence.
- Idempotency: requestId yang sama tidak menjalankan dua kali.
- Integrasi end-to-end dengan model mock: satu task kecil selesai penuh.

## Risiko

- **Kosakata bocor**: node graph tidak boleh mencampur nama lokal dan method
  bertitik (lihat [naming.md](../../naming.md)).
- **Jalur write mendahului jalur read**: Tahap 2 tanpa bukti Tahap 1 adalah
  cara tercepat membuat kegagalan yang tidak bisa dilacak.
- **`run_task` menjadi surface baru yang besar**: cap dan allowlist yang dijaga
  tes adalah satu-satunya pengekang.
- **Klaim latensi tanpa angka**: setiap klaim "lebih cepat" harus muncul sebagai
  p50 pada job yang sama sebelum dan sesudah, bukan perasaan.
