@last-edited: 2026-10-26 UTC+7.
@related: [`../../../AGENTS.md`](../../../AGENTS.md) - [`../../handoff.md`](../../handoff.md) - [`../../design-references.md`](../../design-references.md)

# Spec: Situs kelas Cohere — bahasa visual terang untuk situs publik

Disetujui sebagai arah pada 2026-10-26: pendekatan **B** (sistem desain baru,
beranda disusun ulang, halaman lain di-reskin). Spec ini belum menyentuh kode;
ia memutuskan bentuk, batas, dan urutan langkah. Yang diubah adalah bahasa
visual. Konten, klaim, angka, dan tautan tidak berubah.

## Intent

Situs publik (`opera-agent.pages.dev`) sudah benar secara teknis: CSP memuat
aset sendiri, angka fitur cocok dengan kode, Lighthouse accessibility 1. Yang
belum cocok adalah kelasnya. Tema gelap dengan aksen hijau neon dan tipografi
berat terasa seperti dokumentasi teknis, bukan produk korporat yang bisa
dipercahkan pembeli baru.

Spesifikasi ini memindahkan seluruh situs publik ke bahasa visual terang yang
tenang, dengan Cohere sebagai patokan ukuran (diukur, bukan disalin). Target
keberhasilan yang dapat diukur:

- Satu sistem token (`site.css`) dipakai 12 halaman; tidak ada warna, radius,
  atau ukuran huruf ad hoc di dalam halaman.
- Kontras setiap pasangan teks/latar di token minimal 4.5:1, diuji otomatis.
- `landing/beranda.html` punya tepat satu `h1`, hero dua kolom dengan mock UI
  produk yang berlabel "Contoh", dan section id `#install`, `#model`,
  `#signin`, `#privacy`, `#faq` masih ada.
- Lighthouse accessibility dan best-practices tetap 1 di `/beranda` dan `/`.
- Tidak ada aset eksternal: hanya satu file font lokal (woff2 subset latin),
  `font-src 'self'` di setiap policy, `img-src` tetap `data:`.
- `npm test`, `npm run check`, formatter, gitleaks, dan gate browser Python
  hijau di setiap fase; SonarCloud hijau di PR.
- Tidak ada klaim baru: jumlah tool/primitive/izin tetap dibaca dari kode oleh
  tes yang sudah ada, dan tidak ada logo pelanggan atau metrik palsu.

## Non-goals

- Tidak menyalin aset Cohere: tidak ada markup, stylesheet, gambar, atau font
  milik mereka di tree ini. Patokan adalah ukuran dan tata bahasa, bukan isi.
- Tidak mengubah halaman invoice (served by Supabase function), edge function,
  atau surface cloud.
- Tidak menambah framework, bundler, atau dependency; situs tetap HTML/CSS/JS
  statis.
- Tidak menulis ulang copy selain yang diperlukan tata letak; pasangan ID/EN
  baru hanya boleh memuat klaim yang sudah ada di tree.
- Tidak mengubah perilaku `index.html`, `akun.html`, `dashboard.html`:
  form, fetch, dan tabel tetap, hanya kulit yang berubah.
- Tidak menyebut versi build di halaman mana pun (aturan yang sudah ada).
- Tidak deploy ke produksi dan tidak membuka PR di luar arahan pemilik;
  deploy situs dari branch tetap lewat `deploy-site.yml`.

## Fakta terverifikasi

Diambil dari tree dan situs live pada 2026-10-26.

- 12 halaman HTML di `landing/` (termasuk `landing/oauth/consent.html`) memuat
  `/site.css`; `landing/download.css` hanya dipakai halaman unduhan.
- `landing/_headers` memuat 25 blok path, `landing/vercel.json` 15 entri
  header; keduanya harus tetap sinkron (tes `landing-hosting` menegakkannya).
- CSP sekarang: `default-src 'none'`, `style-src 'self' 'unsafe-inline'`,
  `script-src 'self'` plus hash inline, `connect-src` bervariasi,
  `img-src data:`. Tidak ada `font-src`, dan tidak ada font lokal.
- Toggle bahasa dibangun oleh `landing/i18n.js` ke dalam mount
  `[data-lang-toggle]`; label aksesibel sudah memuat teks yang terlihat.
- `beranda.html` 637 baris, `dashboard.html` 1518 baris (sudah melewati batas
  norma; baris kode standar 1200 mengizinkan satu exception), `site.css` 265
  baris. Redesign tidak boleh menambah panjang `dashboard.html`.
- Lighthouse `/beranda` dan `/index.html` di build saat ini: accessibility 1,
  best-practices 1, SEO 0.8; satu-satunya audit gagal adalah `robots-txt` yang
  merupakan artefak CSP (`connect-src 'none'`), bukan cacat file.
- Patokan terukur dari `https://cohere.com/` pada 2026-10-26 (di browser
  Chromium, 1112px viewport): latar putih `rgb(255,255,255)`, teks
  `rgb(33,33,33)`, `h1` 60px berat 400 dengan font custom "CohereText"
  (fallback Space Grotesk/Inter), body 16px, navigasi sangat sedikit tautan,
  strip logo pelanggan, dan visual produk di bawah lipatan pertama. Situs
  mereka memakai font dan fotografi proprietary; tidak ada yang dibawa masuk.

## Bahasa visual (token)

Satu tempat: `landing/site.css`. Token didefinisikan sebagai custom property
dan dipakai oleh semua komponen; halaman boleh menambah token tema halaman,
tidak boleh meng-override token inti.

### Warna

| Token | Nilai | Peran |
| --- | --- | --- |
| `--paper` | `#F7F5EF` | kanvas dasar |
| `--surface` | `#FFFFFF` | kartu, panel, permukaan naik |
| `--ink` | `#141414` | teks utama |
| `--muted` | `#5F5C55` | teks sekunder, eyebrow |
| `--line` | `rgba(20,20,20,.10)` | garis rambut, border kartu |
| `--accent` | `#0B6B52` | CTA, tautan, fokus (kontras di kanvas terang) |
| `--accent-soft` | `#E4F2EC` | latar aksen lembut, chip |
| `--brand` | `#3ECF8E` | titik status dan highlight kecil saja |
| `--ink-panel` | `#101312` | satu panel gelap per halaman (jeda kontras) |

Aturan pakai:

- Tombol utama: latar `--accent`, teks putih, radius penuh.
- Tombol kedua: border `--ink`, teks `--ink`, latar transparan.
- Tautan: `--accent`, underline saat hover saja.
- `--brand` hanya untuk titik status 6–8px dan highlight di bawah teks; tidak
  pernah untuk teks besar di latar terang.
- Satu panel gelap per halaman, tidak lebih; sisanya kertas terang.

### Tipografi

- Font tunggal: **Instrument Sans** variable (OFL), disimpan lokal di
  `landing/fonts/`, subset latin, `font-display: swap`, `preload` pada
  `beranda.html` saja (halaman lain tidak memuat hero besar).
- Display: berat 500, `clamp(44px, 5.5vw, 84px)`, line-height 1.02,
  letter-spacing `-0.03em`.
- H2: `clamp(28px, 3vw, 44px)`, berat 500, line-height 1.1.
- Body: 16px/1.6; prose `max-width: 68ch`.
- Eyebrow: 12px, berat 500, uppercase, letter-spacing `.14em`, `--muted`.
- Angka: `font-variant-numeric: tabular-nums`.
- Mono (nama primitive, kode): stack sistem
  `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`, 13px.
- Fallback stack: `"Instrument Sans", system-ui, -apple-system, "Segoe UI",
  Roboto, sans-serif`.

### Ruang, bentuk, gerak

- Skala: 4, 8, 12, 16, 24, 32, 48, 64, 96, 112, 128.
- Section: padding blok 112px desktop, 64px di bawah 700px.
- Lebar: konten maks 1200px, prose 720px, gutter 24px.
- Radius: kartu 20px, kartu besar 24px, kontrol 999px, input 12px.
- Bayangan: satu level `0 1px 2px rgba(20,20,20,.06)`; tidak ada blur tebal.
- Gerak: masuk viewport fade + translate 8px, 240ms, `prefers-reduced-motion`
  mematikan. Tidak ada parallay, tidak ada autoplay.
- Fokus: `outline: 2px solid var(--accent)`, offset 2px, terlihat di semua
  kontrol.

## Komponen bersama

Ditulis ulang di `site.css`, dipakai semua halaman:

- **Chrome**: strip atas tipis (klaim "konten hanya ke endpoint Anda" + tautan
  ke `#privacy`), nav krem dengan wordmark, tautan 14px, pil hijau "Unduh",
  mount toggle bahasa. Sticky, border-bottom 1px `--line`, tanpa blur berat.
- **Footer**: empat kolom tautan, baris hukum, toggle bahasa, tanpa ikon
  sosial.
- **Kartu**: surface putih, border `--line`, radius 20px, padding 28px;
  judul 17px/500, body 14.5px muted.
- **Stat band**: angka 40px tabular, label 13px muted, dipisah `--line`.
- **Langkah bernomor**: angka 13px mono muted + judul 15px/500 + body 14.5px.
- **Panel gelap**: latar `--ink-panel`, teks `#F2F1EC`, mono 13px, radius 24px.
- **Mock UI**: browser window terang (title bar tiga titik, address bar,
  viewport) dengan elemen produk dirender dari HTML/CSS; selalu berlabel
  "Contoh" (teks, bukan alt), `role="img"` dengan `aria-label` yang menyebut
  bahwa ini contoh.

## Halaman

### `beranda.html` (disusun ulang)

Urutan section baru, id lama dipertahankan, seluruh kunci i18n tetap dipakai:

1. Hero: eyebrow "Daftar terbuka", `h1` "Asisten Anda mengemudikan browser
   Anda." dengan frasa akhir di `--accent`, subcopy, CTA "Unduh" +
   "Sambungkan model", footnote "Gratis dipakai. Model ditagih penyedia Anda.",
   dan tiga stat jujur (34 tool MCP, 31 primitive, 6 izin). Kanan: mock
   browser dengan Google Sheets dan panel tool call (primitif nyata), label
   "Contoh".
2. Strip kredibilitas (bukan logo pelanggan): "Bicara MCP", "Chrome · Edge ·
   Brave · Opera · Vivaldi", "Kunci model tidak pernah ke server ini".
3. Kartu kemampuan (3): kendali browser, model milik Anda, manusia di loop.
4. `#install` Instalasi: tiga langkah bernomor + mock unduhan.
5. `#model` Bawa model sendiri: dua kolom, kiri copy, kanan mock form model.
6. `#signin` Masuk: panel gelap satu-satunya, berisi kutipan primitive
   (`signin.tools.dd`) dan daftar singkat MCP.
7. `#privacy` Apa yang meninggalkan mesin Anda: pita penuh, tiga kolom.
8. `#faq` Pertanyaan yang sering masuk: dua kolom, garis rambut.
9. CTA akhir: satu kalimat besar + tombol unduh.
10. Footer.

### `fitur.html`

Intro editorial, stat band (34/31/6), enam izin sebagai kartu bernomor, lalu
bagian model dan pairing yang sudah ada. Semua nama izin tetap dibaca dari
manifest oleh tes.

### `unduh.html`, `unduh-berkas.html`

Kartu kertas, satu unduhan utama (`.zip`) sebagai tombol hijau, CRX sebagai
tombol kedua, lima kartu browser, syarat satu baris, catatan hash. Tata letak
mengikuti grammar kartu VS Code yang sudah diadopsi, dengan palet baru.

### `index.html`, `akun.html`, `dashboard.html`

Permukaan aplikasi terang dengan token yang sama. `index.html` mempertahankan
split brand-panel + kartu form (grammar Facebook yang sudah diadopsi) dengan
kanvas terang. `dashboard.html` hanya reskin: token, tabel, chip, tombol;
tidak ada perubahan struktur atau fetch, dan panjang file tidak boleh tumbuh.

### `privasi.html`, `syarat.html`, `dukungan.html`, `404.html`, `oauth/consent.html`

Prose 720px, chrome dan footer baru, heading hierarchy tetap satu `h1`.

## Teknis

- **CSP**: tambahkan `font-src 'self'` ke setiap blok di `landing/_headers`
  dan `landing/vercel.json` yang memuat `site.css` (25 dan 15 blok).
  `style-src 'self' 'unsafe-inline'` dan `script-src` hash tidak berubah.
  `img-src` tetap `data:` karena seluruh visual adalah HTML/CSS/SVG.
- **Font**: `landing/fonts/instrument-sans-latin.woff2` (variable, subset
  latin, target di bawah 60 KB), `@font-face` di `site.css`, `preload` +
  `crossorigin` pada `beranda.html`. Tes gagal jika file hilang atau policy
  tidak mengizinkannya.
- **i18n**: setiap teks baru masuk ke dict `en` dengan pasangan ID yang
  ditulis; tidak ada kunci tanpa pasangan (tes `landing-i18n` menegakkannya).
- **Tes**: perbarui `tests/landing-visual.test.mjs` (token, satu H1, mock
  berlabel), `tests/landing-hosting.test.mjs` (font-src, aset terlarang),
  `tests/landing-claims.test.mjs` (angka tetap dari kode), dan tes halaman yang
  memaku gaya gelap lama. Tes yang tidak lagi benar diganti dengan bukti
  setara, tidak dibuang diam-diam.
- **Kode standar**: komentar CSS mengikuti format `scripts/format-comments.mjs`
  (blok kolom nol sebagai header section, blok indentasi mendokumentasikan kode
  di bawahnya). Tidak ada file melewati 1200 baris selain pengecualian yang
  sudah ada.
- **Kejujuran**: tidak ada logo pelanggan, metrik pengguna, atau klaim baru.
  Angka di situs tetap dibaca ulang oleh tes dari `protocol.js`, kontrak MCP,
  dan `manifest.json`.

## Urutan kerja

1. Fondasi: token, font, `@font-face`, `font-src` di kedua host, chrome dan
   footer bersama, mock UI. Gate penuh + deploy branch.
2. `beranda.html`: hero, strip kredibilitas, kartu kemampuan, langkah, panel
   gelap, privasi, FAQ, CTA. Gate penuh + verifikasi live + Lighthouse.
3. `fitur.html`, `unduh.html`, `unduh-berkas.html`. Gate + verifikasi.
4. `index.html`, `akun.html`, `404.html`, `oauth/consent.html`,
   `privasi.html`, `syarat.html`, `dukungan.html`. Gate + verifikasi.
5. `dashboard.html` reskin terakhir (paling besar, paling berisiko). Gate.
6. Update `docs/design-references.md` dengan bagian Cohere (apa yang diukur,
   apa yang diadopsi, apa yang ditinggalkan) dan `docs/handoff.md`.

## Risiko dan bukti

| Risiko | Bukti yang menutupnya |
| --- | --- |
| Font baru memicu CLS atau memblokir render | `font-display: swap`, `size-adjust` disetel, Lighthouse CLS diukur sebelum/sesudah |
| Kontras hijau di kanvas terang kurang | tes kontras token (WCAG 4.5:1) |
| Halaman sekunder pecah saat reskin | gate unit + verifikasi live setiap halaman |
| Redesign menggeser angka/klaim | tes `landing-claims`, `landing-hosting`, `landing-visual` tetap hijau |
| SonarCloud duplikasi naik | tidak ada baris panjang identik disalin; mock dan kartu adalah komponen bersama |
| `dashboard.html` melewati batas baris | reskin hanya menukar token, panjang file tidak boleh tumbuh |

## Definition of Done

- 12 halaman memuat sistem token yang sama; tidak ada warna/ukuran ad hoc di
  markup halaman.
- `npm test`, `npm run check`, formatter, gitleaks 8.24.0, dan
  `py tests/browser_extension_test.py` hijau.
- Lighthouse `/beranda` dan `/` accessibility 1, best-practices 1, tanpa error
  console; CSS terukur termuat (`site.css` 200, rules terhitung).
- Branch ter-deploy lewat `deploy-site.yml` dan situs live memuat font,
  kanvas terang, dan mock UI berlabel "Contoh".
- `docs/design-references.md` dan `docs/handoff.md` diperbarui.
- Tidak ada PR merge tanpa arahan pemilik.
