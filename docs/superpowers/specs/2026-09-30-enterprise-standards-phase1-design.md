# Enterprise standards Phase 1 design — compliance & security baseline

- Date: 2026-09-30
- Branch: `chore/enterprise-standards-phase-1` (basis `a99978d`, = origin `main`)
- Track: Fase 1 dari 3 (Fase 2 kualitas kode, Fase 3 UI & docs — masing-masing spec sendiri)
- Status: approved by owner (2026-09-30), awaiting spec review before `writing-plans`

## Intended outcome

Repo `opera-agent` lolos review enterprise dari sisi compliance & security
tanpa mengubah perilaku runtime apa pun: lisensi jelas, pelaporan keamanan
jelas, CI punya gate secret/dependency/SBOM, tidak ada secret di repo,
tidak ada nilai environment-specific yang hardcoded tanpa sumber tunggal.

## Constraints (from AGENTS.md)

- CircleCI tetap satu-satunya CI gate kode/test; `.github/workflows/release.yml`
  tetap release automation — tidak ada GitHub Actions test workflow kedua.
- File root baru wajib update allowlist `tests/repo-naming-governance.test.mjs`
  dalam commit yang sama.
- `npm test` dan `npm run check` harus tetap hijau (573/573 baseline).
- Tidak ada secret/token/kunci yang ditulis ke repo dalam bentuk apa pun.

## Scope

### 1. Lisensi & ownership

- Tambah `LICENSE` (MIT, mengikuti klaim `README.md`) + field `license` di
  `package.json` + identifier SPDX di header kebijakan bila ada.
- Tambah `.github/CODEOWNERS` + `SUPPORT.md`.
- Upgrade `SECURITY.md`: supported versions, SLA disclosure, kontak pelaporan.
- **Keputusan terbuka (wajib sebelum eksekusi plan):** nama pemegang hak cipta
  dan tahun di header `LICENSE`. Default usulan: pemilik akun
  `afnannuzulasugihartono`, 2026 — owner konfirmasi saat review spec ini.

### 2. CI gates (di CircleCI yang ada)

- Secret-scan (gitleaks) sebagai job/step baru.
- `npm audit` (tingkat keparahan yang menggagalkan build ditentukan di plan).
- `deno lint` + `deno check` untuk `supabase/functions/`.
- Langkah SBOM (CycloneDX) sebagai artefak, bukan gate keras di Fase 1.

### 3. Secrets & config hygiene

- Tambah `.env.example` mencakup `SUPABASE_URL`, `SERVICE_ROLE_KEY`,
  `OPERA_AGENT_MCP_TOKEN/USER_IDS/EMAILS` (nilai kosong/contoh saja).
- Selesaikan kontradiksi `deno.lock`: tracked di root tapi `/deno.lock`
  di-ignore `.gitignore:3` — putuskan satu (usulan: track, hapus dari ignore).
- Sentralisasi project-ref Supabase (`nenmkmtvjremqphfqnfw`) ke env dengan
  fallback default yang sama — tanpa mengubah perilaku runtime; setiap
  penggantian wajib dijaga oleh test yang sudah ada.
- Perbaiki drift `docs/install.md` (masih `1.6.0`, shipped `1.6.13`).

### 4. Investigasi saja (tanpa fix di Fase 1)

- Diagnosis read-only mengapa SonarCloud Quality Gate merah di semua head R9
  (butuh akses proyek SonarCloud; tidak boleh menebak). Fix-nya Fase 2.

## Non-goals

- Tidak ada perubahan perilaku runtime, skema MCP, protokol, atau SQL.
- Tidak ada perubahan UI (popup/consent) — Fase 3.
- Tidak ada perbaikan temuan Sonar, logging terstruktur, atau hapus
  silent-`catch` — Fase 2.
- Tidak ada rilis, promosi, atau cutover produksi.

## Acceptance

1. `npm test` hijau penuh + `npm run check` ok (26 primitives, versi 1.6.13).
2. Tidak ada file root baru tanpa allowlist naming-test yang diperbarui.
3. Tidak ada workflow test baru di `.github/workflows/`.
4. Tidak ada secret/nilai kredensial di diff (gitleaks hijau).
5. `docs/install.md` konsisten dengan versi shipped.

## Verification plan (for the implementation plan)

- `npm test`, `npm run check`, `git status` bersih per aturan sesi.
- Review diff khusus untuk: lisensi, CI config, `.env.example`, dan
  allowlist naming-test.
