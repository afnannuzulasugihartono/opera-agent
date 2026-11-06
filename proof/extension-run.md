# Extension run: the extension drove the browser

The loopback bridge was already up on this machine with the extension linked to it, so the local MCP server joined that bridge and every call below travelled through the extension. No debugging port, no cloud relay.

Browser: the browser the extension was linked to. Extension id: `ofgemipoobcnbjkfanmofjbdonjapmgl`. Bridge: 127.0.0.1:9451. Tools the server advertised: 54.

| # | call | what it left |
| --- | --- | --- |
| 1 | `browser_status` | the bridge on 9451 is the road in use |
| 2 | `open_url` | tab 1517046868 opened the fixture portal |
| 3 | `read_page` | 423 characters read from the portal |
| 4 | `find_elements` | 1 match for "Unduh CSV" |
| 5 | `download` | pressed the download control "Unduh CSV" at 379,482; 1109 bytes landed, armed through browser-folder |
| 6 | `capture_page` | 53301 picture bytes |
| 7 | `close_tab` | tab 1517046868 closed |

| file | bytes | sha256 | equals |
| --- | --- | --- | --- |
| `transaksi-2026-09.csv` | 1109 | `8e0f64810fd70e91101051afb85a814df12a87b1eafde048272049ed6a3667a2` | `tests/fixtures/mock-company/transaksi-2026-09.csv` |

`tests/extension-run.test.mjs` re-hashes the fixture in the tree and compares it with the hash in `extension-run.jsonl`, so the record cannot claim bytes the fixture does not hold. It does not drive a browser again, so the calls themselves are proven by the run and not by the test.
