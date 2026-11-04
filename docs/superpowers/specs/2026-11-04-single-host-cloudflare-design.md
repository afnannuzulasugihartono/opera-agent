@last-edited: 2026-11-04 UTC+7.
@related: [`../../../AGENTS.md`](../../../AGENTS.md) - [`../../handoff.md`](../../handoff.md)

# Spec: Satu host — Cloudflare Pages saja

Disetujui sebagai arah pada 2026-11-04. Spec ini mencabut status Vercel sebagai
host kedua dari situs; ia tidak mengubah isi halaman, token visual, copy, atau
perilaku runtime apa pun.

## Intent

Situs dilayani oleh dua host yang dikonfigurasi di dua file berbeda:
`landing/vercel.json` (15 path) dan `landing/_headers` (cerminannya). Setiap
perubahan header harus ditulis dua kali, dan tes `landing-hosting` ada semata
untuk memastikan keduanya tidak drift. Vercel account yang memegang deploy
itu diblokir, jadi backup tersebut sudah mati secara de facto: setiap push
baru hanya bisa live lewat Cloudflare Pages via workflow `deploy-site.yml`.

Target keberhasilan yang dapat diukur:

- Tidak ada file bernama `vercel` di repo kecuali riwayat git: tidak ada
  `landing/vercel.json`, `landing/.vercelignore`, sebutan di `.gitignore`,
  `.assetsignore`, `docs/handoff.md`, atau komentar HTML.
- `landing/_headers` adalah satu-satunya sumber header. Setiap path situs
  tercakup, dan tidak ada wildcard.
- `npm test` hijau dengan nol referensi ke `vercel.json` di luar satu tes yang
  secara eksplisit menegaskan file itu sudah tidak ada.
- Domain `opera-agent.vercel.app` tidak muncul di CORS, redirect, atau contoh
  mana pun. Link instalasi lama yang menunjuk ke sana gagal total — itu
  konsekuensi yang disetujui pemilik, bukan regresi yang belum diputuskan.
- Deploy tetap lewat `deploy-site.yml` (`wrangler pages deploy`), tidak berubah.

## Non-goals

- Tidak ada perubahan pada isi halaman, stylesheet, skrip, atau dict i18n.
- Tidak ada perubahan pada `_worker.js` (invoice proxy), kecuali bila tes
  menuntut penyesuaian komentar yang menyebut Vercel.
- Tidak ada perubahan pada perilaku `deploy-site.yml` selain menghapus
  apa pun yang menyebut Vercel bila ada.
- Tidak ada migrasi data, tidak ada perubahan Supabase selain menghapus
  domain dari daftar redirect dan CORS.

## Tes

`tests/landing-hosting.test.mjs` ditulis ulang:

| Bukti lama | Bukti baru |
|---|---|
| Setiap `_headers` restates `vercel.json` entry verbatim | Setiap path yang strukturnya sama (mis. `/beranda` dan `/beranda.html`) membawa header yang sama; tidak ada perbandingan antar-file |
| `vercel.json names no versioned archive` | `_headers` names no versioned archive |
| `both hosts upload the same file set` (`.vercelignore` vs `.assetsignore`) | Hanya `.assetsignore` yang berlaku; tidak ada `.vercelignore` untuk dibandingkan |
| `git auto-deployment is off`, `framework null`, `buildCommand null`, `cleanUrls`, `outputDirectory` | Dihapus; itu klaim tentang file yang tidak ada lagi |
| `the site is reachable at the path GoTrue asks for` membaca `vercel.headers` | Membaca `_headers` yang di-parse |

Semua pembaca `vercel.headers` di `landing-auth`, `landing-dashboard`,
`landing-page`, `landing-not-found`, `landing-unduh-hub`,
`landing-unduhswap`, dan `mcp-surface` dialihkan ke parse `_headers` dengan
struktur match yang sama. Ditambah satu tes baru: `vercel.json` tidak ada di
`landing/` dan tidak ada sebutan `vercel.app` di luar riwayat dan komentar
penjelasan penghapusan ini.

## Urutan kerja

1. Baca `vercel.json` dan catat setiap path + header yang harus tetap ada
   di `_headers` (tidak boleh ada klaim yang hilang dalam pemindahan).
2. Hapus `vercel.json`, `.vercelignore`, sebutan `.vercel` di `.gitignore`
   dan `.assetsignore`, komentar `404.html`, dan kalimat handoff.
3. Cabut `opera-agent.vercel.app` dari `config.toml`, `_shared/cors.js`,
   dan `extension/` bila disebut.
4. Tulis ulang `landing-hosting.test.mjs` menurut tabel di atas.
5. Alihkan semua pembaca `vercel.headers` ke parse `_headers`.
6. `npm test`, `npm run check`, formatter, gate Python.
7. Verifikasi di Cloudflare: header `content-security-policy` dan
   `strict-transport-security` pada `/beranda` live sama dengan yang
   `_headers` nyatakan.

## Risiko

- **CSP per path adalah klaim keamanan yang dikunci hash.** Setiap script
  inline diuji hash-nya melawan file. Pemindahan murni mekanis; tidak ada
  nilai header yang berubah, hanya rumahnya.
- **`_headers` Cloudflare tidak mengenal `Vercel-CDN-Cache-Control`.**
  Baris itu tetap ada per path sebagai no-op dokumentatif, atau dihapus
  dengan alasan tercatat. Keputusan: dipertahankan — menghapusnya mengubah
  bytes yang diawasi tes drift, dan baris yang tidak dikenal diabaikan
  Cloudflare tanpa efek.
- **Link instalasi lama mati.** Diterima pemilik pada 2026-11-04.
