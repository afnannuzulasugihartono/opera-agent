@last-edited: 2026-10-26 UTC+7.
@related: [`../../../AGENTS.md`](../../../AGENTS.md) - [`../../handoff.md`](../../handoff.md) - [`../../design-references.md`](../../design-references.md)

# Spec: Situs kelas Cohere — bahasa visual terang, sedikit kata, CTA di depan

Disetujui sebagai arah pada 2026-10-26, direvisi atas umpan balik pemilik pada
hari yang sama: pembaca tidak membaca paragraf, mereka menekan tombol. Spec ini
belum menyentuh kode; ia memutuskan bentuk, batas, dan urutan langkah.

## Intent

Situs publik sudah benar secara teknis: CSP memuat aset sendiri, angka cocok
dengan kode, Lighthouse accessibility 1. Yang belum cocok adalah kelasnya.
Tema gelap, paragraf panjang, dan aksen neon terasa seperti dokumentasi teknis.

Spesifikasi ini memindahkan seluruh situs publik ke bahasa visual terang kelas
korporat, dengan Cohere sebagai patokan ukuran (diukur, bukan disalin), dan
satu aturan copy baru: **satu headline, satu baris, satu tombol atau satu
gambar per section.**

Target keberhasilan yang dapat diukur:

- Satu sistem token (`site.css`) untuk 12 halaman; tidak ada warna, radius, atau
  ukuran huruf ad hoc di markup halaman.
- Kontras setiap pasangan teks/latar di token minimal 4.5:1, diuji otomatis.
- `beranda.html` punya tepat satu `h1`, hero dua kolom dengan mock UI berlabel
  "Contoh", dan section id `#install`, `#model`, `#signin`, `#privacy`,
  `#faq` masih ada.
- Tidak ada paragraf pemasaran lebih dari 2 baris (≈ 25 kata) di luar halaman
  hukum; tes menolaknya.
- Lighthouse accessibility dan best-practices tetap 1 di `/beranda` dan `/`.
- Tidak ada aset eksternal: satu file font lokal (woff2 subset latin),
  `font-src 'self'` di setiap policy, `img-src` tetap `data:`.
- `npm test`, `npm run check`, formatter, gitleaks, gate browser Python hijau
  di setiap fase; SonarCloud hijau di PR.
- Tidak ada klaim baru: angka tetap dibaca dari kode oleh tes yang ada, tanpa
  logo pelanggan atau metrik palsu.

## Status implementasi (2026-10-26)

Fondasi dan seluruh 12 halaman sudah memakai sistem ini.

- `landing/site.css` memuat token, `@font-face` Instrument Sans, chrome, footer,
  section, kartu, tombol, tabel, dan prose. Lembar halaman hanya menambah aturan
  yang khas: `beranda.css`, `auth.css`, `dashboard.css`, `download.css`,
  `features.css`, dan `app.css`.
- Palet mengikuti tabel di bawah dengan dua penyesuaian terukur: `--ink:
  #161513` (bukan `#141414`) dan `--line: rgba(22,21,19,.11)`, supaya batas
  kartu tetap terbaca di kanvas `#F7F5EF`.
- `theme-color` setiap halaman `#f7f5ef`; font disajikan lokal dengan `font-src
  'self'`; tidak ada aset eksternal.
- Gate desain (`landing-visual`, `landing-dashboard`, `landing-auth`,
  `landing-unduhswap`) sekarang membaca stylesheet yang benar-benar dimuat
  halaman, bukan blok `<style>` inline yang sudah tidak ada. Aturannya tidak
  dilonggarkan: angka, urutan breakpoint, dan bentuk kontrol tetap dikunci.
- Diverifikasi: `npm test` 1523/1523, `npm run check` ok, `format-comments` 427
  file ok, dan tidak ada overflow horizontal di 390px pada beranda, unduh,
  unduh-berkas, fitur, dukungan, 404, dan consent.

## Non-goals

- Tidak menyalin aset Cohere: tidak ada markup, stylesheet, gambar, atau font
  milik mereka di tree ini. Patokan adalah ukuran dan tata bahasa, bukan isi.
- Tidak mengubah halaman invoice, edge function, atau surface cloud.
- Tidak menambah framework, bundler, atau dependency; situs tetap statis.
- Tidak mengubah perilaku `index.html`, `akun.html`, `dashboard.html`: form,
  fetch, dan tabel tetap, hanya kulit yang berubah.
- Tidak menyebut versi build di halaman mana pun.
- Tidak menulis ulang halaman hukum (`privasi`, `syarat`) menjadi ringkas; di
  sana prose tetap wajib.
- Tidak deploy ke produksi dan tidak membuka PR di luar arahan pemilik.

## Fakta terverifikasi

Diambil dari tree dan situs live pada 2026-10-26.

- 12 halaman HTML di `landing/` (termasuk `landing/oauth/consent.html`) memuat
  `/site.css`; `landing/download.css` hanya untuk halaman unduhan.
- `landing/_headers` memuat 25 blok path, `landing/vercel.json` 15 entri
  header; keduanya harus sinkron (tes `landing-hosting` menegakkannya).
- CSP sekarang: `default-src 'none'`, `style-src 'self' 'unsafe-inline'`,
  `script-src 'self'` plus hash inline, `img-src data:`. Tidak ada `font-src`
  dan tidak ada font lokal.
- Toggle bahasa dibangun `landing/i18n.js` ke mount `[data-lang-toggle]`;
  label aksesibelnya sudah memuat teks yang terlihat.
- `beranda.html` 637 baris, `dashboard.html` 1518 baris (satu pengecualian
  terhadap batas 1200), `site.css` 265 baris. Redesign tidak boleh menambah
  panjang `dashboard.html`.
- Lighthouse `/beranda` dan `/index.html` pada build saat ini: accessibility 1,
  best-practices 1, SEO 0.8; satu-satunya audit gagal `robots-txt` adalah
  artefak CSP (`connect-src 'none'`), bukan cacat file.
- Patokan `https://cohere.com/` di Chromium 1112px, 2026-10-26: latar
  `rgb(255,255,255)`, teks `rgb(33,33,33)`, `h1` 60px berat 400 ("Your AI. Your
  rules."), body 16px, navigasi sangat sedikit tautan, strip logo pelanggan,
  visual besar di setiap section, ditutup satu CTA "Ready to put AI to work?".
  Font dan fotografi mereka proprietary; tidak ada yang dibawa.
- Patokan `https://code.visualstudio.com/` di Chromium 1112px, 2026-10-26: latar
  gelap `rgb(13,16,20)`, `h1` 60px berat 700, `h2` 30px/600, body 14px
  system-ui, CTA primer biru `#0078D4` radius 4px dengan label platform
  ("Download for Windows"), kartu unduhan berarsir terang, 28 section, 49
  gambar. Ritmenya: satu H2 pendek lalu satu visual produk, dengan pita CTA
  tengah halaman ("Start building with AI agents for free").

## Bahasa visual (token)

Satu tempat: `landing/site.css`. Token sebagai custom property; halaman boleh
menambah token tema halaman, tidak boleh meng-override token inti.

### Warna

| Token | Nilai | Peran |
| --- | --- | --- |
| `--paper` | `#F7F5EF` | kanvas dasar |
| `--surface` | `#FFFFFF` | kartu, panel |
| `--ink` | `#141414` | teks utama |
| `--muted` | `#5F5C55` | teks sekunder, eyebrow |
| `--line` | `rgba(20,20,20,.10)` | border, garis rambut |
| `--accent` | `#0B6B52` | CTA, tautan, fokus |
| `--accent-soft` | `#E4F2EC` | chip, latar aksen lembut |
| `--brand` | `#3ECF8E` | titik status dan highlight kecil |
| `--ink-panel` | `#101312` | mock produk dan pita CTA tengah |

- Tombol utama: latar `--accent`, teks putih, radius penuh, tinggi 44px.
- Tombol kedua: border `--ink`, latar transparan.
- `--brand` hanya untuk titik status 6–8px dan highlight di bawah teks; tidak
  pernah untuk teks besar di latar terang.
- Permukaan gelap maksimal dua per halaman: mock produk dan pita CTA tengah.
  Sisanya kertas terang.

### Tipografi

- Satu font: **Instrument Sans** variable (OFL) di `landing/fonts/`, subset
  latin, `font-display: swap`, `preload` hanya di `beranda.html`.
- Display: 500, `clamp(44px, 5.5vw, 84px)`, line-height 1.02, tracking
  `-0.03em`. H2: `clamp(28px, 3vw, 44px)`, 500. Body: 16px/1.6.
- Eyebrow: 12px, 500, uppercase, tracking `.14em`, `--muted`.
- Angka `tabular-nums`; mono stack sistem 13px untuk nama primitive.
- Fallback: `"Instrument Sans", system-ui, -apple-system, "Segoe UI", Roboto,
  sans-serif`.

### Ruang, bentuk, gerak

- Skala 4–128; section 112px desktop, 64px di bawah 700px.
- Konten maks 1200px, prose 720px, gutter 24px.
- Radius: kartu 20px, kontrol 999px, input 12px. Satu level shadow tipis.
- Masuk viewport: fade + translate 8px, 240ms, mati saat reduced-motion.
- Fokus: `outline: 2px solid var(--accent)`, offset 2px.

## Aturan copy (baru, mengikat)

Pembaca menekan tombol, bukan membaca paragraf. Setiap section pemasaran:

- Satu headline: `h1` maksimal 5 kata, `h2` maksimal 6 kata.
- Satu baris dukungan: maksimal 20 kata.
- Satu aksi: satu CTA (tombol atau tautan tegas), bukan daftar tautan.
- Satu objek visual: mock produk, angka, atau pita — bukan ikon hiasan.
- Paragraf pemasaran maksimum 2 baris; detail pindah ke halaman rujukannya.
- CTA primer menyebut platform yang terdeteksi ("Unduh untuk Chrome"), dengan
  tautan kecil ke pilihan lain di bawahnya.

Tes baru menolak headline, baris dukungan, atau paragraf yang melewati batas
ini.

## Komponen bersama

Ditulis ulang di `site.css`, dipakai semua halaman:

- **Chrome**: strip atas tipis (klaim "konten hanya ke endpoint Anda" + tautan),
  nav krem, wordmark, tautan 14px, pil hijau "Unduh", mount toggle bahasa.
  Sticky, border-bottom `--line`, tanpa blur berat.
- **Footer**: empat kolom tautan, baris hukum, toggle bahasa.
- **Kartu**: putih, border `--line`, radius 20px, padding 28px, judul 17px/500.
- **Stat band**: angka 40px tabular, label 13px muted, dipisah `--line`.
- **Langkah bernomor**: angka 13px mono muted, judul 15px/500, body 14.5px.
- **Permukaan gelap** (dua per halaman): `--ink-panel`, teks `#F2F1EC`, mono
  13px, radius 24px. Satu untuk mock produk, satu untuk pita CTA tengah.
- **Mock UI**: browser window terang dirender dari HTML/CSS (title bar, address
  bar, viewport) dengan elemen produk; selalu berlabel "Contoh", `role="img"`
  dengan `aria-label` yang menyebut contoh.

## Visual per section (grafis memanjakan mata)

Beranda memimpin dengan gambar dan tombol, bukan prosa. Ritme VS Code: satu
headline pendek lalu satu objek visual; kanvas terang ala Cohere.

1. Hero: `h1` maksimal 5 kata, satu baris, CTA primer "Unduh untuk <browser
   terdeteksi>" + CTA kedua "Sambungkan model", tiga angka jujur. Kanan:
   mock browser gelap (editor + panel tool call, primitif nyata), label
   "Contoh" — mock gelap berdiri di kanvas terang seperti screenshot VS Code.
2. Strip kredibilitas: tiga teks, tanpa logo palsu.
3. `#install` Instalasi: H2 pendek + tiga langkah bernomor + mock unduhan.
4. `#model` Bawa model sendiri: H2 pendek + mock form model + satu baris.
5. Pita CTA tengah: "Pakai gratis. Bawa model sendiri." + satu tombol unduh.
6. `#signin` Masuk: panel gelap berisi kutipan primitive dan satu baris MCP.
7. `#privacy` Apa yang meninggalkan mesin Anda: pita penuh tiga kolom.
8. `#faq` Pertanyaan yang sering masuk: enam pertanyaan satu baris.
9. CTA akhir: satu kalimat besar, satu tombol, lalu footer.

Section id (`#install`, `#model`, `#signin`, `#privacy`, `#faq`) dan seluruh
kunci i18n tetap dipakai; yang berubah tampilan dan komposisi.

Aturan permukaan gelap: maksimal dua per halaman — mock produk dan pita CTA
tengah. Sisanya kertas terang.

## Halaman

Setiap halaman memakai aturan copy yang sama: headline pendek, satu baris, satu
tombol, satu visual. Yang berubah hanya objek visualnya.

- **`beranda.html`**: susunan di atas, satu `h1`, copy dipangkas ke aturan copy.
- **`fitur.html`**: H1 "Fitur", satu baris, stat band (34/31/6), enam izin
  sebagai kartu bernomor, satu tombol unduh di akhir.
- **`unduh.html`**: H1 pendek, satu baris, CTA primer menyebut browser terdeteksi,
  tiga langkah bernomor, kartu per browser.
- **`unduh-berkas.html`**: lima kartu browser, satu unduhan utama per kartu
  (`.zip` tombol hijau, CRX tombol kedua), satu baris syarat per kartu. Grammar
  kartu VS Code yang sudah diadopsi, palet baru.
- **`index.html`, `akun.html`, `dashboard.html`**: permukaan aplikasi terang
  dengan token sama. `index.html` mempertahankan split brand-panel + kartu
  form dengan kanvas terang; CTA-nya satu tombol utama. `dashboard.html` reskin
  saja: token, tabel, chip, tombol; tanpa perubahan struktur atau fetch,
  panjang file tidak tumbuh.
- **`privasi.html`, `syarat.html`, `dukungan.html`, `404.html`,
  `oauth/consent.html`**: prose 720px, chrome dan footer baru, satu `h1`.
  Halaman hukum dikecualikan dari aturan copy.

## Teknis

- **CSP**: tambahkan `font-src 'self'` ke setiap blok di `landing/_headers` dan
  `landing/vercel.json` yang memuat `site.css` (25 dan 15 blok). `style-src`,
  `script-src`, dan `img-src` tidak berubah.
- **Font**: `landing/fonts/instrument-sans-latin.woff2` (variable, subset latin,
  di bawah 60 KB), `@font-face` di `site.css`, `preload` + `crossorigin` di
  `beranda.html`. Tes gagal jika file hilang atau policy tidak mengizinkan.
- **i18n**: setiap teks baru masuk dict `en` dengan pasangan ID; tidak ada kunci
  tanpa pasangan (tes `landing-i18n` menegakkannya).
- **Tes**: perbarui `landing-visual` (token, satu `h1`, mock berlabel, batas
  panjang paragraf), `landing-hosting` (`font-src`, aset terlarang),
  `landing-claims` (angka tetap dari kode), dan tes halaman yang memaku gaya
  gelap lama. Tes yang tidak lagi benar diganti bukti setara, tidak dibuang
  diam-diam.
- **Kode standar**: komentar CSS mengikuti `scripts/format-comments.mjs`; tidak
  ada file baru melewati 1200 baris.
- **Kejujuran**: tidak ada logo pelanggan, metrik pengguna, atau klaim baru.

## Urutan kerja

1. Fondasi: token, font, `font-src` di kedua host, chrome, footer, mock UI.
2. `beranda.html` lengkap dengan copy baru.
3. `fitur.html`, `unduh.html`, `unduh-berkas.html`.
4. `index.html`, `akun.html`, `404.html`, `oauth/consent.html`, `privasi.html`,
   `syarat.html`, `dukungan.html`.
5. `dashboard.html` reskin terakhir.
6. Update `docs/design-references.md` (bagian Cohere) dan `docs/handoff.md`.

## Risiko dan bukti

| Risiko | Bukti |
| --- | --- |
| Font baru memicu CLS | `font-display: swap`, Lighthouse CLS diukur |
| Kontras hijau di kanvas terang kurang | tes kontras token WCAG 4.5:1 |
| Halaman sekunder pecah saat reskin | gate unit + verifikasi live tiap halaman |
| Copy memanjang lagi | tes batas kata headline, baris dukungan, dan paragraf |
| Angka/klaim bergeser | tes `landing-claims`, `landing-hosting`, `landing-visual` |
| SonarCloud duplikasi naik | komponen bersama, tidak ada baris identik disalin |
| `dashboard.html` melewati batas baris | panjang file tidak boleh tumbuh |

## Definition of Done

- 12 halaman memakai token yang sama; tidak ada warna/ukuran ad hoc di markup.
- `npm test`, `npm run check`, formatter, gitleaks 8.24.0, dan
  `py tests/browser_extension_test.py` hijau.
- Lighthouse `/beranda` dan `/` accessibility 1, best-practices 1, tanpa error
  console; `site.css` 200 dan rules terhitung.
- Branch ter-deploy lewat `deploy-site.yml`; situs live memuat font, kanvas
  terang, dan mock UI berlabel "Contoh".
- `docs/design-references.md` dan `docs/handoff.md` diperbarui.
- Tidak ada PR merge tanpa arahan pemilik.
