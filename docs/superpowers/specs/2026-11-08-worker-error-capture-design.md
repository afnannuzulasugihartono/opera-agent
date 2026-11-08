# Spesifikasi: Tangkap Error Service Worker

@last-edited: 2026-11-08 UTC+7.
@related: [AGENTS.md](../../../AGENTS.md) - [docs/agent-call.md](../../agent-call.md)

Disetujui sebagai arah pada 2026-11-08. Spec ini membuat ekstensi menangkap error yang dihasilkan service worker-nya sendiri, sehingga fault terbaca dari popup dan dari agent, bukan hanya dari halaman Errors di `chrome://extensions`.

## Intent

Hari ini sebuah error tak tertangkap di service worker hanya muncul di `chrome://extensions` → Errors, dan hanya orang yang membuka halaman itu yang melihatnya. Agent tidak bisa membacanya sama sekali. Padahal fault yang paling sering terjadi justru fault yang dilempar ke kanal itu: `TypeError` dari baris yang salah, promise yang menolak tanpa penangkap, dan kegagalan Chrome API yang sudah ditangkap kode lalu dicatat di level debug — di bawah ambang `warn`, jadi tidak pernah tercetak dan hanya tersimpan di ring buffer yang tidak dibaca siapa pun.

Tujuan spec ini: satu tempat yang menampung fault worker, dibaca manusia lewat popup dan dibaca agent lewat `browser_status`, dengan pesan utuh dan tanpa banjir duplikat.

Keputusan yang mengikat (hasil brainstorming 2026-11-08):

- **Dua jendela, satu sumber.** Popup membaca ring buffer yang sudah ada; agent membaca daftar fault lewat `browser_status`.
- **Yang ditangkap:** error tak tertangkap, promise rejection tak tertangani, dan kegagalan API yang hari ini sudah dinamai lalu ditelan di level debug.
- **Pesan utuh, tanpa stack.** Tidak ada potongan panjang buatan. Stack trace tidak disimpan.
- **Daftar terpisah dari ring log.** Ring 200 entri bercampur level, jadi churn debug bisa menggusur fault yang dicari.
- **Tanpa tool baru.** `browser_status` bertambah field; tidak ada tool atau parameter baru.

## Non-goals

- Tidak menangkap error halaman (content script). Itu tetap jalur `OperaAgentLog` yang sudah ada.
- Tidak menyimpan stack trace, tidak mengirim telemetry ke server, tidak menulis ke dashboard.
- Tidak mengubah bentuk `bridge.lastError`, `connectionState.lastError`, atau ring buffer 200 entri.
- Tidak menangkap error yang sudah ditangani dan **tidak** dinamai (mis. `catch {}` kosong) — itu pekerjaan audit tersendiri.

## Yang ditangkap

### Kanal worker

`extension/worker/error-capture.js` (baru) mengekspor satu fungsi:

```
captureWorkerErrors({ target, log }) -> { installed: true }
```

- Memasang dua listener pada `target` (di produksi: `self`, yaitu `ServiceWorkerGlobalScope`):
  - `'error'` → `log.error('WORKER_UNCAUGHT_ERROR', message)`
  - `'unhandledrejection'` → `log.error('WORKER_UNHANDLED_REJECTION', message)`
- `message` adalah pesan utuh dari `event.error?.message`, lalu `event.reason?.message`, lalu `String(event.message ?? event.reason ?? '')`. Tidak dipotong, tidak berisi stack.
- Tidak memanggil `preventDefault()`: penangkapan ini **menambah** catatan, bukan menggantikan laporan Chrome. Error yang sama tetap tampil di `chrome://extensions`.
- Bentuk `{ target, log }` dipilih supaya bisa diuji di Node dengan target palsu, tanpa worker dan tanpa Chrome.
- Dipanggil sekali saat worker mulai, dari `extension/background.js`.

### Kegagalan yang naik dari debug ke error

Hanya kegagalan yang berarti ada yang rusak, bukan jalur normal:

| Kode | Berkas | Alasan |
|---|---|---|
| `AX_SUMMARY_COLLECTION_FAILED` | `extension/background.js` | probe aksesibilitas gagal; `read_page` kehilangan bukti, bukan sekadar lewat |
| `TAB_ZOOM_PROBE_FAILED` | `extension/background.js` | zoom tab tidak terbaca; geometri yang dilaporkan bisa salah |
| `USER_STATE_PROBE_FAILED` | `extension/background.js` | status tab/jendela tidak terbaca |
| `RESPONSE_BODY_PARSE_FAILED` | `extension/worker/tab-content.js` | balasan bridge bukan JSON; jalur itu sedang rusak |

`CONTENT_PING_FAILED` **tidak** dinaikkan: itu jalur normal — probe sebelum injeksi content script, yang gagal setiap kali halaman belum punya script-nya.

## Daftar fault

`extension/lib/agent-log.js` tetap memegang ring buffer 200 entri yang sudah dibaca popup. Ia bertambah satu daftar kedua:

```
log.errors() -> [{ code, message, count, firstAt, lastAt }]   // terbaru dulu
log.clearErrors() -> undefined
log.errorCount() -> number                                     // total fault sejak worker hidup
```

- Hanya `log.error(...)` yang mengisi daftar ini; `debug` dan `warn` tidak.
- Dideduplikasi pada `code` + `message`: entri yang sama menambah `count` dan memperbarui `lastAt`, tidak menambah baris.
- Maksimum 20 entri unik; entri terlama dibuang saat batas tercapai.
- Pesan disimpan utuh (tidak dipotong 300 karakter seperti `bridge.lastError`), karena keputusan brainstorming: pesan adalah isi semantik, dan anggaran jawaban yang membatasinya, bukan pesannya.
- `entries()` dan `clear()` tetap seperti sekarang; popup tidak berubah.

## Yang dibaca agent

`browser.ping` (tool `browser_status`) bertambah dua field:

```json
{ "ok": true, "paired": true, "errors": [{ "code": "WORKER_UNHANDLED_REJECTION", "message": "…", "count": 2, "firstAt": "…", "lastAt": "…" }], "errorCount": 2 }
```

- `errors[]` berisi daftar fault di atas, terbaru dulu.
- `errorCount` adalah total fault sejak worker hidup — ia tidak mengecil saat entri dibuang atau daftar dibersihkan, jadi ia menjawab "apakah ada yang pernah gagal", sementara `errors[]` menjawab "apa yang gagal sekarang".
- **Anggaran jawaban.** Pesan tidak dipotong, jadi jawaban bisa besar. Kalau `browser_status` akan melampaui anggaran hasil perangkat, `background.js` membuang entri **tertua** sampai muat dan menambahkan `errorsTruncated: true` serta `omittedErrors: n`. Ini pola yang sama dengan pemangkasan peta halaman: pemangkasan disengaja, alasannya terbaca, bukan kegagalan.
- Field lama (`paired`, `product`, `version`, `protocolVersion`, `deviceName`, `bridge`, `capabilities`, `time`) tidak berubah.

## Batas dan performa

- Daftar fault maksimum 20 entri; dedup membuat error yang berulang tidak menambah baris.
- Tidak ada I/O tambahan: daftar hidup di memori worker, seperti ring buffer.
- `browser_status` tanpa fault tidak bertambah berat secara berarti (`errors: []`, `errorCount: 0`).

## Risiko yang diterima

- **Pesan utuh bisa memuat URL bertoken.** Worker tidak bisa memakai `lib/secret-pattern.js` (di luar bundel extension) dan gate `scripts/check.mjs` menolak salinan literalnya. Diterima sesuai keputusan brainstorming; anggaran jawaban membatasi besarnya, bukan isinya. Mitigasi: tidak ada objek mentah dan tidak ada stack yang disimpan.
- **Dua laporan untuk satu error.** Chrome tetap mencetak error tak tertangani ke `chrome://extensions`, dan kita menambahkan catatan sendiri. Diterima: menghilangkan cetakan Chrome berarti menyembunyikan bukti.
- **Fault sebelum capture terpasang hilang.** Error yang terjadi sebelum `captureWorkerErrors` dipanggil saat load tidak tertangkap. Diterima; pemanggilan diletakkan sedini mungkin di `background.js`.
- **Daftar hilang saat worker tidur.** MV3 mematikan worker saat idle, dan daftar hidup di memori. Diterima: `errorCount` juga ikut hilang, dan gejalanya terlihat sebagai daftar kosong pada worker yang baru bangun — bukan klaim palsu bahwa tak ada error.

## Uji

- `tests/worker-error-capture.test.mjs` (baru): kedua listener terpasang pada target palsu; `error` menghasilkan satu `log.error('WORKER_UNCAUGHT_ERROR', …)`; `unhandledrejection` menghasilkan satu `log.error('WORKER_UNHANDLED_REJECTION', …)`; `event.error` yang bukan Error tetap menghasilkan pesan yang terbaca; `preventDefault` tidak dipanggil.
- `tests/agent-log-errors.test.mjs` (baru): dedup menambah `count` dan tidak menambah baris; `firstAt`/`lastAt` benar; batas 20 entri membuang yang terlama; `clearErrors()` mengosongkan daftar tapi tidak `errorCount`; `entries()` tidak terpengaruh.
- `tests/mcp-surface.test.mjs`: deskripsi `browser_status` menyebut `errors` dan `errorCount`; digest permukaan diperbarui.
- Uji perangkat nyata: `browser_status` menjawab `errors: []` dan `errorCount: 0` pada worker yang sehat.

## Di luar spec ini

- Penangkap error untuk popup dan content script.
- Pengiriman fault ke server atau dashboard.
- Stack trace dan source map.
- Audit `catch` kosong yang tidak dinamai.