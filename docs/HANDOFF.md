@last-edited: 2026-10-05 00:56 UTC+7.
@related: [AGENTS.md](../AGENTS.md) - [CONTEXT.md](CONTEXT.md) - [ROADMAP.md](../ROADMAP.md)

# HANDOFF

Simplify first, code first, comments second. State what is true now, never its history.

Cover every button on every site, and grow the capability the Goals in [`AGENTS.md`](../AGENTS.md) name.


> What is true now and what to do next. Cap 150 lines. Spent detail: git history.

## State

- `main` = `origin/main`, sole remote branch, every merge `--ff-only`.
- Version `1.6.15` in `[extension/manifest.json](../extension/manifest.json)` is the source of truth.
- Local gates: `npm test` 772 pass, `npm run check` ok — 26 primitives, 91 safety files.
- Browser harness exits 0 against Brave, headless and headed. `ci-browser` runs the
  same file under `xvfb`.
- Live suite: 109 passed, 0 failed, 13 skipped against real YouTube videos, opencode.ai,
  Google Maps, GitHub, Wikipedia and Google Docs. `OA_ONLY=<substring>` runs one
  case group. Google Search skips as a bot check from this IP (`/sorry/`), which is the
  site reporting its state; its type-and-submit step still passes.
- Google coverage is Maps, YouTube and Docs. YouTube additionally proves the
  transcript panel through `...more` when the video carries captions, the Like
  button dispatching up to the sign-in wall, and the comments section missing
  for logged-out sessions. New sites that teach new functions: GitHub search
  (overlay trigger, type, submit, results) and Wikipedia (ref-scroll, section
  jump).
- All 26 allowlisted primitives are driven by both suites. `media.play` was the last one
  the deterministic harness never called.
- `media.play` in background mode is refused on a real video by Chrome's autoplay policy.
  The extension names the cause and the recovery, which is foreground mode.
- Production database: 48 migrations recorded, 0 pending. `opera_claim_next_wait` and
  `opera_run_fast` both present. 58 `opera_*` functions live, 9 edge functions, each
  with a repo counterpart.
- No `sbp_` token in the tree or its history. The two matches in
  `[tests/transaction-cloud.test.mjs](../tests/transaction-cloud.test.mjs)` are synthetic (`'a'.repeat(40)`).
- `page.read` reports `userState` — `tabActive`, `windowFocused`, `watching` — so the
  model can tell whether the person is looking at the tab before choosing foreground or
  background. Fails open: a missing `userState` is a gap in the report, not a failure.
- **The plan path exists; the model call does not.** Owner decision: the model composes a
  plan once, the device executes it locally, so a task costs one round trip instead of one
  per step. [`lib/goal-plan.js`](../lib/goal-plan.js) is the gate between model text and
  that execution, and `buildPlanRequest` is the prompt that asks for one, sharing the same
  allowlist so the two cannot drift. Both are pure and proven: 15 tests, no key needed.
- `b436843` is **green on all three gates** on GitHub's Linux runners, and Linux found a
  defect Windows could not: the comment-spacing lock read `git ls-files`, so a brand-new
  file was never checked. It walks the filesystem now.
- `TARGET_NOT_READY` refusal carries `refState`: `expired` when the ref can never act
  on this page again, `detached` when the node left the DOM, `unresolvable` when the
  node is connected but stopped matching. `expired` is refused at once, measured
  7575ms → 0ms; `detached` still waits the tested `waitedMs >= 3000`. The hint names
  the recovery — `find` then `click` with `refFromStep` in one `browser.burst`. All
  three refusal sites build the error once, in `notReadyError`.
- The blank-line comment rule is a lock, not a habit:
  `[tests/helpers/comment-spacing.mjs](../tests/helpers/comment-spacing.mjs)` classifies
  each line per dialect and `[tests/hygiene.test.mjs](../tests/hygiene.test.mjs)` asserts
  the gap. Applied migrations and JSON are excluded.

## Known, not started

- **The Opera-to-Brave rename is a production migration, not a rename.** The `opera_`
  prefix is load-bearing in the database: 58 functions, plus tables and every RPC name
  the bridge and MCP call. Repo surface is ~256 files and ~1982 `opera_*` identifiers.
- **A digest freeze blocks the first edit.** `tests/fixtures/*.json` pin `sourceSha256`
  for [`supabase/functions/opera-agent-mcp/index.ts`](../supabase/functions/opera-agent-mcp/index.ts) and `[extension/background.js](../extension/background.js)`, and
  `[tests/helpers/boundary-locks.mjs](../tests/helpers/boundary-locks.mjs)` pins them by blob SHA.
- Sequence: verify on Brave, then rename, then re-freeze. Otherwise a Brave regression
  is indistinguishable from a rename regression.

## Still open

1. Release so the shipped CRX contains the Options page. Needs the private signing key.
2. Publishable-key rotation — a production secret, untouched.
3. SonarCloud project access — the pre-existing New Code wall.
4. Supabase PATs and the login credentials for Google and GitHub need owner action; there
   is no Management API for PATs, and the live login cases only lack the submit.
5. **The one real latency lever, and it is an owner decision.** Measured over 9,079
   production commands, 676.6 ms of the 1875.3 ms average is the device not yet having
   asked for the command, p95 1914.4 ms. That wait is the polling ramp inside
   `opera_claim_next_wait`, which falls to a 250 ms floor after 720 ms idle. A 100 ms
   floor should bring p95 near 1000 ms at 10 idle polls per second instead of 4; 50 ms
   gets near 700 ms at 20. It is not changed: it alters a production function on the
   command path, and the right floor depends on how many devices idle at once, which
   this repository cannot answer. Full numbers in `[docs/benchmarks.md](benchmarks.md)`.
6. The largest unknown: how many model round trips a real task costs. Every latency
   figure here models the server and extension path, not the model loop. The plan path
   is the answer being built for it; see item 9.
7. **The plan path needs two owner inputs before it can run.** A model endpoint and key
   (an OpenAI-compatible URL covers a local model for development and a hosted one for
   production), and a decision on [`SECURITY.md`](../SECURITY.md) because page content
   would leave the device. After that the remaining work is the VM host: handing a
   compiled program to `opera_start_workflow` needs a new RPC, which is production shape.

## CI

- `1facc42` concluded **success on all three gates**: unit, secret-scan, browser. It is the
  head that carries the `media.play` change, so it is the acceptance evidence for the
  runtime. Three earlier commits are green on the same gates.
- `62fdc72` is **green on all three gates** — unit, secret-scan and browser — on GitHub's own
  Linux runners. The browser gate runs the same harness headed under `xvfb-run` on
  playwright's chromium. This is the acceptance evidence for the whole session: earlier
  commits only ever had local green.
- Three dead ends got there, each a trap worth keeping: headless Chromium starts no MV3
  service worker; the image's branded Chrome loads no unpacked MV3 extension through
  playwright at all, while playwright's own chromium does; and `xvfb-run` stops draining the
  child's stdout, so the harness finishes the suite then dies writing its summary.
- The secret-scan gate had **never executed** before 2026-10-04. Its first run failed on its
  own configuration: the jwt allowlist still pointed at `tests/transaction-cloud-8d.test.mjs`,
  a name that stopped existing. Fixed by re-pointing paths, never by editing the fixture,
  and locked locally by `[tests/hygiene.test.mjs](../tests/hygiene.test.mjs)`.
- All three jobs run on `ubuntu-latest`; the self-hosted Windows runner is no longer needed
  by CI. The Python 3.12 pin is restored, because the reason it was dropped was a fault of
  this machine's installer rather than of the pin.
- The browser gate proves the extension end to end on Linux, but the focus audit cannot see
  what a headless display hides, so the local gates still run Brave headed on this machine.
- The concurrency group cancels an in-flight run when a newer one queues, so a push made
  while CI is running destroys the evidence for the head being tested. Push, then wait.
- One browser failure came out of this session and was a defect in the harness, not the
  product: the focus audit called a window losing OS focus a stolen focus. It now reports
  five states and only fails when focus lands on a different window or a different tab,
  which is what a steal physically is. The classifier is checked on all five at the start
  of every run, and both steal branches were proved red by disabling them.
- Every job has a timeout and the workflow has a concurrency group, so a hang becomes a
  visible failure and superseded runs do not queue behind each other. A push made while a
  run is in flight cancels it, so push and then wait.

## Blocked, needs the owner at the machine

- Python 3.12.10 installs and runs per-user (`py -3.12`, pip 25.0.1), twice proven
  (install-verify, uninstall-reinstall-verify). 3.13.15 stays the default untouched.
- The per-machine install is still broken: its `dev_AllUsers` MSI crashes with a
  stack overflow (`0xC00000FD`) during file costing, in both scopes, even after
  re-registering the MSI engine (`msiexec /unregister` + `/regserver`, service
  running). The dev-symbols package is poisoned on this machine; nobody needs it
  to run Python. Next steps are OS-level (SFC, servicing) and need the owner.
- The repo does not need per-machine: the runner runs interactively as ASUS, so
  per-user installs are visible to it.
- `%TEMP%\opencode\pythoncore-backup.reg` still holds the removed 3.12 registry
  registration.
- Use `py`, not `python`, which hits the Microsoft Store shim. `py` is 3.13.15 with
  playwright.

## Do not touch

- `stash@{0}` — "preserve accidental 8E files before completing checkpoint 8D". Do not
  pop, apply, delete, or build from it. 8E is paused and must not start implicitly.
- `archive/*` tags are historical; never rewrite them.
