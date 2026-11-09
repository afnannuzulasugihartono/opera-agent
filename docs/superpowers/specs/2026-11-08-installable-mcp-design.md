# Spesifikasi: MCP yang Bisa Di-install, Dua Mode

@last-edited: 2026-11-08 UTC+7.
@related: [AGENTS.md](../../../AGENTS.md) - [docs/agent-call.md](../../agent-call.md)

Disetujui sebagai arah pada 2026-11-08. Spec ini membuat surface MCP bisa dipasang dengan satu perintah, dengan dua mode — cloud dan local — dan membuat mode local berjalan dari paket yang terpasang, bukan dari clone repo.

## Intent

Dua masalah nyata, keduanya berakar pada packaging:

1. **Paket `opera-local` sudah ada tapi tidak pernah dipakai.** `local/package.json` sudah berbentuk paket npm (`bin: opera-local`, tanpa dependensi ✓), tetapi `files`-nya tidak memuat dua impor lintas-pohon — `../extension/lib/socket-protocol.js` dan `../extension/lib/endpoints.js` ✗. Paket yang terbit akan gagal memuat modul itu ✗. Karena itu agent yang butuh MCP lokal menjalankan `node local/bin/opera-local.js` **dari clone repo** ✗, dan itu yang terjadi berulang.
2. **Tidak ada satu perintah yang memasang MCP.** todaySurface hosted hanya bisa dipakai lewat konfigurasi MCP yang menunjuk URL ✗, dan surface local harus dari repo ✗.

Target: `npm i -g opera-agent-mcp` → `opera-agent-mcp cloud` atau `opera-agent-mcp local` ✓, keduanya jalan dari mana saja ✓, dengan mode local yang **terbungkus rapi** ✓.

## Keputusan yang mengikat (hasil brainstorming 2026-11-08)

- **Satu paket, mode sebagai argumen.** `opera-agent-mcp cloud` dan `opera-agent-mcp local` ✓.
- **Paket membawa seluruh kode local** ✓; extension tetap terpisah (CRX yang dipasang di browser) ✓ — Chrome tidak bisa memasang extension dari npm ✗.
- **Mode local talking lewat loopback bridge saja.** Jalan debug-port/CDP dihapus ✓: kecepatannya sama (localhost) ✓, tidak bisa lewat profil asli ✗ (Chrome menolak debug-port di profil Default ✓), dan satu browser dengan satu antrean lebih mudah dijaga ✓. Karena itu **drive lokal selalu melewati bridge** ✓✓ — titik di mana kuotanya ditegakkan ✓ (lihat spec paket ✓).
- **Mode cloud = proksi stdio ke MCP hosted** ✓, dengan login OAuth lewat browser ✓ (token statis dari env tetap berlaku untuk mesin ✓).
- **Tanpa dependensi baru** ✓ (repo ini bebas dependensi di surface extension ✓ dan paket local sudah begitu ✓).

## Bentuk paket

| | |
|---|---|
| nama | `opera-agent-mcp` ✓ |
| bin | `opera-agent-mcp` ✓ |
| type | `module` ✓ |
| engines | node >= 20 ✓ |
| dependensi | tidak ada ✓ |

`files` memuat `bin/`, seluruh modul `local/` yang dipakai server ✓, dan **dua modul yang diimpor lintas-pohon** ✗ → dipindah saat pack ✓ oleh langkah `prepack` yang menyalin `extension/lib/socket-protocol.js` dan `extension/lib/endpoints.js` ke dalam paket ✓, sehingga paket yang terbit **self-contained** ✓ (tidak ada impor ke luar paketnya ✗).

## CLI

| perintah | apa yang terjadi |
|---|---|
| `opera-agent-mcp local` | menjalankan server MCP lokal di atas loopback bridge ✓; kalau extension belum tersambung, jawabannya menyebut cara memperbaikinya ✓ (pesan `LINK_ERROR` yang sudah ada ✓) |
| `opera-agent-mcp cloud` | menjalankan server MCP stdio yang meneruskan ke endpoint hosted ✓; login OAuth lewat browser saat pertama kali ✓, token disimpan di folder config pengguna ✓; `OPERA_AGENT_MCP_TOKEN` dipakai kalau diisi ✓ |
| `opera-agent-mcp doctor` | mencetak apa yang terhubung: bridge ✓, perangkat ✓, versi extension ✓, status OAuth ✓, dan tautan unduhan CRX ✓ |
| `opera-agent-mcp --help` | daftar perintah ✓ |

Mode cloud dan local memakai **tool yang sama** dari sisi agent ✓: nama, skema input, dan bentuk keluaran tidak berbeda antar mode ✓ — perbedaannya hanya siapa yang menjalankan browser ✓.

## Yang dihapus

- Jalan debug-port di `local/driver.js` ✓ dan pilihan `OPERA_LOCAL_TRANSPORT=cdp` ✓; `unset (auto)` tidak lagi jatuh ke CDP ✓.
- Peluncuran browser lewat `--remote-debugging-port` di `local/browsers.js` ✗ dan di `scripts/proof-run.mjs` ✓ (drive-nya sudah lewat bridge ✓, dan `scripts/extension-run.mjs` sudah punya mode "joined" tanpa port ✓).
- `OPERA_LOCAL_PORT` sebagai caraNob提着 browser ✓ (dokumentasi ikut diperbarui ✓).

**Yang tetap ada:** seluruh 54 tool lokal ✓ — bridgeantik membawa perintah CDP yang sama ✓, jadi upload, file chooser, builder dokumen, menu, caret, gate, dan captcha tetap jalan ✓.

**Yang benar-benar mati:** otomatisasi tanpa extension ✗ — menjalankan Chromium sekali pakai untuk tes harus memasang extension di profil itu ✓.

## Versi extension

CRX yang terbit pada 2026-11-08 memakai versi yang sama dengan build sebelumnya ✗, sehingga Chrome tidak pernah memasang pembaruan itu ✗ (Chrome hanya memasang bila versinya naik ✓). Extension naik ke **1.6.28** ✓: manifest ✓, package.json ✓, klaim versi di situs ✓, cek `scripts/check.mjs` ✓, dan docs ✓. Setelah itu, setiap build baru alcanzar instalasi yang ada ✓.

## Dampak pada surface

| | hosted | local |
|---|---|---|
| jumlah tool | 35 ✓ | 54 ✓ |
| peta halaman | ada ✓ (`read_page_map`) ✓ | ikut, lewat bridge ✓ (satu implementasi ✓) |
| latensi | 9-14 detik (cacat jalur baca API, terpisah) ✓ | localhost ✓ |

## Uji

- **Paketnya utuh.** Uji yang mengemas paket (tanpa menerbitkan) dan memeriksa: `files` paket memuat dua modul lintas-pohon ✓, tidak ada impor ke luar paket ✓, dan `node bin/opera-agent-mcp.js --help` jalan dari hasil unpack ✓.
- **Mode local dari paket.** Uji yang menjalankan server dari direktori paket hasil unpack ✓ dan menjawab `browser_status` lewat bridge ✓.
- **Mode cloud.** Uji yang mengarahkan proksi ke endpoint hosted dan memeriksa satu panggilan tool ✓ (dijalankan terhadap deployment ✓).
- **Jalan tunggal.** Uji yang menyatakan `OPERA_LOCAL_TRANSPORT=cdp` **tidak lagi** memaksa jalan port ✓ dan `local/driver.js` tidak lagi memuatNasc client port ✓.
- `npm test`, `npm run check`, dan `py tests/browser_extension_test.py` ✓.

## Risiko yang diterima

- **Instalasi tanpa extension tidak bisa dipakai.** Mode local sekarang menuntut extension ✓; tanpa itu CLI menjawab jujur ✓.
- **Satu paket untuk dua permukaan** — versi paket harus bergerak bersama surface ✓; selama belum ada rilis npm, `version` paket naik saat surface berubah ✓.
- **OAuth di CLI** butuh alur browser pada mesin tanpa browser ✗; mesin itu memakai token statis ✓.

## Di luar spec ini

- Menerbitkan paket ke npm ✗ (publikasi adalah keputusan pemilik ✗; spec ini hanya membuat paketnya benar dan siap ✗).
- Mengganti nama paket `opera-local` lama di registry ✗ (belum pernah terbit ✗).
- Mode `cloud` yang memakai server hosted sendiri secara lokal ✗ (proksi cukup ✓).
