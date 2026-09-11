# Performance Benchmarks

## Reproduction

Run the deterministic extension benchmark/regression against installed Opera on Windows:

```powershell
$env:OA_BROWSER_EXECUTABLE='C:\Users\ASUS\AppData\Local\Programs\Opera\opera.exe'
$env:OA_BROWSER_HEADLESS='0'
py -3 tests/browser_extension_test.py
```

The test uses an OS-assigned loopback port, an isolated temporary profile, a local synthetic article, and the real signed-identity manifest key. Each command records end-to-end local bridge latency and request/response byte counts. Results are observations, not latency assertions.

## Real Opera result — 2026-09-09

Environment: installed Opera on Windows, isolated profile, protocol 1, extension ID `pagjlnohdemoohcncicjmaejedcmcocm`.

| Case | Commands | Observed latency | Result |
|---|---:|---:|---|
| `browser.ping` | 1 | 7.15 ms | passed |
| `tabs.find` | 1 | 119.55 ms | passed |
| `tabs.open` + complete wait | 1 | 104.34 ms | passed |
| small `page.read` | 1 | 12.04 ms | 300 characters + one element |
| 10k semantic `page.read` | 1 | 14.18 ms | 33,801-byte page payload |
| 12k text-only `page.read` | 1 | 9.30 ms | 12,266-byte page payload |
| two-chunk long article read | 2 | 20.58 ms | 23,866 characters, no extra read |
| generic query + trusted click | 2 | 30.29 ms | passed |
| generic fill + Enter | 2 | 24.51 ms | passed |
| already-active tab | 1 | 9.17 ms | `reused:true` |
| already-current navigation | 1 | 7.30 ms | `reused:true` |
| reconnect + browser restart | 2 pings | 7.99 ms observed ping total | passed |

For the element-heavy synthetic page, text-only mode reduced the page payload by 21,535 bytes, from 33,801 to 12,266 bytes (about 63.7%), while returning more text per chunk. This is one controlled observation, not a universal speed claim.

## New-identity Opera acceptance

The separately signed 1.1.0 candidate was loaded in real Opera with extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick`. The full regression passed: 10,000-character semantic reads, 23,866-character text-only continuation, tab fast paths, trusted click/fill, sensitive-field and file-upload protection, network reconnection, and browser-restart reconnection. Its text-only payload remained 12,266 bytes versus 33,801 bytes for the semantic read.

## Existing production workflow baseline

The earlier production measurements in `docs/efficiency.md` found that replacing repeated Edge-side command-status requests with one `opera_await` reduced median runner overhead not explained by browser command totals from roughly 363 ms to 271 ms (about 25%). No end-to-end speedup was claimed because the browser/network sample was noisy.

## Production smoke after runner v6

An online paired Opera 1.0.1 client completed `browser.status` after the merge using protocol 1 and all 23 capabilities. The workflow reported 3,228 ms queue time and 571 ms execution time. Its single `browser.ping` command reported 84 ms queue time, 302 ms execution time, and 386 ms total time. Telemetry recorded 471 returned bytes, zero retries, zero fixed waits, and no truncation. This verifies compatibility and telemetry wiring; the queue-heavy single sample is not a throughput claim.

## Production benchmarks still required

Runner v6 and migration `20260909021225_extension_1_1_text_only_workflows` are deployed. The following cases still require an active paired Opera/YouTube session, so their post-deployment timings were not fabricated:

- YouTube open/search workflow;
- recommendation/play no-ad and naturally encountered ad paths;
- long transcript extraction;
- production generic article extraction with workflow telemetry.

## Opera Agent 1.2.0 bounded-burst acceptance — 2026-09-10

An isolated real-Opera run using the established extension identity completed the full regression, restart/reconnect checks, sensitive-target rejection, and 20 consecutive bounded-burst stability iterations.

| Case | Local commands | Observed latency | Result |
|---|---:|---:|---|
| fill + trusted key + trusted pointer + state wait + 300-character read | 1 burst / 5 steps | 52.78 ms | passed |
| two-step find + text-only read stability | 20 bursts | 22.46 ms median | 20/20 passed |
| sensitive pointer followed by fill | 1 burst / 2 proposed steps | 22.36 ms | first step rejected; second did not run |

The five-step result demonstrates local batching and one lazy debugger session, not a production end-to-end speedup. Production MCP/Supabase latency must be measured after the matching extension, method migration, and MCP function are deployed.

During the next live workflow run, record workflow queue time, execution time, command count, browser timing, returned bytes, retries, and fixed waits. Do not turn one machine's timings into test assertions.

## Semantic Runtime 1.5.2 baseline — 2026-09-11

Checkpoint 5A locks the accepted 1.5.2 behavior before semantic identity or delta
logic is introduced. Reproduce the three-run metadata-only baseline with:

```powershell
npm run benchmark:semantic
```

The runner executes the complete controlled browser regression three times against
an isolated synthetic page and fingerprints the nine-scenario scrubbed replay
corpus. It writes no telemetry files and emits no page text, screenshots, form
values, credentials, or private URLs.

| Case | Samples | Median | p95 | Median response |
|---|---:|---:|---:|---:|
| `browser.ping` | 9 | 5.91 ms | 7.81 ms | 822 bytes |
| `page.read.small` | 3 | 11.73 ms | 12.08 ms | 1,675 bytes |
| `page.read.semantic` | 3 | 15.23 ms | 17.97 ms | 38,635 bytes |
| `page.read.text-only.chunk-1` | 3 | 9.45 ms | 10.34 ms | 12,830 bytes |
| `page.capture.viewport` | 3 | 45.87 ms | 58.54 ms | 15,222 bytes |
| five-step browser burst | 3 | 20.37 ms | 20.75 ms | 3,482 bytes |

All three runs passed, changed no foreground focus, agreed on the installed
extension identity, and produced one deterministic replay fingerprint. The corpus
SHA-256 is
`277d87d655859bd2a291cf286e9584e0bdc20ff9272d8059758641dd49f8e091`.

Semantic-ID agreement and the single-item delta/full-snapshot ratio are correctly
recorded as unavailable: those features do not exist in 1.5.2. The locked gates
remain 100% identity agreement once Checkpoint 5B introduces identity, at most 50%
for a one-item delta once Checkpoint 5C introduces deltas, and at most 15% median
regression for the ordinary element-rich read on the same controlled environment.

### Checkpoint 5B paired performance gate

To control for machine noise, commit `4cbfbd0` and the 5B working candidate were
measured consecutively on the same Windows machine with three complete isolated
browser runs each. The accepted 1.5.2 rich-read samples were 19.41, 17.01, and
18.78 ms (median 18.78 ms). The final candidate median was 20.14 ms, a paired
regression of about 7.2%, below the locked 15% ceiling. The candidate rich-read
page payload was 41,647 bytes; text-only reads remained free of semantic element
metadata.

The browser suite additionally proved stable logical identity across a real DOM
replacement, stale action-ref rejection, explicit SPA generation reset, sensitive
element exclusion, 20/20 bounded-burst stability, and zero foreground takeover.
