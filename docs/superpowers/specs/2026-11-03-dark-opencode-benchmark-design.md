@last-edited: 2026-11-03 UTC+7.
@related: [`../../../AGENTS.md`](../../../AGENTS.md) - [`../../handoff.md`](../../handoff.md) - [`2026-10-26-cohere-grade-site-design.md`](2026-10-26-cohere-grade-site-design.md)

# Spec: Situs gelap penuh, benchmark opencode.ai

Disetujui sebagai arah pada 2026-11-03. Spec ini menggantikan bahasa visual
terang dari spec 2026-10-26; ia tidak mencabut aturan isi, angka, aksesibilitas,
atau keamanan dari spec itu.

## Intent

Situs publik sekarang terang: kanvas `#f7f5ef`, teks `#161513`, aksen mint
`#3ecf8e`, radius 10px, dan 18 baris override `body:has(...)` yang memaksa dua
halaman jadi gelap di tengah situs terang. Hasilnya dua bahasa visual di satu
situs, dan halaman yang paling sering dibuka sesudah masuk terbaca sebagai
aplikasi lain.

opencode.ai diukur pada 2026-11-03: satu kanvas gelap, satu aksen, display besar
dengan tracking rapat, angka sebagai bukti (220K stars / 950 contributors / 16M
devs per bulan), satu aksi terisi per layar, dan FAQ accordion di kaki halaman.
Tidak ada bayangan, tidak ada gradien, tidak ada kartu berwarna.

Spec ini memindahkan seluruh 12 halaman ke satu kanvas gelap dengan pola
opencode sebagai patokan ukuran, bukan sebagai salinan. Identitas Opera Agent
tetap: mint `#3ecf8e`, logo, dan Bahasa Indonesia sebagai bahasa pertama.

Target keberhasilan yang dapat diukur:

- Satu sistem token di `landing/site.css` untuk 12 halaman. Tidak ada warna
  literal di `beranda.css`, `auth.css`, `app.css`, `dashboard.css`,
  `download.css`, `features.css`.
- Tidak ada aturan `body:has(...)` yang memaksa tema; seluruh halaman sudah
  gelap tanpa pengecualian.
- Kontras terhitung, bukan dicocokkan string: `--ink` di atas `--bg` ≥ 7:1,
  `--muted` di atas `--bg` ≥ 4.5:1, `--accent` di atas `--bg` ≥ 4.5:1.
- `theme-color` setiap halaman sama dengan `--bg`.
- Satu aksen: hanya `--accent` yang berjarak chroma > 0.15; setiap warna lain
  abu netral.
- Tidak ada `--shadow` yang dipakai memisahkan dua permukaan; pemisah adalah
  `--line`.
- `beranda.html` tetap punya satu `h1`, satu aksi terisi di hero, band angka
  yang dibaca dari kode, dan section id `#install`, `#model`, `#signin`,
  `#privacy`, `#faq`.
- Nav tetap 4 pintu + 1 aksi, seperti yang baru diselesaikan.
- `npm test`, `npm run check`, `node scripts/format-comments.mjs`, dan gate
  browser Python hijau di setiap fase.

## Bahasa visual

### Token

```css
:root {
  --bg: #0a0a0a;
  --surface: #141414;
  --surface-2: #1c1c1c;
  --ink: #ededed;
  --muted: #a1a1a1;
  --line: rgba(255, 255, 255, .12);
  --line-strong: rgba(255, 255, 255, .22);
  --accent: #3ecf8e;
  --accent-strong: #5fe0a5;
  --accent-soft: rgba(62, 207, 142, .12);
  --danger: #ff6b6b;
  --warn: #f6c969;
  --radius: 8px;
  --radius-sm: 6px;
  --wrap: 1160px;
  --prose: 680px;
  --font: "Instrument Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --ease: cubic-bezier(.22, .61, .24, 1);
}
```

Kontras terhitung: `--ink` `#ededed` di `--bg` `#0a0a0a` = 17.4:1; `--muted`
`#a1a1a1` = 8.0:1; `--accent` `#3ecf8e` = 9.9:1. Ketiganya lolos AAA untuk teks
badan kecuali aksen, yang lolos AA.

`--paper`, `--surface-soft`, `--surface-strong`, `--ink-panel`, `--panel-text`,
`--shadow`, `--shadow-lift`, `--pill`, `--brand`, `--lime`, `--bg`/`--text`
alias lama: dihapus. Setiap pemakai diganti token baru.

### Tipografi

| Peran | Ukuran | Catatan |
|---|---|---|
| `h1` | `clamp(40px, 6vw, 76px)` | `line-height: .98`, `letter-spacing: -.045em` |
| `h2` | `clamp(26px, 3vw, 40px)` | `letter-spacing: -.035em` |
| `h3` | 18px | `letter-spacing: -.02em` |
| badan | 16px / 1.62 | |
| kecil | 13px / 1.5 | |
| teknis | 13px mono | perintah, checksum, angka |

Instrument Sans tetap, disajikan lokal dari `fonts/instrument-sans-latin.woff2`
dengan `font-src 'self'`. Tidak ada permintaan jaringan baru.

### Permukaan dan kontrol

- Radius 8px untuk kartu dan kontrol, 6px untuk input. `--pill: 980px` hilang;
  tidak ada kontrol berbentuk pil lagi.
- Tanpa bayangan. Pemisahan permukaan memakai `--line` 1px.
- Aksi terisi: latar `--ink`, teks `--bg`. Aksi kedua: garis `--line-strong`,
  latar transparan.
- Aksen hanya untuk status, tautan dalam teks, dan satu penanda aktif. Bukan
  untuk tombol utama — itu tugas `--ink`.

## Struktur per halaman

| Halaman | Bentuk |
|---|---|
| `beranda.html` | hero satu kolom lebar, satu aksi terisi, band 3 angka, panel demo, fitur bernomor, FAQ accordion |
| `fitur.html` | hero pendek, lalu daftar baris lebar bernomor (bukan grid kartu), lalu tabel izin |
| `unduh.html` | satu kolom: langkah bernomor, perintah salin mono, daftar berkas |
| `unduh-berkas.html` | tabel gelap: berkas, ukuran, checksum mono |
| `dukungan.html` | prose gelap, accordion pertanyaan |
| `privasi.html`, `syarat.html` | prose gelap, TOC sticky di kolom kiri pada ≥ 900px |
| `404.html` | satu kalimat besar, lalu 4 tautan baris |
| `index.html` | satu kartu tengah, provider bertumpuk, tab masuk/daftar |
| `akun.html` | header akun, grid kartu gelap tanpa border ganda |
| `dashboard.html` | konsol: token baru, tata letak tidak berubah |
| `oauth/consent.html` | satu kartu tengah, daftar scope, dua aksi |

Nav dan footer tidak berubah bentuknya: 4 pintu + toggle bahasa + 1 aksi di
header, satu baris tautan di footer.

## Arsitektur CSS

`site.css` tetap satu-satunya sumber token dan komponen bersama. Yang berubah:

1. Blok `:root` ditulis ulang menurut tabel token.
2. 18 baris `body:has(main.console)` dan `body:has(main.account)` dihapus;
   aturan header gelapnya naik jadi aturan dasar.
3. `.eyebrow` dan `.eyebrow::before` dihapus — tidak ada pemakai di 12 halaman.
4. `.panelDark` dibalik jadi `.panelLight`: sekarang latar gelap, jadi panel
   terang yang menjadi pengecualian. Pemakainya di `oauth/consent.html`
   diperiksa satu per satu.
5. `.toc`, `.card`, `.tile`, `.chip`, `.btn`, `dl.facts`, `ol.steps`, `.copybox`
   dipertahankan bentuknya, warnanya pindah ke token.

Lembar halaman hanya menyimpan komposisi. Aturannya: nol literal `#rrggbb` di
enam lembar halaman; setiap warna lewat `var(--…)`.

## Tes

`tests/landing-visual.test.mjs` ditulis ulang. Tes yang mengunci tema terang
dibuang, masing-masing diganti bukti setara:

| Bukti baru | Menggantikan |
|---|---|
| Setiap halaman memuat `/site.css`, dan tidak ada lembar halaman yang menulis `#rrggbb` | "marketing rounds, shell squares" yang mengunci radius per halaman |
| `--bg` luminance < 0.05, `--ink` > 0.8 | klaim kanvas terang |
| Kontras `--ink`/`--bg` ≥ 7, `--muted`/`--bg` ≥ 4.5, `--accent`/`--bg` ≥ 4.5 | tidak ada padanan; ini bukti baru |
| `theme-color` setiap halaman = `--bg` | tema per halaman |
| Hanya `--accent` yang jenuh | "satu aksen" yang dulu hanya prose |
| Tidak ada `box-shadow` pada `.card`/`.tile` | `--shadow: none` yang dulu dikunci |
| Nav 4 pintu, hero satu aksi, angka hero = sumber kode, section seimbang, 320px tidak meluber, `prefers-reduced-motion`, print | **dipertahankan apa adanya** |

`landing-company`, `landing-consent`, `landing-auth`, `landing-i18n`,
`landing-dashboard`, `landing-unduhswap` tidak berubah kecuali baris yang
menyebut warna atau `theme-color`.

## Urutan kerja

1. Token dan `site.css`. Seluruh situs menjadi gelap dan konsisten; komposisi
   halaman belum disentuh.
2. `theme-color` di 12 halaman.
3. Per halaman, dari yang paling sering dibuka: beranda → fitur → unduh →
   unduh-berkas → dukungan → 404 → privasi → syarat → index → akun →
   dashboard → consent.
4. Literal warna di enam lembar halaman diganti token.
5. Tes visual ditulis ulang.
6. `npm test`, `npm run check`, formatter, gate Python.
7. Verifikasi di browser: 1440px dan 390px per halaman, plus cek kontras.

## Non-goals

- Tidak ada halaman baru, section baru, atau klaim baru.
- Tidak ada perubahan pada `landing/_worker.js`, `_headers`, `vercel.json`, atau
  CSP selain `theme-color` yang ikut berubah.
- Tidak ada perubahan pada teks Indonesia, kunci `data-i18n`, atau kamus Inggris.
- Tidak ada perubahan pada nav, footer, atau `scripts/nav-rewrite.mjs`.
- Tidak menyentuh `extension/`, `supabase/`, atau halaman di luar `landing/`.
- Tidak menambah font, ikon, atau aset jaringan.

## Risiko

- `dashboard.html` 62KB dengan `dashboard.css` 29KB adalah halaman terbesar dan
  paling mungkin punya warna literal tersebar. Perkiraan 40% pekerjaan.
- `app.css` sudah membawa palet gelapnya sendiri (`#0c0e11`, `#12151a`,
  `#171b21`, `#1f242c`). Palet itu harus dilebur ke token, bukan dibiarkan
  berdampingan, atau situs kembali punya dua bahasa.
- `beranda.css` memuat delapan literal terang (`#fff`, `#a9edd0`, `#cfe9dd`,
  `#9fe6c8`, `#b9f0d8`) yang dipakai panel demo. Setiap satunya harus dipetakan
  ke token dengan kontras yang dihitung ulang.
