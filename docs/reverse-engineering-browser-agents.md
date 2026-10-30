@last-edited: 2026-10-30 UTC+7.
@title: reverse-engineering-browser-agents — apa yang dipelajari dari membedah Playwright dan Browser Use.
@state: dua target (Playwright MCP ter-ship dan Browser Use agent loop) dibedah dengan metodologi REA; temuan dipetakan ke desain run_task.
@dependencies: none.
@related: [AGENTS.md](../AGENTS.md) - [design-references.md](design-references.md) - [superpowers/specs/2026-10-23-local-run-task-design.md](superpowers/specs/2026-10-23-local-run-task-design.md)

# Reverse engineering Playwright dan Browser Use

Dua produk agent browser dibedah untuk mengambil pola yang terbukti, bukan untuk
menyalin kodenya. Metodologinya dari repo [morluto/rea](https://github.com/morluto/rea)
(Reverse Engineer Anything, dipasang sebagai plugin MCP di OpenCode, di-pin ke
`rea-agents@6.8.0` — versi yang sama dengan pin plugin resmi): loop enam langkah
(name it → fingerprint → pick a layer → inspect → extract → rebuild), static
dulu, dan setiap kesimpulan membedakan observasi, inferensi, dan unknown dengan
Evidence ID.

## Target dan lapisan

| Target | Lapisan yang dibedah | Artefak |
|---|---|---|
| Playwright MCP | paket npm ter-ship (`playwright-core@1.64.1`, `coreBundle.js`) + source `main` | 83 nama tool `browser_*` ditemukan di bundle; dianalisis dengan `rea analyze_javascript_application` (evidence `ev_7108c1be…`, `ev_bd6dc116…`) |
| Browser Use | source `browser_use/agent/service.py`, `agent/prompts.py`, `agent/views.py` (main) | loop agent, prompt per langkah, skema output terstruktur |

Catatan metodologi: kedua target adalah source terbuka, jadi pembacaan source
adalah lapisan yang benar; REA dipakai untuk memverifikasi artefak ter-ship dan
menguji bahwa plugin berfungsi. Bundle besar melebihi budget respons MCP REA
(seperti yang ia laporkan sendiri), jadi pembacaan bundle dilakukan langsung.

## Temuan: Playwright MCP (permukaan tool)

- **83 tool `browser_*`** dalam satu bundle: navigasi, klik/tipe/hover/drag,
  snapshot a11y, network, storage, dialog, pdf, video, tracing.
- **Keluarga verifikasi eksplisit**: `browser_verify_element_visible`,
  `browser_verify_list_visible`, `browser_verify_text_visible`,
  `browser_verify_value` — verifikasi adalah tool kelas pertama, bukan
  afterthought.
- **Ref berbasis snapshot**: `browser_snapshot` mengembalikan pohon a11y dan
  aksi menunjuk ref dari snapshot itu, bukan koordinat.
- **Kekuatan berbahaya diberi nama jujur**: `browser_run_code_unsafe` — nama itu
  sendiri adalah peringatan; tidak ada eval yang disamarkan.
- `browser_find` + `browser_click` dipisah: temukan dulu, klik dengan ref.

## Temuan: Browser Use (loop agent)

- **Output terstruktur per langkah**: `AgentOutput` berisi `current_state`
  {thinking, evaluation_previous_goal, memory, next_goal} plus `action[]`
  (maks `max_actions_per_step`, default 3-5). Model mengevaluasi langkah
  sebelumnya **setiap langkah** — itulah loop verifikasi.
- **Satu user message per langkah dengan blok bertag**: `<user_request>`,
  `<agent_history>`, `<agent_state>` (todo, plan, sensitive_data),
  `<browser_state>` (page_stats, tabs, elemen interaktif ber-ref, dipotong pada
  40.000 karakter), `<step_info>` (nomor langkah + tanggal di ekor supaya prefix
  bisa di-cache), plus screenshot sebagai gambar bila vision aktif.
- **Ref elemen, bukan koordinat**, kecuali model tertentu yang memang mendukung
  klik koordinat.
- **Kendali loop**: `max_failures` 5, loop detection window 20, message
  compaction, judge untuk penilaian akhir, planning dengan replan-on-stall 3.
- **Skills dan sensitive_data disuntikkan ke prompt**, dengan `allowed_domains`
  sebagai pagar; tanpa itu ia memperingatkan soal prompt injection.

## Yang diadopsi untuk `run_task` kita

| Pola dari Playwright/Browser Use | Keputusan untuk run_task |
|---|---|
| Verifikasi sebagai tool/ primitif kelas pertama | klausa `verify` dari model dibaca ulang oleh device sebagai `page.find`/`page.read` — sudah ada di allowlist |
| Ref dari snapshot, bukan koordinat | sudah kita punya (action refs + `refFromStep`) |
| `evaluation_previous_goal` tiap langkah | trace per node + status parsial yang jujur, bukan error buta |
| Batas elemen per observasi (40k char) | sudah ada: `buildPlanRequest` menutup 1200 char teks + 40 elemen |
| max_actions_per_step | budget command kita (depth, jumlah command, timeout) |
| Loop detection + max_failures | sudah ada di VM/runner (BURST_MAX_STEPS, deadline) |
| Skills disuntik ke prompt | `skill_recall` sudah ada; run_task menyuntikkan pelajaran yang cocok ke goal |
| Penamaan jujur untuk kekuatan berbahaya | tidak ada `run_code_unsafe` di kita; allowlist tetap 31 primitif, tanpa eval |

## Yang sengaja ditinggalkan

- Screenshot sebagai input vision per langkah: mahal dan tidak deterministik;
  kita pakai pembacaan a11y/DOM terstruktur (ladder a11y → dom → select-all → vision
  sudah ada di `surface_profile`).
- 83 tool: kita sengaja tetap pada 31 primitif generic; banyaknya tool adalah
  beban kognitif model, bukan kekuatan.
- `run_code_unsafe`/eval dalam bentuk apa pun: ditolak.

## Ledger evidence

- `ev_7108c1be…` — analisis paket `@playwright/mcp` (5 file, 4 JS, 17 findings).
- `ev_bd6dc116…` — analisis `coreBundle.js` playwright-core (selesai, melapor
  budget respons MCP 10 MiB — response tidak terpotong, dikonsumsi lewat pembacaan
  langsung atas bundle).
- Source: `microsoft/playwright@main` (sparse), `browser-use/browser-use@main`,
  `morluto/rea@6.8.0` (plugin MCP, 229 tool).
