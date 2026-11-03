@last-edited: 2026-11-03 UTC+7.
@related: [`../../../AGENTS.md`](../../../AGENTS.md) - [`../../handoff.md`](../../handoff.md) - [`../../product/billing.md`](../../product/billing.md) - [`../../product/monetization.md`](../../product/monetization.md) - [`2026-11-02-qris-payment-rail-design.md`](2026-11-02-qris-payment-rail-design.md)

# Spec: Halaman harga publik — plan dibayar QRIS, lunas sendiri

Disetujui sebagai arah pada 2026-11-03. Spec ini belum membangun apa pun; ia
memutuskan bentuk, batas, dan urutan langkah sebelum kode disentuh. Lingkupnya
adalah **satu halaman harga publik** yang menjual plan firma-bulan dan menerima
QRIS langsung, di atas rel QRIS yang sudah diputuskan di
[`2026-11-02-qris-payment-rail-design.md`](2026-11-02-qris-payment-rail-design.md).

## Intent

Situs hari ini menjual lewat operator: invoice diterbitkan lewat alat MCP
setelah batch pertama diterima, lalu pelanggan membuka link invoice. Halaman
harga publik mengubah pintu masuknya, bukan isi harganya:

- **Harga terlihat tanpa bertanya.** Dua plan dan harga client-month di atas
  kuota tampil di `/harga`, dibaca dari `opera_price_list`, bukan dari HTML.
- **Bayar untuk mulai.** Pembeli mengisi nama firma dan satu kontak, memilih
  plan, lalu membayar invoice itu dengan QRIS. Tidak ada setup fee, tidak ada
  telepon lebih dulu.
- **Invoice lahir dari halaman, lunas oleh detektor.** Action publik membuat
  invoice satu baris; halaman invoice menerbitkan QRIS; detektor menutupnya
  saat uang masuk. Tidak ada operator di jalur pembayaran.
- **Kontak tidak hilang.** Setiap order menulis satu baris `opera_price_orders`,
  jadi operator tahu siapa yang membayar dan ke mana harus menghubungi.

Perubahan kebijakan yang disadari: `docs/product/monetization.md` menjanjikan
invoice terbit **setelah** batch pertama diterima. Halaman ini menagih
**sebelum**. Batch pertama yang tidak diterima dikembalikan penuh oleh operator
dengan tangan; tidak ada refund otomatis di jalur ini, dan halaman mengatakannya.

## Non-goals

- **Langganan berulang otomatis.** Halaman menjual satu firma-bulan. Bulan
  berikutnya tetap diterbitkan operator, atau spec lain yang menagih berulang.
- **Plan di luar dua baris itu.** `statement.client_month` tampil sebagai
  catatan di atas kuota, bukan tombol beli.
- **Kartu, dolar, pelanggan asing.** Tetap Midtrans SNAP; halaman ini memakai
  rail yang dipilih `BILLING_RAIL`, dan QRIS adalah jalur yang diiklankan.
- **Refund otomatis.** Tidak ada API refund di provider mana pun yang dipakai;
  pengembalian uang adalah tindakan operator yang dicatat di luar sistem.
- **Captcha atau akun pelanggan.** Batas laju dan bentuk kontak adalah
  pertahanannya; keduanya dinamai di bagian Model bahaya.
- **Halaman harga berbahasa Inggris.** Situs ini berbahasa Indonesia; halaman
  mengikuti bahasa situs.
- **Email transaksional.** Tidak ada pengirim email di tree; konfirmasi adalah
  halaman invoice yang sudah ada.

## Fakta terverifikasi

Diukur pada 2026-11-03 terhadap database live dan tree ini.

| Fakta | Bukti |
|---|---|
| Tiga harga aktif, dalam sen | `select kind, unit, amount_cents, active from opera_price_list` → `plan.pilot` 9.900.000; `plan.firm` 24.900.000; `statement.client_month` 1.000.000; ketiganya `active` |
| Invoice hari ini hanya lewat token operator | `supabase/functions/opera-agent-billing/index.ts:722` — action `invoice` menolak tanpa `Authorization: Bearer OPERA_BILLING_TOKEN` |
| Bentuk invoice yang dipakai ulang | action `invoice` menerima `customer_id`, `period` `YYYY-MM`, dan `lines`; jawabannya `{ invoice, url }` (`index.ts:727-762`) |
| Link invoice dibentuk fungsi | `${BILLING_PAGE_URL}?invoice_id=…&token=…` (`index.ts:761`), token = HMAC-SHA512(`BILLING_SECRET`, `invoice:<id>`).slice(0, 32) (`_shared/billing.js:76`) |
| Halaman invoice GET mewajibkan invoice_id + token | `index.ts:629` menolak permintaan tanpa keduanya, jadi cabang halaman publik harus diperiksa sebelum baris itu |
| Worker hanya memiliki `/invoice` | `landing/_worker.js:123` — path lain diserahkan ke asset server |
| Domain fungsi melabeli HTML sebagai `text/plain` | terukur 2026-10-26, dicatat di kepala `landing/_worker.js`; karena itu halaman publik juga harus lewat worker |
| Situs statis tanpa JavaScript di halaman | `landing/*.html`; nav di `landing/beranda.html:28-32` |
| QRIS terbit saat halaman invoice dibuka | spec rel QRIS, Task 5: QR dibuat di GET halaman invoice, bukan saat invoice dibuat |
| Satu nominal hanya satu QR terbuka | indeks parsial `opera_invoices_qris_open_amount_idx` (spec rel QRIS, Task 3) |

## Arsitektur

### Halaman `/harga`

Halaman dirender oleh `opera-agent-billing`, bukan oleh HTML statis, karena
harga harus satu sumber: baris `opera_price_list`. Halaman statis dengan harga
di dalamnya adalah dua salinan yang akan berbeda, dan halaman dengan `fetch`
adalah halaman kosong saat jaringan gagal.

`GET /harga` di worker diteruskan ke fungsi dengan penanda `page=harga` di query.
Fungsi merender `pricePage(prices, …)` dari modul murni baru
`supabase/functions/_shared/price-page.js`. Halaman memuat:

- judul dan satu paragraf apa yang dibeli: satu firma, satu bulan, kuota
  client-month;
- dua plan aktif (`plan.pilot`, `plan.firm`) dengan harga dan kuota, diambil
  dari baris harga;
- satu catatan client-month di atas kuota dari baris `statement.client_month`;
- form: nama firma, kontak (nomor Indonesia atau email), pilihan plan, tombol
  "Buat invoice dan bayar";
- satu paragraf kebijakan: pembayaran lewat QRIS, dan batch pertama yang tidak
  diterima dikembalikan penuh oleh operator.

Halaman ini satu-satunya halaman publik yang boleh diindeks; halaman invoice
tetap `noindex`. Tidak ada token, tidak ada `<script>`, dan tidak ada nilai
harga yang ditulis di HTML.

### Action publik `price-order`

`POST /harga` diteruskan worker ke fungsi dengan body yang sama. Fungsi
mengenali `body.action === "price-order"` dan tidak meminta token operator:
halaman ini memang untuk orang yang belum punya apa pun.

Validasi, semuanya di modul murni supaya bisa diuji tanpa jaringan:

| Aturan | Penolakan |
|---|---|
| `firm` setelah trim 2–80 karakter | 400 `nama firma dibutuhkan` |
| `contact` cocok `^(\+62|62|0)8[0-9]{7,12}$` atau email `^[^@\s]+@[^@\s]+\.[^@\s]+$` | 400 `kontak berupa nomor WhatsApp atau email` |
| `kind` termasuk plan yang aktif di `opera_price_list` | 400 `plan tidak dijual` |
| order `(firm, period)` belum ada | bukan penolakan: link invoice yang sudah ada dikembalikan |
| baris order baru dalam satu jam bergulir < 30 | 429 `terlalu banyak order, coba lagi nanti` |

`period` adalah bulan Jakarta saat permintaan diterima, bentuk `YYYY-MM`.
`customer_id` adalah nama firma apa adanya, karena itu yang dibaca pelanggan di
halaman invoice dan di riwayat operator.

Alur satu permintaan:

1. Baca `opera_price_list` (fungsi sudah punya `priceList()` di `index.ts:167`).
2. `priceOrder(body, prices, now)` mengembalikan `{ customerId, period, lines }`
   atau alasan penolakan. `lines` = satu baris `{ kind, quantity: 1 }`; harga
   baris dihitung `amountFor` yang sudah ada, bukan angka dari browser.
3. `invoice_id` sudah pasti sebelum invoice dibuat: `createInvoice` menyusunnya
   `${customer_id}:${period}` (`index.ts:376`). Jadi baris order ditulis lebih
   dulu, dengan id itu, `on conflict (firm, period) do update set contact`,
   sehingga submit ulang memperbarui kontak dan tidak menulis baris kedua.
4. `createInvoice({ customer_id, period, lines })` — jalur yang sudah idempoten
   dan sudah menolak invoice yang lunas dibuka ulang.
5. Jawab 303 ke `${BILLING_PAGE_URL}?invoice_id=…&token=…`. Worker menulis ulang
   Location itu ke `/invoice?…` dengan aturan yang sudah ada
   (`pageLocation`, `_worker.js:59`).

Kalau langkah 4 gagal, baris order tetap ada dan tidak ada invoice; submit ulang
mengambil baris yang sama dan mencoba lagi, jadi kegagalan itu menyembuhkan diri
dan pembeli tidak pernah dikirim ke invoice yang tidak ada.

### Tabel `opera_price_orders`

Satu baris per order publik. Migrasi baru
`supabase/migrations/20261103110000_opera_price_orders.sql`:

| Kolom | Tipe | Arti |
|---|---|---|
| `id` | `bigserial primary key` | urutan order |
| `firm` | `text not null` | nama firma yang diketik pembeli |
| `period` | `text not null` | bulan Jakarta, `YYYY-MM` |
| `contact` | `text not null` | nomor WhatsApp atau email |
| `kind` | `text not null` | `plan.pilot` atau `plan.firm` |
| `amount_cents` | `integer not null` | harga saat order, supaya riwayat tidak ikut berubah saat harga berubah |
| `invoice_id` | `text not null` | invoice yang dibuat action ini |
| `created_at` | `timestamptz not null default now()` | dasar batas laju dan urutan kerja operator |

Batasan dan hak akses:

- `unique (firm, period)` — satu firma satu bulan satu invoice; ini juga yang
  membuat submit ulang mengembalikan link yang sama.
- `index on (created_at)` — untuk hitungan batas laju dan untuk operator.
- RLS nyala, tanpa policy: hanya `service_role` yang membaca dan menulis. Tidak
  ada grant ke `anon` atau `authenticated`.
- Tidak ada kolom IP, user agent, atau token. Kontak adalah satu-satunya data
  pribadi, dan handoff menyebut cara menghapus baris uji.
- File migrasi menulis baris ledger-nya sendiri, pola yang sama dengan
  `20261012110000_drop_command_insert_signal.sql`, dan `ledger-map.json`
  mencatatnya sebagai `version-and-name` setelah diterapkan.

### Pembacaan operator

Operator tidak butuh halaman baru. Satu query di handoff:

```sql
select o.created_at, o.firm, o.contact, o.kind, o.amount_cents, i.status, i.paid_at
from opera_price_orders o
join opera_invoices i on i.id = o.invoice_id
order by o.created_at desc;
```

## Model bahaya

| Ancaman | Jawaban |
|---|---|
| Order sampah memenuhi tabel | batas 30 baris baru per jam bergulir → 429; order yang tidak dibayar tidak menutup nominal apa pun |
| Order sampah menahan nominal QRIS | QR baru terbit saat halaman invoice dibuka, dan indeks satu-QR-terbuka hanya berlaku pada invoice yang sudah memegang payload; order yang tidak pernah dibuka tidak menahan nominal |
| Submit ganda membuat dua invoice | `unique (firm, period)` + `createInvoice` idempoten; submit kedua mengembalikan link yang sama |
| Nama firma sama di bulan yang sama | satu invoice untuk dua pembeli — limit yang dinamai; operator memisahkan dengan `settle-manual` atau mengganti nama. Perbaikan sejati adalah tabel pelanggan, di luar lingkup |
| Harga diubah saat order berjalan | `amount_cents` disalin ke baris order; invoice tetap memegang harga yang ditagih |
| XSS lewat nama firma atau kontak | halaman dirender fungsi dengan `escapeHtml` yang sudah dipakai halaman invoice; kontak tidak pernah dirender di halaman publik |
| Spam lintas situs | endpoint memang publik: tidak ada token di halaman, bentuk body divalidasi di fungsi, dan batas laju yang menahan volume; tidak ada rahasia yang bisa dicuri |
| Pembeli membayar plan yang tidak ada | `kind` dicocokkan ke baris `active`; baris yang dinonaktifkan menolak order baru tanpa mengubah invoice lama |

## Penanganan galat

- **Validasi gagal** → halaman harga dirender ulang, satu baris galat, nilai
  `firm` dan `contact` tetap terisi dan di-escape.
- **Batas laju** → halaman yang sama dengan pesan "terlalu banyak order, coba
  lagi nanti"; status 429.
- **Invoice gagal dibuat** → halaman dengan "invoice belum bisa dibuat, coba
  lagi"; tidak ada baris order dan tidak ada redirect.
- **Order sudah ada** → redirect ke invoice yang sama; tidak ada galat, karena
  submit ulang adalah perilaku yang wajar.
- **Halaman tidak bisa dimuat** (worker gagal menghubungi fungsi) → halaman
  `failure()` yang sudah ada, diperluas ke `/harga`: "halaman harga tidak bisa
  dimuat, coba lagi", status 502, tanpa stack trace.
- **Pembayaran tidak pernah masuk** → invoice tetap terbuka; tidak ada
  kedaluwarsa otomatis di jalur QRIS, dan handoff menyebut cara operator
  menutup atau membatalkannya.

## Pengujian

Modul murni diuji di Node, tanpa jaringan dan tanpa database:

- `tests/price-page.test.mjs` — harga dua plan tampil dari fixture harga, harga
  di atas kuota tampil sebagai catatan, form `action="/harga"`, tidak ada
  `<script>`, tidak ada token di HTML, galat mempertahankan dan meng-escape
  nilai, batas bulan Jakarta (2026-10-31T17:30Z → `2026-11`), validasi
  firma/kontak/kind, plan nonaktif ditolak, firm+period sama memakai invoice
  yang sama.
- `tests/invoice-worker.test.mjs` — tambahan: `GET /harga` diproksi dengan
  `page=harga` dan dijawab HTML yang boleh diindeks; `POST /harga` diproksi
  dengan body; 303 ditulis ulang ke `/invoice`; path lain tetap ke asset server;
  kegagalan adalah halaman.
- `tests/migration-ledger-map.test.mjs` — file migrasi baru ada di map dengan
  hitungan yang cocok setelah diterapkan.
- `npm test`, `npm run check` — suite penuh dan gerbang tree.

Tidak diuji unit: tulisan database di fungsi billing (insert order, hitungan
batas laju, redirect). Itu diukur live seperti Task 8 rel QRIS.

## Definisi selesai

- [ ] `opera_price_orders` ada di database live, dengan unique `(firm, period)`,
      RLS tanpa policy, dan baris ledger yang ditulis file itu sendiri.
- [ ] `GET /harga` menampilkan dua plan dan catatan di atas kuota dari
      `opera_price_list`, tanpa JavaScript dan tanpa token.
- [ ] `POST /harga` membuat satu invoice satu baris, menulis satu baris order,
      dan mengarahkan pembeli ke halaman invoice.
- [ ] Submit ulang untuk firma dan bulan yang sama mengembalikan invoice yang
      sama dan tidak menulis baris order kedua.
- [ ] Pembayaran QRIS sungguhan menutup invoice tanpa operator, dan baris order
      menunjuk invoice yang lunas.
- [ ] Nav situs menautkan `/harga`; halaman invoice tetap `noindex`.
- [ ] `docs/product/billing.md`, `docs/product/monetization.md`, dan
      `docs/handoff.md` menyebut halaman, action publik, tabel order, batas
      laju, dan aturan refund.

## Urutan kerja

1. **Migrasi `opera_price_orders`** — tabel, unique, index, RLS, baris ledger
   sendiri, entri `ledger-map.json`, diterapkan dari main checkout.
2. **`_shared/price-page.js`** — renderer dan validasi murni, dengan tesnya.
3. **Fungsi billing** — cabang GET `?page=harga`, action `price-order`, hitungan
   batas laju, insert order, redirect 303.
4. **Worker** — `/harga` GET dan POST, header halaman publik, penulisan ulang
   Location, kegagalan sebagai halaman, dengan tes worker.
5. **Nav** — tautan "Harga" di `landing/beranda.html` dan `landing/fitur.html`.
6. **Deploy berurutan** — migrasi, fungsi billing, worker; lalu drive live:
   bayar Rp 99.000 dari aplikasi sungguhan dengan firma uji, invoice tertutup,
   baris order ada, baris uji dihapus.
7. **Dokumen** — billing, monetization (perubahan kebijakan dan refund), handoff
   (tabel, batas, query operator).

Langkah 3 bergantung pada rel QRIS untuk QR di halaman invoice. Kalau halaman
ini mendarat lebih dulu, invoice tetap bisa dibayar lewat instruksi transfer,
dan QRIS menyala saat relnya hidup.
