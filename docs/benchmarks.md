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

During the next live workflow run, record workflow queue time, execution time, command count, browser timing, returned bytes, retries, and fixed waits. Do not turn one machine's timings into test assertions.
