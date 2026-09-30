# Enterprise quality Phase 2 design — code quality baseline

- Date: 2026-09-30
- Branch: `chore/enterprise-standards-phase-1` (continues as the single
  enterprise track; Fase 1 chapters stay in history, tip `4bf7a64`).
  Rationale: Fase 2 builds directly on unmerged Fase 1 gates; a stacked
  branch would create two divergent lines against the one-active-branch
  rule. The branch merges to `main` once CI is green.
- Basis: Fase 1 punch list (`e3221a7` trailer), Task 7/8 evidence,
  owner-approved sections A–D (2026-09-30).
- Status: approved by owner, awaiting spec review before `writing-plans`.

## Intended outcome

`deno lint` + `deno check` hijau, CI hijau penuh, setiap catch yang bisu
tercatat dengan konteks, log edge functions terstruktur, dan temuan Sonar
dikejar sampai diagnosis per-issue atau dinding akses yang tercatat —
semuanya tanpa mengubah perilaku runtime yang sudah diuji.

## Constraints (from AGENTS.md + Fase 1)

- Evidence-first repair loop untuk setiap bug: reproduksi, hipotesis
  falsifiable, regression test gagal-dulu, fix generik terkecil.
- Fallback yang sudah diuji (JSON.parse→default, `check(..., false)`,
  `candidates = []`, boolean probes) TIDAK dihapus — hanya ditambah log.
- `npm test` dan `npm run check` tetap hijau setiap commit.
- Tidak ada GitHub Actions test workflow; tidak ada secret ke repo.
- Satu penulis per checkout; tidak ada sesi kotor/diverged.

## Scope

### A. Deno-hijau (merge blocker)

- Fix SyntaxError `supabase/functions/opera-agent-mcp/index.ts:372`
  (unescaped quotes di instructions string; controller-verified via node
  import parse `Expected ',', got 'a'`): escape value-preserving `\"`
  + regression test yang mem-parse modul (gagal sebelum fix).
- 63 `no-explicit-any`: ketik eksplisit per fungsi; bila satu `any`
  menuntut redesign, catat danparsialkan — tidak ada `any` baru.
- 5 `require-await`, 4 `no-unused-vars`: perbaiki langsung.
- 5 `deno check`: gateway TS2339 (:208), ledger TS2353+TS18048
  (:159-160), vm TS2345 (:506), auth `npm:openai` resolution
  (import-map entry atau drop direct edge-runtime.d.ts import —
  putuskan saat implementasi dengan bukti).
- Kriteria: `deno lint supabase/functions/` dan loop `deno check
  --no-lock` per fungsi exit 0, lokal maupun CI.

### B. Logger extension + silent-catch (33 titik)

- Modul logger bersama baru di `extension/lib/` (satu tanggung jawab):
  level (`debug`/`warn`/`error`), korelasi `commandId` dari completion
  path (`extension/background.js:1461`), ring buffer in-memory maks 200
  entri, output console untuk devtools. Tanpa storage schema, tanpa UI,
  tanpa permukaan MCP baru.
- Klasifikasi 33 titik `catch` (`background.js`, `content.js`,
  `protocol.js:232`, `semantic-identity.js:34`, `popup.js:16`):
  fallback-teruji → pertahankan + `logger.debug` berkonteks;
  swallow murni (debugger detach, focus emulation, getZoom, tab lookup)
  → `logger.warn` berkonteks. Tidak ada aliran yang berubah.
- Regression test: capture log menegaskan tiap titik mencatat dengan
  konteks yang benar; semua test lama tetap hijau.

### C. Log edge functions terstruktur

- Helper bersama di `supabase/functions/_shared/` (level, commandId,
  pemotongan eksplisit menggantikan `slice(0,500)` ad-hoc) dipakai oleh
  bridge, runner, mcp. Payload dan status tidak berubah.
- Regression test per helper: format, level routing, truncation bound.

### D. Sonar (time-boxed)

- Kondisi gagal diketahui: C Reliability Rating on New Code (butuh ≥ A).
- Kejar temuan per-issue bila akses SonarCloud didapat; bila tetap
  buntu setelah upaya tercatat, tutup sebagai `BLOCKED: needs SonarCloud
  project access` seperti Fase 1 — tanpa tebak-tebakan.
- Risiko tercatat: dinding akses yang sama seperti Task 8.

## Non-goals

- Tanpa UI baru (popup/options), tanpa permukaan MCP baru, tanpa rilis,
  tanpa promosi/produksi, tanpa redesign arsitektur logger (sink
  agregasi eksternal adalah Fase 3 bila diminta).

## Acceptance

1. CircleCI `ci` hijau pada exact head (termasuk gate deno), Vercel sukses.
2. `npm test` penuh + `npm run check` ok.
3. Tidak ada fallback teruji yang dihapus; tidak ada perilaku berubah
   tanpa regression test.
4. Sonar: hijau, atau dinding-akses tercatat dengan upaya terbukti.
5. Branch tetap satu-satunya line enterprise; merge ke `main` hanya
  setelah 1–4 terpenuhi (keputusan owner terpisah).
