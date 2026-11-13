# Proof run: one browser, four files

The local MCP server drove a throwaway Chrome over stdio: it opened the fixture portal, read the page, downloaded the CSV, and built the four files the site offers. Each file was hashed and compared with the same-named file in `landing/contoh/`.

Browser: Google Chrome. Deck slides: 5.

| # | call | ms | what it left |
| --- | --- | --- | --- |
| 1 | `initialize` | - | server opera-local |
| 2 | `tools/list` | - | 54 tools |
| 3 | `open_url` | 176 | tab D2C222B207AE26C168F6322844A94F55 · http://127.0.0.1:53548/portal.html |
| 4 | `read_page` | 28 | 423 characters read |
| 5 | `download` | 712 | 1109 bytes landed |
| 6 | `stage` | - | 3 paper sources copied beside the CSV |
| 7 | `spreadsheet_build` | 31 | 3 sheets, 7 figures checked |
| 8 | `deck_build` | 7 | 4 content slides and a cover |
| 9 | `document_write` | 5 | 13 blocks, Dampak Promosi terhadap Kinerja Kanal Sinar Jaya |
| 10 | `document_write` | 3 | 13 blocks, Rencana Pemasaran 2027 - Sinar Jaya |
| 11 | `capture_page` | 39 | 48210 picture bytes |
| 12 | `close_tab` | 8 | tab D2C222B207AE26C168F6322844A94F55 closed |

| file | bytes | sha256 | equals |
| --- | --- | --- | --- |
| `docs/proof/downloads/transaksi-2026-09.csv` | 1109 | `8e0f64810fd70e91101051afb85a814df12a87b1eafde048272049ed6a3667a2` | `tests/fixtures/mock-company/transaksi-2026-09.csv` |
| `docs/proof/out/laporan-keuangan-2026-09.xlsx` | 21066 | `a4f12765b77329eb5ec37dae3ad4323ac1d1d6659cd6261bb689c2736c931922` | `landing/contoh/laporan-keuangan-2026-09.xlsx` |
| `docs/proof/out/rencana-strategis-2027.pptx` | 32871 | `6f3f42a4dd2465fa8e77bf33572ac3949b5097eaec1aaebaeda074ac4a71806e` | `landing/contoh/rencana-strategis-2027.pptx` |
| `docs/proof/out/riset-promo.docx` | 23485 | `1758824cd0cf0b15a6f9531cd13ff5d42de277776b8a0cd87b8d927184ba38e1` | `landing/contoh/riset-promo.docx` |
| `docs/proof/out/rencana-pemasaran-2027.docx` | 18509 | `104e43eac8e80e1860e1bc52c61414e81dcac43a1bea2f424537e4754517b8b6` | `landing/contoh/rencana-pemasaran-2027.docx` |

The hashes in `run.jsonl` are rechecked against `landing/contoh/` by `tests/proof-run.test.mjs`, so this record cannot drift away from what the code makes.
