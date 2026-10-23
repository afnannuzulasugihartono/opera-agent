@last-edited: 2026-10-23 UTC+7.
@related: [`../../../AGENTS.md`](../../../AGENTS.md) - [`../uec-north-star.md`](../../uec-north-star.md) - [`../../handoff.md`](../../handoff.md) - [`2026-10-08-execute-graph-design.md`](2026-10-08-execute-graph-design.md) - [`../../naming.md`](../../naming.md) - [`../../product/browser-latency.md`](../../product/browser-latency.md)

# Spec: `run_task` — satu panggilan berbentuk task di surface lokal

Disetujui sebagai arah pada 2026-10-23. Spec ini belum membangun apa pun; ia
memutuskan bentuk, batas, dan urutan langkah sebelum kode disentuh.

## Intent

Surface lokal hari ini menjual **verba**, sementara surface cloud menjual
**tugas**. Harness yang memakai path lokal — path yang satu-satunya keunggulan
adalah round trip di bawah satu milidetik dan tanpa ketergantungan cloud —
harus sendiri melakukan observe → decide → act → verify → recover dalam N
giliran, memilih dari 38 tool.

`run_task` menutup itu: harness menyerahkan satu graph task, dan menerima
satu jawaban berisi hasil plus jejak pass/fail per node. Observe-decide-act-
verify dari N giliran menjadi satu panggilan.

Target yang diukur, bukan yang diklaim: job tiga langkah bergantung hari ini
berbiaya **456.94 ms** karena ia tiga panggilan MCP terpisah — angka itu sudah
terukur di [`browser-latency.md`](../../product/browser-latency.md), dan
`run_task` belum mengubahnya. Satu panggilan untuk job yang sama adalah sasaran
spec ini, dan buktinya adalah angka setelah, bukan kalimat ini.

Efek keduanya: biaya snapshot setelah aksi — yang diukur hampir **tiga puluh
persen** dari seluruh tool call, hampir semuanya tepat setelah sebuah aksi —
hilang dari pemanggil karena page look terjadi sekali di dalam runner, bukan
sekali per langkah di harness.

## Non-goals

- Tidak ada verba browser baru. `run_task` menyusun verba yang sudah ada.
- Tidak ada kode per-situs di mana pun, dan tidak ada `eval` bebas.
- Tidak ada branching, loop, atau `foreach` di Stage 1. Linear dulu.
- Tidak ada model, endpoint, atau key yang masuk ke graph, queue, atau disk.
- Tidak menyentuh surface cloud. `run_adhoc` di cloud tetap jalan sendiri.
- Tidak mengganti `browser_burst`; `run_task` adalah lapisan di atasnya.

## Fakta terverifikasi

Angka-angka ini diambil dari pohon pada 2026-10-23. Yang tidak bisa dibuktikan
tidak masuk spec ini.

### Dua kosakata yang tidak sama

Ini temuan pusat spec, dan ia memutuskan bentuk Stage 1.

`supabase/functions/_shared/adhoc-compile.js` — compiler yang sudah ada dan
**murni** (tanpa I/O) — mengeluarkan *runner-shaped definition* dengan tipe node:

| Konstanta | Nilai |
|---|---|
| `MAX_COMMAND_NODES` | 12 |
| `MAX_DEFINITION_BYTES` | 32768 |
| `REPEAT_MAX` | 6 |
| `FOREACH_MAX` | 100 |
| `WAIT_MAX_MS` | 120000 |
| `NODE_TYPES` | `command`, `if`, `repeat`, `foreach`, `set`, `wait`, `fail` |

dengan method bertitik: 10 baca (`page.read`, `page.find`, `page.query`,
`page.collect_links`, `page.scroll`, `page.wait_for`, `tabs.list`, `tabs.get`,
`tabs.find`, `media.state`) dan 4 tulis (`page.click`, `page.fill`, `page.key`,
`page.focus`).

`local/burst.js` — runner yang sudah ada di mesin yang sama — berbicara
kosakata lain:

| Konstanta | Nilai |
|---|---|
| `BURST_MAX_STEPS` | 8 |
| `BURST_MAX_TIMEOUT_MS` | 12000 |
| `BURST_ACTIONS` | `click`, `click_row`, `hover`, `press_key`, `type`, `append`, `scroll`, `stream_keys`, `resolve`, `wait` |

**Konsekuensinya: `adhoc-compile.js` tidak bisa dipakai verbatim.** Output-nya
adalah node `command` bernama method bertitik; input burst adalah nama aksi
lokal. Burst juga tidak punya `if`, `repeat`, `foreach`, `set`, atau `fail`.
Ada lapisan terjemahan yang harus ditulis, atau runner graph lokal sendiri.

### Di mana kosakata itu tidak punya pasangan

Pemetaan yang nyata hampir satu-ke-satu, dengan dua pengecualian yang harus
disebut jujur:

- `click_row` dan `append` adalah **komposisi lokal** — resolve lalu klik, dan
  end-key lalu isi — tanpa satu method bertitik yang padanan. Cloud menyelesaikan
  pekerjaan yang sama dengan `find_elements` + `click_element` by ref.
- `page.query`, `page.collect_links`, `media.state`, dan `tabs.find` adalah
  method cloud tanpa verba lokal yang persis padanan. Stage 1 tidak memakainya.

### Yang sudah murni dan bisa dipakai dari Node

- `extension/lib/goal-plan.js` mengimpor hanya `./protocol.js`, dan
  `tests/goal-plan-request.test.mjs` sudah mengimpornya dari Node. Gate allowlist
  karena itu bisa dijaga di proses lokal, bukan hanya di browser.
- `extension/lib/protocol.js` memegang `ALLOWED_METHODS` sebanyak 31, dan
  `npm run check` membaca file itu untuk angka tersebut. Satu sumber, tidak ada
  salinan kedua.
- `local/burst.js` sudah punya `normalizeBurst` (penolakan step jelek sebelum
  browser disentuh) dan `runLocalBurst` (runner stop-on-failure, satu tab, satu
  page look di akhir).

### Biaya yang diukur

| Job | Sekarang p50 | Dengan `run_task` |
|---|---:|---|
| tiga panggilan MCP bergantung | 456.94 ms | satu panggilan |
| satu `browser_burst` tiga langkah | 76.83 ms | dasar perbandingan |
| `guide` sudah ada | — | pintu depan yang benar, perlu dipakai |

## Arsitektur

```
harness (MCP client)
  -> tools/call run_task { tabId, nodes, timeoutMs }
     -> gate: tolak node dan method di luar allowlist SEBELUM browser disentuh
     -> translate: node graph -> burst steps (kosakata lokal)
     -> runLocalBurst: jalankan berurutan, stop on failure, satu tab
     -> verify: bukti per langkah dari jawaban burst itu sendiri
     -> satu page look di akhir (afterAction yang sudah ada)
  <- { ok, status, steps: [{ node, ok, why, ... }], page }
```

Gate berjalan lebih dulu, dan itu bukan detail: step list yang salah harus
ditolak sebelum satu pun aksi menyentuh halaman. `normalizeBurst` sudah
memegang prinsip itu untuk burst; `run_task` memegangnya untuk graph.

## Skema

Node Stage 1 hanya `command`. Bentuknya:

```json
{
  "tabId": "t1",
  "nodes": [
    { "type": "command", "action": "resolve", "role": "row", "name": "Total" },
    { "type": "command", "action": "click_row", "role": "button", "name": "Run" },
    { "type": "command", "action": "wait", "text": "Done", "timeoutMs": 5000 }
  ],
  "timeoutMs": 8000
}
```

Yang dijaga gate, masing-masing dengan tesnya:

- `action` harus salah satu dari `BURST_ACTIONS`. Bukan method bertitik — itu
  kosakata cloud, dan mencampurnya adalah cara paling cepat membuat log tidak
  bisa dibaca.
- `refFromStep` hanya menunjuk ke langkah sebelumnya, dan satu langkah memakai
  tepat satu dari x/y, handle, atau `refFromStep`. Dua aturan itu sudah dijaga
  `refOf` dan `targetOf` di `local/burst.js`; `run_task` mewarisanya, tidak
  menulisnya ulang.
- Satu tab, secara struktural: burst lokal menerima satu driver dan tidak punya
  jalan untuk pindah. Penolakan lintas-tab yang bernama
  (`burstCrossTabRef`) adalah milik runner cloud dan **tidak** ada di path lokal;
  spec ini tidak mengklaimnya.
- Jumlah node dibatasi, dan `timeoutMs` dijepit. Angka batas diambil dari burst
  yang sudah ada, bukan ditemukan kembali di sini.
- Label konsekuensial — pola `CONSEQUENTIAL_LABEL` yang sudah ada di
  `adhoc-compile.js` — dipakai ulang untuk arah yang bisa membayar, menghapus,
  mengirim, atau membagikan. Stage 1 menolaknya, bukan mengonfirmasinya.

Jawaban membawa jejak per node: `ok`, dan saat gagal `why` yang menamai langkah
mana yang jatuh dan apa yang dilihat halaman. Status parsial yang jujur, bukan
error buta — aturan yang sama yang spec cloud pegang.

## Langkah

Tiga tahap, dan yang pertama sudah berguna sendirian.

**Tahap 1 — linear saja.** `command` node diterjemahkan ke burst steps,
dijalankan, diverifikasi, dilaporkan. Tanpa `if`, tanpa `repeat`, tanpa `set`.
Ini sudah menutup mayoritas job harian: resolve, klik, tunggu, baca.

**Tahap 2 — branching.** `if` dan `repeat` butuh runner yang bisa memutuskan di
tengah jalan, dan itu bukan burst. Tahap ini memakai `extension/lib/goal-plan.js`
sebagai gate, dan hanya dimulai setelah Tahap 1 terbukti pada job nyata.

**Tahap 3 — observasi berbasis ref.** `read_page` lokal mengembalikan ref stabil
seperti `read_page` cloud, dan `click` menerima ref. Ini yang membuat node
`resolve` tidak perlu ditulis harness sama sekali.

Tahap 3 sengaja terakhir: tanpa Tahap 1, ref hanyalah fitur lain yang harus
diingat harness.

## Batasan

- **Satu tab.** Burst lokal sudah menolak pindah tab, karena drive yang diam-diam
  pindah dokumen adalah cara batch mendarat di tempat yang salah. `run_task`
  mewarisi batas itu.
- **Tulis tetap butuh tab yang Listening.** Aksi input lewat focus guard yang
  sudah ada; tidak ada jalan pintas.
- **Allowlist tidak Melebar.** `run_task` tidak boleh menjadi celah eval. Gate
  membaca allowlist yang sama, dan tes yang memastikan method di luar daftar
  ditolak adalah tes yang wajib, bukan opsional.
- **`browser_burst` tetap ada.** Ia adalah jalan untuk harness yang sudah tahu
  langkahnya dan hanya ingin menghemat round trip. `run_task` adalah jalan untuk
  harness yang punya task.

## Pengujian

Semua di `npm test`, tanpa browser hidup:

- **Skema**: node type tak dikenal, action di luar `BURST_ACTIONS`, dan
  `refFromStep` ke langkah yang belum terjadi ditolak sebelum browser disentuh.
- **Budget**: node melewati cap dan `timeoutMs` di luar batas ditolak.
- **Terminasi**: burst yang berhenti di tengah menghasilkan status parsial yang
  menamai node mana yang lolos dan mana yang gagal.
- **Gate keamanan**: sebuah aksi konsekuensial ditolak di Stage 1.
- **Integrasi**: graph `resolve -> click_row -> wait` lulus dalam satu eksekusi
  lokal, dengan bukti per langkah.
- **Benchmark**: job tiga langkah bergantung diukur sebelum dan sesudah, pada
  mesin dan halaman yang sama, lewat `npm run benchmark:latency`.

## Risiko

- **Kosakata yang bocor.** Godaan menampung method bertitik "supaya sama dengan
  cloud" nyata, dan ia akan membuat satu baris log tidak bisa mengatakan lapis
  mana yang menjawab. Aturannya: nama lokal di surface lokal, dan titik tetap
  milik wire protocol — lihat [`naming.md`](../../naming.md).
- **Stage 2 mendahului Stage 1.** Branching terlihat lebih menarik daripada
  linear, dan itu jebakan: tanpa Tahap 1 yang terbukti, `if` hanya menambah cara
  gagal. Tahap 2 butuh bukti Tahap 1 lebih dulu.
- **`run_task` menjadi 38 verba baru.** Kalau tool itu mulai menerima setiap
  kemungkinan, ia bukan lagi satu panggilan task — ia adalah surface lama dengan
  nama baru. Cap dan allowlist yang dijaga tes adalah yang mencegah itu.
- **Bukti yang tidak diukur.** Klaim "lebih mudah dipakai" harus muncul sebagai
  angka: jumlah panggilan dan p50 pada job yang sama, bukan perasaan.
