# Opera Agent next-session handoff

Last synchronized: 2026-09-22 (repository-production sync session).
Session content head: `f45b04d7e80856f16b545e9eb519ff748baeb686` on
`feat/pre-8e-usability-repair-r8`; the SHA-record commit itself is the tip.
Verify the actual tip via `git log -1` and the remote before the first write.

## Repository-production sync executed 2026-09-22 — read first

Owner asked to check GitHub, Supabase, and local state and synchronize, then
continue unfinished work. Findings and actions (all verified against live
state):

- Local `feat/pre-8e-usability-repair-r8` HEAD `715031d` equals `origin/main`;
  the gateway repair below was committed, pushed, and `main` fast-forwarded.
  CI on the exact head: CircleCI `ci` SUCCESS + Vercel SUCCESS; SonarCloud
  failure is the PR static gate and no PR is open.
- Ten local migration files carried version IDs differing from production
  `schema_migrations` records (names matched). Renamed via `git mv` to the
  production IDs (`20260908021039`, `20260908031756`, `20260908035531`,
  `20260908074202`, `20260910121107`, `20260911162525`, `20260911162819`,
  `20260911231331`, `20260912061541`, `20260912061656`) with test path updates
  in `tests/ledger-server.test.mjs`, `tests/reactive-vm-host-7e.test.mjs`,
  `tests/reactive-vm-host-7e-boundaries.test.mjs`, and
  `tests/postgres/transaction-journal-8d.test.mjs`. Focused suites pass
  (15/15 and 15/15); `npm run check` PASS at 1.6.6. The postgres fixture test
  cannot run locally (`OPERA_PG_BIN` unset, no native PostgreSQL); CI covers it.
- Production ledger was missing records for two verified-applied migrations:
  `20260921163000` `opera_agent_youtube_skip_ads_workflow` and `20260922000000`
  `opera_agent_ut_etw`. Both recorded in `schema_migrations` (41 rows now)
  with pointer statements; exact SQL lives in the tracked repo files, not the
  ledger.
- Three migrations in the accepted line were NEVER applied to production:
  `20260919171500` `pre_8e_r5_media_fast_path` (workflow `media.sample_at`
  absent), `20260919213000` `pre_8e_r6_navigation_fast_path` (production
  `youtube.play_recommendation` still v2 with the pre-R6 body, `updated_at`
  2026-09-08), and `20260920090000` `pre_8e_r7_transcript_cleanup`
  (production `youtube.get_transcript` still v4 with 16 steps vs the R7
  14-step v5 body). They are deliberately NOT recorded in the ledger.
  Applying their content to production is a separate explicit owner decision;
  U-T event-triggered workflows may supersede the R5/R6 fast-path intent.
- Remaining unfinished (unchanged by this sync): independent audit re-review
  of the gateway repair, and live acceptance (watcher skips a real ad, zero
  analysis trips) in a tool-capable client via the OAuth Opera Agent
  connector. Both remain owner-gated.

## Gateway transaction repair: COMMITTED and DEPLOYED (supersedes awaiting-review state)

The repair was committed at `715031d` on `feat/pre-8e-usability-repair-r8`,
pushed, and `main` was fast-forwarded to it. CI on the exact head is green
(CircleCI + Vercel; SonarCloud is the PR static gate with no open PR). The
gateway is deployed and byte-exact verified (version 2, `ACTIVE`, `verify_jwt:
false`; see the U-T section below). The earlier awaiting-review/uncommitted
state and the "push remains on explicit owner request" note are historical.

Historical baseline: `58264c5f2ffafe8e94ca8c51d2cae43019f5f768` on
`feat/pre-8e-usability-repair-r8`. The owner explicitly confirmed no other
writer and allowed edits despite untracked `.kilo/` and `graphify-out/`;

Local changes: gateway now uses authenticated device preflight followed by
separately awaited `opera_enqueue` and `opera_await_adaptive` requests, retaining
one external HTTP request. This fixes queue invisibility caused by the old
wrapper waiting before its enqueue transaction commits. Pairing/offline guards,
enqueue rejection, request-ID passthrough/reuse, structured 200 results and
401/502/504 behavior remain covered. The heartbeat guard uses gateway time
instead of SQL time; verify hosted behavior before rollout. No SQL or other
Edge Function was changed; direct callers of `opera_run_fast` remain affected.

Evidence: new `tests/gateway-transactions.test.mjs` initially failed 4/6 before
runtime edits, specifically detecting the combined transaction path. After
repair, `node --test tests/gateway-transactions.test.mjs tests/etw-watch-engine.test.mjs`
passed 14/14. `npm run check` passed (72 files, 26 primitives, version 1.6.6).
`npm test` passed 477/478; the sole failure is the root allowlist check on
existing `.kilo`, `.opera-agent-8d-state`, `deno.lock`, `graphify-out`, and
`node_modules`. The defective one-SQL-call source assertion was replaced by
executable ordering coverage, not by relaxing safety checks.

Audit follow-up: the owner supplied an independent P2 finding that a failed
await RPC after enqueue commits returned generic 502 without command identity
or an uncertain-outcome warning. Added a tests-first regression (6/7 passed,
new test failed on missing commandId), then caught only post-enqueue await
errors. HTTP 502 / GATEWAY_ERROR remain; the response adds commandId,
outcome="unknown", and an explicit verify-before-repeating warning. No retries.
The regression covers returned RPC errors and thrown transport errors with no
requestId, asserting exactly one enqueue and one await call. Focused suite now
passes 15/15; static checks pass. The full-suite evidence above predates this
follow-up and was not rerun. The owner reports the audit otherwise confirmed
auth, signatures, grants and the prior 14/14 focused result.

Remaining: independent audit re-review of this fix and live acceptance under
separate explicit authorization. CI evidence is green on `715031d` and the
hosted deploy is complete (version 2, byte-exact). Tests execute the gateway
handler with mocked Supabase transactions, not a live DB or device. The
earlier no-deploy/no-commit statements are historical: the deploy, commit,
and push were completed on 2026-09-22. The prior deploy-ready instructions
below are historical: do not deploy the baseline gateway or call the combined
RPC as a workaround. This section supersedes older exact-next steps.

## U-T Event-Triggered Workflows implemented (1.6.6 candidate) — read first

2026-09-22. Owner reframed the target: the remaining latency is the model
trip pattern itself (request snapshot → analyze seconds → act). Checkpoint
**U-T** eliminates the pattern per the approved plan: the model compiles
intent into device-local watch rules ONCE (`watch.start` primitive family:
`watch.start/stop/stop_all/list`, internal — protocol stays frozen at 26),
the extension evaluates them continuously (`extension/lib/watch.js` pure
engine: presence/gone/text/url/adState/mediaTime, already-true-at-arm fires
immediately, debounce/deadline/maxEvents bounded, 8/tab + 32 global caps,
site-agnostic — ad selectors live in the rule, not the extension) and fires
LOCAL actions through the proven paths (page.click trusted, runBurst,
relay workflow). Events reach the model via `wait_events` (MCP tool →
`opera_watch_events_wait` long-poll over `opera_watch_events`) with action
evidence attached; `stop_watch` disarms. Universal fastpath: new
`opera-agent-gateway` edge function — POST /command = ONE HTTP hop via
`opera_run_fast` (enqueue + `opera_await_adaptive` ramp 5→30 ms then 50 ms in
one SQL call), token verified first via `opera_verify_device` (header or
body.apiKey — GPT Actions cannot set headers), GET /openapi.json is
GPT-Actions-ready. Bridge gained `watch_event` ingest + `start_workflow`
device path. Gates: node suite 471/472 (single fail = pre-existing local
governance artifact #250), check PASS at 1.6.6, browser regression EXIT=0
(Edge headless): the fixture control appearing 1.2 s AFTER arming was clicked
locally with zero model trips. MCP inventory 19→22 (start_watch, wait_events,
stop_watch — OBSERVATION class); contracts/thresholds/hash-locks rebaselined
with this reason. See `docs/checkpoint-ut-etw.md`. CRX 1.6.6 signed,
verified offline (50,049 bytes, SHA-256 `a33e5f36…`, CRX3 signature + two-way
ID + deterministic resign proven via the calibrated verifier) and uploaded
inactive — disk SHA equals the DB row SHA, `update.xml` still serves 1.6.5
and the 1.6.6 CRX path 404s while inactive. The ETW migration is DEPLOYED to
hosted and verified live (`opera_watch_events` table;
`opera_watch_event_ingest`, `opera_watch_events_wait`, `opera_await_adaptive`,
`opera_run_fast` RPCs; `youtube.skip_ads` enabled; devices still on 1.6.5).
Remaining before activation: live acceptance (watcher skips a real ad,
zero analysis trips). The `opera-agent-gateway` edge function is now
**DEPLOYED to hosted and verified (2026-09-22, direct Supabase connection,
owner-authorized without DPAPI):** version 2, `ACTIVE`, `verify_jwt: false`
(owner disabled "Verify JWT with legacy secret" in the dashboard after the
Management deploy tool landed the function with platform JWT enforcement and
a redeploy reset the toggle; with no further deploy it held). Final smoke
(11:28 UTC): `GET /health` 200 `ok:true, version 1.0.1`; `GET /openapi.json`
200 with `servers[0].url` exactly
`https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-gateway`;
`POST /command` without token 401 `UNAUTHORIZED` (gateway envelope). Hosted
source verified byte-exact against the working tree (SHA-256 `1ad1489668…`,
9508 bytes, `EXACT EQUAL: True`). The hosted proxy rewrites the request URL
(strips `/functions/v1`), so the openapi base path now comes from
`SUPABASE_URL` instead of `url.origin` (regression-tested, focused suite
16/16, `npm run check` PASS). The gateway itself was also repaired locally:
separate awaited `opera_enqueue` / `opera_await_adaptive` RPC transactions in
one caller HTTP request (the former `opera_run_fast` wrapper hid the queued
command until timeout inside one SQL transaction); post-enqueue wait failures
keep HTTP 502 `GATEWAY_ERROR` with `commandId`, `outcome: "unknown"` and a
verify-before-repeating warning; no retries. Gateway/ETW focused suite 16/16;
full `npm test` 477/478 (single fail = pre-existing local root-governance
artifact); `npm run check` PASS. Everything else is READY:
`deno.json` added (mirror of bridge's), gateway hardened (spec
`servers` now carries the full `/functions/v1/opera-agent-gateway` base path
so GPT Actions hit the right URL; 504 described; structured device failures
returned as 200 so AI callers can read the envelope) —
then live acceptance (watcher skips a real ad,
zero analysis trips) in a tool-capable client via the OAuth Opera Agent
connector (no Opera/MCP tools were exposed in this session; Edge-headless
fixture results are not live acceptance).

## U-S burst atomic actions shipped, 1.6.5 ACTIVATED — superseded by U-T above

2026-09-21. The live T041 rerun on 1.6.4 (15:29 UTC) proved target selection is
fixed but the model round trip kills dynamic controls: find at 15:29:36.329Z
selected the real Skip control perfectly; the click 14.1 s later hit "Element
not found or reference is stale" — the node was destroyed with no successor, so
even I4 rebind could not help. Grounded in the JIT-Planner (ICML 2026) and
Efficient GUI Agents (arXiv 2609.02309) literature, checkpoint **U-S** shipped:
(1) **burst ref passthrough** — burst click/fill steps take `refFromStep`/
`refIndex` from an earlier find/query step in the same burst (forward refs
rejected at validation; results annotated `resolvedFrom:"step:N"`), so
find→click→verify now runs in ONE command: measured **161.6 ms** vs the
14,100 ms live round trip in `us.burst.find-click-wait` (Edge headless,
exit 0); (2) **`run_workflow` MCP tool** (inventory 18→19, contracts
rebaselined with recorded reason) calling the audited `opera_start_workflow`
pg_net path + polling `opera_get_workflow_run` — closing the "insert row does
not execute anything" gap; (3) versioned **`youtube.skip_ads`** workflow
migration: bounded re-query-every-iteration skip loop with ad-state
post-condition. Version 1.6.5; node suite 463/464 (single fail = pre-existing
local governance artifact); `check` PASS; see
`docs/checkpoint-us-burst-atomic-actions.md`. Live T041 acceptance PASSED and
production activation is DONE — see the 1.6.5 release section below.

## 1.6.5 ACTIVATED in production — the U-S release

2026-09-22. Artifact `D:\Opera\opera-agent-1.6.5.crx` — 43,634 bytes,
SHA-256 `584a200517c7b7bd7e3c90a3cbb88cd7dbe477cda3311a1d3f129b7e051ead6d`,
packed from a clean worktree of build head `12b2c88` (CircleCI + Vercel
SUCCESS) and signed offline with the established identity key
(`D:\Opera\signing-private\opera-agent-new-identity.pem`). Offline proof:
extension ID derived from the AsymmetricKeyProof public key =
`ohbbpamcljckmjhcpkcmefdobkoeaick` AND present as the CRX3 crx_id field —
two independent derivations agree; RSA-SHA256 CRX3 SignedData proof VALID via
the Chromium-exact construction (`CRX3 SignedData\x00` + u32le(size) +
`SignedData{crx_id}` + archive), calibrated against the production 1.6.3 and
1.6.4 artifacts (both also VALID). Registry row `1.6.5 / active=false`
uploaded through the audited DPAPI Management write path; DB byte length and
SHA-256 match the artifact exactly. **Live acceptance on the side-loaded 1.6.5
PASSED (2026-09-22):** organic T041 (find → synthetic click ignored by player
→ fresh-ref trusted/debugger click → ad gone, main video playing) and the
single-burst T041 (`find("Skip") → click(refFromStep:0)`, `ok:true`,
`resolvedFrom:"step:0"`, 645.7 ms total / 43 ms find + 601.9 ms click, zero
stale errors) both skipped real YouTube ads. The `youtube.skip_ads` workflow
registration migration was applied to the hosted database (owner-initiated
`opera_run_workflow` had returned WORKFLOW_NOT_FOUND because only the repo
file existed); `opera_register_workflow` returned `ok:true, version:1` and the
workflow is verified alongside the other `youtube.*` entries. Zero production impact was verified pre-activation:
`update.xml?id=ohbb…` still served 1.6.2 and the identity CRX path for 1.6.5
was 404 while inactive. **ACTIVATED 2026-09-21 23:37 UTC** through the audited
DPAPI write path: one atomic identity-scoped update set `1.6.5 / active=true`
and every other opera-agent row (1.6.2–1.6.4 included) `active=false` —
exactly one active row (verified `active_count=1`); the unrelated legacy
identity `pagjlnoh…` (1.0.1 active) was left untouched. Public release path
verified post-activation: `update.xml?id=ohbbpamcljckmjhcpkcmefdobkoeaick`
advertises 1.6.5 and its codebase URL returned HTTP 200 with 43,634 bytes,
SHA-256 `584a200517c7b7bd7e3c90a3cbb88cd7dbe477cda3311a1d3f129b7e051ead6d`
identical across the DB row, the disk artifact, and a fresh download.
Rollback: rows 1.6.2/1.6.3/1.6.4 remain present (inactive) and
`D:\Opera\opera-agent-1.6.2.crx` is on disk for re-install.

## Signed 1.6.4 candidate built and uploaded inactive — superseded by U-S above

2026-09-21 evening. The 1.6.4 candidate (U-I + I4) is built, signed, verified,
and uploaded **inactive**. Exact build head `3f947d3` (version sweep commit,
contains U-I `d230451` + I4 `6e9ddd7`) passed CircleCI + Vercel before packing.
Artifact: `D:\Opera\opera-agent-1.6.4.crx` — 42,908 bytes, SHA-256
`0a9fe577e7493e4c4046bddf89000821045a02788ecd71ffe5f2e8a21782d5f3` — packed
from a clean detached worktree with `--pack-extension-key` against the
established private key; offline verification reproduced the established
extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick` from the proof public key and
the RSA-SHA256 CRX3 SignedData proof verified VALID (verifier calibrated
against the production 1.6.3 artifact; SignedData = `CRX3 SignedData\x00` +
uint32le(shd.size) + shd + archive, no archive-size field). Registry: one
`opera_releases` row `1.6.4 / active=false` uploaded through the audited
DPAPI-encrypted Management-token write path; decoded bytes and SHA-256 match
exactly; update.xml still serves active 1.6.2; identity CRX path for 1.6.4
returns 404 while inactive.

Next: owner side-loads `D:\Opera\opera-agent-1.6.4.crx` in real Opera (same
identity, replaces 1.6.3 in place) and repeats the T041 Skip-path live
acceptance — with I4, the find→click Skip path should survive YouTube's no-id
control re-render. Record evidence either way; on failure roll back by
re-installing `D:\Opera\opera-agent-1.6.2.crx`. Production activation of 1.6.4
remains prohibited until that live acceptance passes.

## I4 signature rebind + live T041 evidence — read before anything else

Same day, later: the installed 1.6.3 candidate (pre-U-I) **failed its live T041
rerun** the same way 1.6.2 did — `page.find "Skip"` now returns the correct
dominant item (R8 find repair verified live, 07:47:38Z), but the click 6.8 s
later died with `Element not found or reference is stale` because YouTube
recreates the Skip control without its id and the keyed rebind pool emptied.
Full evidence in `docs/checkpoint-ui-identity-hardening.md` (I4 section).
A bounded **signature rebind fallback (I4)** was implemented tests-first on
r8: when a keyed successor disappears, a unique intrinsic-signature
replacement (visible text/label + tag + explicit fields, actionable,
non-sensitive) may rebind — uniqueness still required, mint-time geometry
still the last guard. Local gates green again (454/455 node; check PASS;
browser regression **exit 0** Edge headless incl. the new I4 scenario);
content.js locks rebaselined `0340d471…` → `2ee26615…`. Exact-head CI on the
pushed I4 head is the remaining acceptance step. **A new signed version is
required for the fix to reach real Opera** — the installed 1.6.3 predates both
U-I and I4; do not activate any candidate before its live T041 passes.

## U-I identity hardening implemented on r8 — read first

After the R8/1.6.3 state below was recorded, the user asked for a change that
makes the agent "faster and easier for ChatGPT web to use". U-I (research
methods I1/I2/I3) was implemented **tests-first on this same branch by a
separate writer**; see `docs/checkpoint-ui-identity-hardening.md` for the
full contract and evidence. Short form: geometry-aware rebind rejection
(24 px document-coordinate tolerance; refusal names current candidates),
`page.find` ambiguity `candidateRank`+`hint` annotations, bounded `fuzzy`
projection on zero exact matches, and a visible-text → closest-actionable
fallback (I3). Public MCP inventory, schemas, protocol, and primitives
unchanged. Local gates green (453/454 node — one pre-existing local-only
governance failure; check PASS; controlled-browser Edge headless=new exit 0
with three new U-I scenarios); content.js blob locks rebaselined
`9872dd3e…` → `0340d471…` with the reason recorded. The one-writer rule was
respected: this writer did not touch the working tree before verifying it
matched the handoff head. Exact-head CI (CircleCI + Vercel) on the pushed U-I
head is the remaining acceptance step under the standing authorization. The
signed 1.6.3 gate section below still governs production activation; U-I
rides the 1.6.3 candidate source until a newer signed version is explicitly
prepared.

## R8 signed release gate — read first

**Latest outcome: R8 T041 FAILED and production safely rolled forward to signed
1.6.2.** The original prompt completed, but `find("Skip")` used explicit
`limit:20`, exposed two candidates led by offscreen `Skip navigation`, suffered
two stale ref clicks, and required coordinate fallback. See
`docs/pre-8e-performance-usability-r8.md`. Opera installed `1.6.2_0`; ping
completed in 408 ms with pairing, Protocol 1, and 26 capabilities intact. Stop:
do not start a new repair, merge 1.6.1 to main, tag it accepted, or start 8E
without explicit authorization.

The user then explicitly authorized the bounded T046-T052 repair. Tests-first
source now selects a unique exact-actionable `item` even when callers request an
explicit diagnostic limit, while retaining all `items`, equal ambiguity, and
explicit index authority. A bounded browser hit-test override corrects false
ancestor-clipping negatives without promoting genuinely clipped controls.
Controlled browser, static checks, and 444 canonical local Node tests pass.
Exact-head CI, version >1.6.2 signing, audit, and repeat live T041 are still
required. Production remains on 1.6.2; do not activate a candidate yet.

Candidate source is versioned 1.6.3. Repair head `78e038b` has CircleCI #301 +
Vercel SUCCESS. The versioned release head `f1458c3` has CircleCI #302 + Vercel
SUCCESS, verified through the GitHub commit status API on 2026-09-21. Local
1.6.3 static, controlled-browser (55/55 background-focus, 20/20 burst stability,
all R8 find gates), and version-contract gates pass; the local Node suite shows
448/449 with the single governance failure explained by ignored local root state
that is absent on clean CI checkouts.

The signed 1.6.3 artifact is built and verified offline: CRX3 at
`D:\Opera\opera-agent-1.6.3.crx`, 40,690 bytes, SHA-256
`60bab5e1aae66f6f3ac34f56e2f75644da9c86e1731a294fb4098c0fd2a93897`, packed from a
clean detached checkout of `f1458c3` with the private signing key kept outside
the repository. The RSA-SHA256 proof verifies against the CRX3 specification
over `CRX3 SignedData\x00` + signed_header_size + signed_header_data + archive
with the manifest public key; manifest key and proof key both derive the
established extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick`, and all 10 packaged
files match the source byte-for-byte.

The independent Codex audit on head `2ae2016` returned **PASS** with no blocking
findings. After the audit, the 1.6.3 registry row was uploaded inactive through
the audited Management write path (DPAPI-encrypted credential, value never
exposed): the database-decoded bytes reproduce the recorded 40,690-byte artifact
and SHA-256 exactly, 1.6.2 remains the sole active row for the identity,
identity-specific health/XML still serve 1.6.2, and the identity-specific 1.6.3
CRX path returns 404 while the row is inactive.

Next: bounded live R8 acceptance in the owner's real Opera — side-load the
signed 1.6.3 CRX (same identity, replaces 1.6.2 in place), repeat the T041
Skip-path acceptance, and record evidence. If it fails, roll back by manually
re-installing `D:\Opera\opera-agent-1.6.2.crx`. Production activation remains
prohibited until that live acceptance passes.

The user explicitly authorized a same-identity signed `1.6.1` update through the
production update service. Implementation/release head
`f38eddef508b96ec4df641af56377c611030ddf5` has CircleCI #295 + Vercel
SUCCESS. Offline signed artifacts are:

- `1.6.1`: 40,441 bytes, SHA-256
  `8c980dbe37cbccf2f272e45e8045fd7d6e91ad0d666dd289bc65eccaa6d49b1e`;
- forward rollback `1.6.2`: 35,631 bytes, SHA-256
  `bca7d9d5199f0075ac41fcc929e260943acd8c4e1e076fc26cf9294c408a085a`.

Both manifest and CRX proof keys derive established ID
`ohbbpamcljckmjhcpkcmefdobkoeaick`; neither artifact nor private key is in Git.
The 1.6.2 behavior source is exactly accepted tag `v1.6.0` commit
`96ef1cfdbecc7c5c0e40486b6378501db606b84d`, with only the three packaged
version surfaces changed to 1.6.2. Its 10 packaged files match prepared source,
and the accepted 1.6.0 browser harness passes with 20/20 burst stability and
55-command focus preservation.

Production stores both signed artifacts. Database-decoded hashes/sizes match the
local evidence; after the failed gate the audited atomic rollback made 1.6.2 the
sole active row, with 1.6.0 and 1.6.1 inactive. Identity-specific health/XML and
the public download match 1.6.2 exactly. Two earlier audits
returned CONDITIONAL PASS because registry pointer rollback alone cannot
downgrade a browser that installed 1.6.1. The final independent audit on exact
head `248d73ec05713a2f2b7682a3fb43fc3805279cef` returned **PASS** after
verifying both CRX artifacts, identities, packaged bytes, exact-head CI, and the
forward-rollback procedure. That rollback has now completed. T039-T040 are done;
T041 failed and T042-T045 remain open. Milestone 8E remains paused.

The locally DPAPI-encrypted Management credential supplied the audited write
authority without exposing its value. The pre-existing root `deno.lock` was
verified as history-free partial local Deno
CLI resolver state and is ignored explicitly as `/deno.lock`; its local contents
were not deleted or committed.

## U-V1 closed — 2026-09-20 (read first)

**U-V1 (self-verifying actions) is ACCEPTED / CLOSED on CI evidence.** Actions
now verify themselves in-page: `page.click` accepts internal `expect`
(`urlChanged/urlContains/selectorAppears/selectorGone/textGone/minMutationDelta`)
evaluated inside postAction evidence (`verified`, per-check `expectations`) at
zero extra round trips, `retry:{attempts}` bounded 1–3 drives re-execution on
verification failure, anchors expose `fallbackHref` when unverified, and
`page.wait_for` gains `absent:true`. Burst timeouts preserve the successful
prefix (`timedOut:true`, `BURST_TIMEOUT`, "completed steps may have taken
effect") matching the V2 unknown-outcome contract. MCP inventory stays frozen
(18 tools, unchanged schemas — internal params follow the R4 precedent).
Evidence: `docs/checkpoint-u-v1-self-verifying-actions.md` (controlled-browser
acceptance all green). Remaining proposed checkpoints: **U-I** (identity
hardening), **U-P1** (CDP AX-tree observation), **U-P3**, **U-P2**. The older
R8 environment blocker is superseded by the signed release gate above.

## Research + quick wins — 2026-09-20 (perception / identity / verification)

Owner field tests across nine hard websites (Figma, Maps, Miro, YouTube, Docs,
X, Instagram, 2048, Browserling) were turned into a method matrix in
`docs/research/perception-identity-verification-2026-09-20.md` (classes P/I/V,
code-verified attachment points, measured production tail data). Implemented in
this session (gates green, hash locks rebaselined with recorded reasons):
(1) statement timeouts now report `outcome:"unknown"` / `AWAIT_OUTCOME_UNKNOWN`
in the workflow runner and MCP `toolError` instead of a raw failure — verify
state before retrying; (2) `page.read`/`query` items gain `fullyInViewport` and
`viewportClipped` (overlap vs containment truth; explains Maps `x=-344`);
(3) model-facing label/text/name/placeholder strips private-use glyphs and
`Visited link` suffixes (fixes exact-match brittleness); (4) MCP instructions
add guidance: canvas/visual surfaces → `capture_page`; find-0-with-visible-text
→ ancestor clickable or capture; Maps results are viewport-scoped; verify state
before repeating after timeouts. Proposed checkpoints awaiting authorization:
U-V1 (expect param + burst partial results), U-P1 (CDP accessibility-tree
observation — flagship for canvas/shadow/virtualized), U-I (geometry-aware ref
validation + ambiguity-ranked find), U-P3 (stale semantic pruning), U-P2
(vision sampling). MCP/runner changes are code-only — **deploying the Edge
Functions to production remains a separate explicit decision**.

## R7 closeout — 2026-09-20 (read first)

R7 (T034–T038) is **IMPLEMENTED / CLOSED on CI evidence** under the standing
authorization. `youtube.get_transcript` v5 (migration
`20260920090000_pre_8e_r7_transcript_cleanup.sql`) collects transcript segments
directly (`ytd-transcript-segment-renderer`, limit 100, visibleOnly false) as
the primary path with the v4 chunked full-text reader preserved verbatim as the
bounded fallback; the unconditional `previousActive` read moved into the
activation branch; primary output carries segments only (no full-page text
noise). T037 closed via its evidence-backed residual-bottleneck clause: the
frozen 20.514s baseline is a single non-distributional run (v3 measured 4.6s
p50 with a one-parameter diff), and the recorded residual is the panel-open/
render wait path — needing R8 real-Opera distribution data or a redesign beyond
R7 scope. Evidence: `docs/pre-8e-performance-usability-r7.md`. Production DB
access is available read-only via `SUPABASE_ACCESS_TOKEN` (user env var; token
`opera-agent-zcode`, Read-only preset, project-scoped, expires 2026-12-19).
**Superseded:** Opera is now installed and the signed 1.6.1/1.6.2 release path
has final audit PASS. Exact next is the authorized inactive-upload and bounded
activation procedure described at the top of this handoff. Milestone 8E remains
paused.

## Production usage observations — 2026-09-20 (backlog seed)

The owner ran production E2E tests (ChatGPT + 1.6.0 extension + Supabase):
YouTube (3Blue1Brown, played to 18:39/18:39 via internal media.seek) and Google
Maps (search/reviews/directions near UII). Full report + repair-track mapping:
`docs/production-usage-observations-2026-09-20.md`. Confirmed the R7 residual
bottleneck with field data (the two v4 failures 14.0 s/16.5 s = the recorded
failed runs). New backlog, top first: (1) transport timeout ≠ action failure —
`browser.burst` timeout with the action already applied (critical correctness);
(2) click ok ≠ state transition — verify expected state + automatic `href`
fallback; (3) description-expand → Show-transcript path fix; (4) caption
detector unreliability; (5) queue tail latency (14.3 s spike) to be measured in
R8/T040; (6) semantic/UI mismatch + stale panel residue; (7) geometry truth for
transformed panels (`x = -344` with `inViewport = true`); (8) exact-match
brittleness with glyph labels; (9) media primitives MCP exposure — 8E decision
(F5). SonarCloud quality gate fails on New-Code reliability; the known
check.mjs sort issue is already fixed at f3051a8 — re-check the next analysis
or inspect with a SONAR_TOKEN.

## Consolidation authorization — 2026-09-19 (supersedes the main-merge caution below)

The user reviewed the repository survey (32 remote branches, four divergent
lines, stale `main` at the 1.5.2 era while the update service actively serves
1.6.0) and explicitly ordered: fix everything now, tidy the repository, and add
strict rules preventing the next AI session from repeating the same mistakes.
Because R6 is now ACCEPTED/CLOSED (no longer an in-progress track), the earlier
"Do not merge the in-progress R6 track into `main`" caution no longer applies:
merging the closed repair line into `main` is user-authorized consolidation,
not branch-count cosmetics. The parallel local session's unpushed R6 work was
preserved at `archive/local-session-r6-wip` before alignment. Branch cleanup
proceeds by immutable archive tags (`archive/<branch>`) so every deleted ref
remains recoverable.

Consolidation executed on 2026-09-19/20: `main` fast-forwarded to the accepted
head `608f76c` (R0–R6 closed + binding AGENTS.md rules + consolidation records).
Thirty remote branches
were archive-tagged at `archive/<name>` and deleted. Divergent-line decisions:
`chore/drift-proof-governance` (separate state-checker authority approach
already rejected in PR #51; its anti-drift intent is superseded by the binding
AGENTS.md session/branch rules), `perf/efficient-flexible-agent` (superseded by
the accepted performance track P0–P6), `fix/chat-control-fallback` (superseded
by 8D + hardening closeouts), `next/opera-agent-v2` (quarantined experiment,
kept out of 1.x by design), `autodev/m5-chatgpt-legal-loop` (stale AutoDev
state), `ops/p6-production-bundle` (P6 bundle long promoted), and
`chore/sync-production-migration-ids` / `release/new-signing-identity` /
small `feat/*`+`fix/*`+`docs/*` branches (content fully contained in or
superseded by the accepted line). Remaining remote branches: `main`,
`feat/pre-8e-usability-repair-r3` (active), `release/1.3.0`, `release/1.3.1`.

## Latest repair continuation — read before historical instructions below

Continue the user's explicit R6–R8 request sequentially, not Milestone 8E.
R6 is **ACCEPTED / CLOSED without transport migration**: T030–T031 (navigation
measurement + local SPA-click repair, CircleCI #258 + Vercel SUCCESS), T032
(residual queue/transport share 2–8% on navigation paths, ≤ ~250 ms absolute on
primitives), and T033 (Realtime wake not justified — evidence in
`docs/pre-8e-performance-usability-r6.md`). **R7 (T034–T038) YouTube workflow
cleanup is AUTHORIZED / NOT STARTED** under the standing CI-evidence
authorization. R8 real-Opera acceptance (T039–T041) requires the audited signed
1.6.1 update. Opera is installed on this workstation; the remaining blocker is
authorized production registry write tooling, not the browser environment. No
Realtime cutover or 8E permission was added.
Worktree location is `C:/Users/ASUS/.zcode/workspace/default/opera-agent`.
Use `SPECIFY_FEATURE_DIRECTORY` (not `SPECIFY_FEATURE`) for Spec Kit prerequisites.

## Repository hardening closeout — 2026-09-19

The user requested a small, strict guardrail set that makes AI coding errors harder
without adding another governance framework.

- Tests-first head `81969607fd99adb41fed78fd478f7bbb07de2863` produced
  expected CircleCI #266 FAILURE: **430/431 PASS** and only the new dynamic
  static-check coverage regression failed because the old checker returned exit 0
  for a newly added runtime file containing `eval()`.
- Hardening head `e6fa6d2d5e5304c55d0e12a68dc1422e4f640526` has
  **CircleCI #267 SUCCESS + Vercel SUCCESS**.
- `scripts/check.mjs` now discovers runtime JS/TS/SQL recursively under
  `extension/`, `lib/`, `supabase/functions/`, and
  `supabase/migrations/`; new runtime files cannot silently fall outside the
  generic `eval` / `new Function` safety scan.
- The R6 recommendation regression now parses the workflow JSON and asserts its
  structure instead of locking raw source text with brittle regex escaping.
- Duplicate everyday GitHub Actions CI was removed. CircleCI is the canonical
  code/test gate; Vercel remains the preview/deployment check; the GitHub
  `release.yml` workflow remains release-only.
- `AGENTS.md` now carries the minimal repository-discipline rules: verify the
  active branch SHA, do not treat stale `main` as the execution baseline, prefer
  behavior/structured tests, clean temporary validation state, and synchronize
  accepted state before continuing.
- No separate `PROJECT_STATE.json` authority was adopted. Draft PR #51 was
  closed unmerged because it duplicated governance, diverged from the active
  hardening branch, and contained stale CI evidence.
- Obsolete draft PRs #17 and #48 were also closed unmerged.
- Proven temporary branches `test/pre-8e-usability-repair-r0`,
  `feat/pre-8e-usability-repair-r1`,
  `feat/pre-8e-usability-repair-r2`, and `sonar/r6-baseline-r5` were deleted
  after confirming each was fully behind the active R6 branch and had no open PR.
- Historical issues #4 and #5 were closed with supersession notes so old
  1.0.1/23-capability instructions do not masquerade as current state. Issue #1
  remains open because its signing/passive-update follow-up is not fully obsolete.
- `main` remains intentionally behind the active repair branch and must not be
  used as the current implementation baseline. Do not merge the in-progress R6
  track into `main` merely to reduce branch count.

This hardening changes no extension/runtime/public MCP contract, production
deployment, signing identity, or Milestone 8E authorization. The exact next product
work remains **R6 T032 residual queue/transport measurement only**.

Checkpoint 8D remains closed. Performance Track P0–P6 is **ACCEPTED / CLOSED**.
The audited P6 candidate `96ef1cfdbecc7c5c0e40486b6378501db606b84d` has
CircleCI #118 + Vercel SUCCESS. PR #46 merged as
`6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`, with CircleCI #169 + Vercel
SUCCESS. Production promotion is verified at `opera-agent-vm` version 27
(`ACTIVE`, `verify_jwt=true`, deployment SHA
`0f2c3ada9562d7d3ccea492bd46e83f4994dc321319e37a539939de6dbd12455`).
All 14 deployed source/import files match the merge commit byte-for-byte.
`milestone7_vm_enabled` remains `false`, VM tables remain empty, and Milestone
8E remains paused/not started until separately instructed.

## Authoritative boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Accepted P5 / canonical P6 base:
  `a215dd0ddb4d7be9b0c0276862ced3ea26439c77`
- Candidate source branch:
  `feat/performance-runtime-cutover-p6-4571636311958769504`
- Exact P6 audited-candidate head:
  `96ef1cfdbecc7c5c0e40486b6378501db606b84d`
- Exact audited-candidate CI: CircleCI #118 + Vercel SUCCESS
- Merge target branch: `feat/performance-runtime-cutover-p6`
- PR #46 merge commit:
  `6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`
- Merge-commit CI: CircleCI #169 + Vercel SUCCESS
- Stable extension: 1.6.0
- Protocol: 1
- Browser capabilities: 26
- Public MCP tools: 18
- Signed rollback: 1.5.2
- 8E: paused/not started
- P6 production deploy/promotion: **DONE / VERIFIED**
- Production VM host: `opera-agent-vm` version 27, ACTIVE, `verify_jwt=true`
- Production deployment SHA:
  `0f2c3ada9562d7d3ccea492bd46e83f4994dc321319e37a539939de6dbd12455`
- Post-promotion safety state: feature flag false; VM tables 0/0/0

## P6 candidate facts

- Durable 7E host consumes P1/P2/P3 reconciliation after `opera_await`; DB lease,
  checkpoint, effect reservation/idempotency, and host tokens remain authoritative.
- Caller `taskDependencies` are rejected. Without a trustworthy
  server-authoritative dependency source, live context is MISSING and relevance
  conservatively yields REASON_REQUIRED. Do **not** claim full integrated P3/P4
  speedup yet.
- Cold start/lost continuity -> RESET_REQUIRED + FULL_SNAPSHOT.
- With P6 metadata, only a valid accepted APPLY_AND_CONTINUE may continue VM
  execution. IGNORE_FOR_TASK, REASON_REQUIRED, unknown/missing/malformed or
  inconsistent decisions fail closed; reset suspends STALE_TARGET.
- Effect results without P6 metadata retain pre-P6 compatibility.
- Low-level `opera_enqueue` / `opera_await`, full page text/snapshot recovery,
  18 MCP tools, Protocol 1, and 26 capabilities remain intact.
- The candidate implementation itself introduced no schema migration,
  OAuth/signing/pairing/public-schema expansion, transaction authority, or 8E work.
  A later explicit production-promotion step deployed only the exact P6 VM-host
  source to `opera-agent-vm` version 27; it did not enable the VM feature flag.

## Evidence

- `b8cd79f27f135923a63657beced8563ed7e7a0c7` — tests-first;
  CircleCI #114 expected red.
- `5652435e26f534126bfcee7c48df9ffd597fc52e` — control-flow allowlist
  implementation; P6 tests green, historical byte locks exposed as stale.
- `49731c49e75df058dcd48218e680a8ad9aaf7195` — authorized lock rebaseline;
  CircleCI #116 + Vercel SUCCESS.
- #116 full suite: **416/416 PASS**, 0 fail, 0 skipped.
- `npm run check`: PASS, 26 primitives, version 1.6.0.
- Chromium extension regression: PASS.


## Repowise integration state

- Branch: `chore/repowise-integration`
- R1: **PASS** — Repowise 0.51.0 compatibility/privacy/local-MCP research complete.
- R2 repo setup head:
  `706001747aefb9b629d4e301a30d814f5e9754e3`
- R2 CI: CircleCI #119 + Vercel **SUCCESS**.
- Repo changes are limited to:
  - `.gitignore`: local `.repowise/` and `.repowise-venv/`;
  - `tools/repowise/requirements.txt`: `repowise==0.51.0`;
  - `tools/repowise/bootstrap.py`: isolated repo-local installer/version check with
    telemetry disabled.
- No Node dependency was added; no unrelated dependency was upgraded.
- No editor/user MCP config, AGENTS.md managed section, provider key, Repowise
  database/index, or generated cache was committed.
- Runtime installation could not be executed in the ChatGPT sandbox because DNS
  egress to GitHub/PyPI is unavailable. The sandbox otherwise satisfies the runtime
  floor (Python 3.13.5, Git 2.47.3).
- R3: **PASS** at full-history evidence head
  `3a83bbed0177a67ce882237965bc6d3706335b4c`.
- R4 local MCP: **PASS** at offline evidence head
  `abaf20e28fb93fe2488be4ce9f9cbe0721225992`.
- R5 AI codebase-context documentation: **PASS** at
  `e9d6dc8659ac1d7c02bf753a6a2d46bfdae70887`; CircleCI #143 + Vercel
  SUCCESS.
- R6 validation evidence: **PASS with documented limitations** at
  `7fae3a095e7096cec6945b7c4ea274764881b609`; CircleCI #147 + #148 +
  Vercel SUCCESS.
- R6 closeout head
  `6c1f06a2e7d11c62dc8ebfb0a0a13cb31e28140d`: CircleCI #149 + Vercel
  SUCCESS.
- R7 final closeout: **PASS / CLOSED** at final-candidate
  `0338f83c198ff38d0bbc4e864692c01c9a34d327`; CircleCI #150 + Vercel
  SUCCESS.


## Repowise R3 initial-index gate

R3 is **PASS**.

Exact full-history evidence head:
`3a83bbed0177a67ce882237965bc6d3706335b4c`.

Evidence:

- CircleCI #134 `repowise_r3_full`: SUCCESS.
- CircleCI #133 normal regression: SUCCESS.
- Vercel: SUCCESS.
- Repowise 0.51.0.
- Initial indexing: 34.984s.
- Index size: 18,730,491 bytes (~17.86 MiB).
- 301 graph-indexed files from 312 Git-tracked files.
- 1,429 symbols; 74 deterministic/index-only wiki pages.
- 0 parse errors.
- Git history available: 348/348 commits; 121 `git_metadata` rows.
- 7/7 required files graph-indexed with no parse errors.
- working tree clean before/after; no unexpected project side effects.
- telemetry/editor setup/key persistence/prose generation disabled; mock embedder;
  no provider keys passed to Repowise.
- no Repowise DB/index/cache committed or uploaded.

Important diagnostic lesson: CircleCI checkout is blobless partial-clone by default,
so a plain checkout caused Repowise to skip Git history. The final R3 evidence job
hydrated the full Git object set and removed promisor/partial-clone config before
indexing. The validator was also corrected not to require a generated wiki page for
Markdown/test files; R3 verifies graph indexing + parse health, while separately
requiring Git-history coverage.

Temporary R3-specific CircleCI jobs are removed at closeout. The bounded
`tools/repowise/r3_probe.py` and `tools/repowise/r3_assert.py` utilities remain.

## Repowise R4 local MCP gate

R4 is **PASS**.

Exact offline evidence head:
`abaf20e28fb93fe2488be4ce9f9cbe0721225992`.

Evidence:

- tests-first `9f7ee9d...`: CircleCI #136 expected red; normal #137 + Vercel
  SUCCESS.
- initial MCP implementation `555044f...`: #139 MCP acceptance SUCCESS,
  normal #138 + Vercel SUCCESS, but its log revealed Repowise's advisory PyPI
  release check and therefore did not satisfy the offline boundary.
- offline hardening `abaf20e...`: CircleCI #141 MCP acceptance SUCCESS,
  normal #140 SUCCESS, Vercel SUCCESS.
- final smoke: stdio transport, exactly 10 tools, `get_overview` call OK, and no
  PyPI/HTTP request in the MCP step output.

R4 files retained:

- `tools/repowise/mcp_stdio.py`
- `tools/repowise/mcp_smoke.py`
- `tools/repowise/MCP_CONFIG_TEMPLATES.md`

The launcher is single-repo, stdio-only, provider/embedder `mock`, does not load
project-local provider secrets, disables the release poll, and denies DNS/TCP/UDP
egress. It exposes only:
`get_overview`, `get_context`, `get_symbol`, `search_codebase`,
`get_risk`, `get_change_risk`, `get_why`, `get_dead_code`, `get_health`,
and `get_dependency_path`.

Client configuration remains manual. No Claude/Codex/Gemini/user/editor config was
overwritten, no public MCP endpoint was created, and no ChatGPT tunnel/remote bridge
was configured. No Opera Agent runtime/prod/public-MCP surface changed.

Temporary R4 CircleCI instrumentation is removed at closeout.

## Repowise R5 documentation gate

R5 is **PASS**.

Exact documentation head:
`e9d6dc8659ac1d7c02bf753a6a2d46bfdae70887`.

Evidence:

- `docs/ai-codebase-context.md` is the durable Repowise operating guide.
- CircleCI #143: SUCCESS.
- Vercel: SUCCESS.
- scope stayed documentation-only; no Opera Agent runtime/prod/public-MCP
  behavior changed.

The guide covers bootstrap, index/rebuild, status, provider-free incremental
updates, CLI queries, local MCP usage, source-of-truth precedence, privacy,
freshness, partial-clone/history caveats, mock-embedder limitations, and the rule
that Repowise is derived context rather than governance/runtime authority.

No npm helper scripts were added because the existing Python entry points are
already cross-platform and avoid shell-specific assumptions.

## Repowise R6 validation gate

R6 validation evidence is **PASS with documented limitations**.

Exact evidence head:
`7fae3a095e7096cec6945b7c4ea274764881b609`.

- #147 Repowise validation: SUCCESS.
- #148 normal regression including Chromium: SUCCESS.
- Vercel: SUCCESS.
- zero nonexistent paths from ten MCP calls.
- A/B/C are strong structural/impact/state cases.
- D is useful for archaeology but decision/history output must be verified against
  the authoritative plan.
- E proves exact literal inventory remains a grep-first task.
- baseline: 5 `git grep` calls, 84 per-question candidate hits, 51 unique files.
- Repowise: 10 MCP calls, 47 per-question surfaced paths.
- first #146 failure was only missing `rg` in the CI image; fixed by using
  `git grep`.

Detailed evidence is in `docs/repowise-r6-validation.md`. The reusable validation
harness remains at `tools/repowise/r6_validate.py`. Temporary R6 CI wiring is
removed.

R7 is closed. The final record is `docs/repowise-integration-closeout.md`.
There is no implicit R8 or automatic Repowise scope expansion after closure.
The P6 independent audit, repository merge, and production-promotion gates are
closed. A planned Pre-8E Performance Usability Repair now precedes 8E. Do not start
8E without R8 acceptance plus a separate explicit instruction.

## Pre-8E repair track inserted

User-approved planning on 2026-09-18 adds
`docs/pre-8e-performance-usability-repair-plan.md` and Spec Kit feature
`specs/001-pre-8e-performance-usability-repair/`.

Status: **R0–R4 ACCEPTED / CLOSED; R4 closeout head CircleCI #245 + Vercel SUCCESS; R5 AUTHORIZED / IN PROGRESS.**

Do not jump to 8E. R0–R3 are ACCEPTED/CLOSED. R3 (T017–T020) closed with durable evidence in `docs/pre-8e-performance-usability-r3.md`: runtime evidence head `285374f20ef1592d16246fe1e53ab4c9d8b8da81`, governance head `5b5ed172770e5b1ce6bc428c84902d48762ce8bf`, and closeout head `3f765cf` have CircleCI SUCCESS + Vercel SUCCESS, local full gates 423/423 PASS + `npm run check` PASS, and every R3 failure chain recorded. On 2026-09-19 the user accepted R3 on the CI basis and granted a standing authorization to proceed sequentially through the repair checkpoints without per-checkpoint manual sign-off, with CircleCI + Vercel SUCCESS on each checkpoint's evidence head as the acceptance criterion and computer-use assistance allowed. Safety rails remain: no production deployment or signed-release promotion without a separate explicit instruction; R6 T033's conditional transport stop stays binding; 8E start stays a separate explicit decision.

A permanent **Evidence-First Bug Repair Loop** lives in `AGENTS.md`, the reusable
ChatGPT Web checkpoint prompt, and the active Spec Kit feature artifacts
(`spec.md`, `plan.md`, `tasks.md`, `research.md`) using the repository's
official Spec Kit template structure. For every unexpected error/bug/CI/browser
regression: capture exact evidence, reproduce/localize, research the root cause
(repository evidence first; primary external docs/upstream sources when relevant),
add or identify a deterministic regression, apply the smallest generic fix, and
rerun focused + required full gates. No blind retries or guess-patching. Three
repetitions of the same failure without new evidence means blocked + diagnostics
and early audit.

## Exact next gate

The P6 independent audit gate is now **PASS / CLOSED WITH USER-ACCEPTED REVIEWER
DEVIATION**.

- audited P5:
  `a215dd0ddb4d7be9b0c0276862ced3ea26439c77`
- audited exact P6 candidate:
  `96ef1cfdbecc7c5c0e40486b6378501db606b84d`
- reviewer: Jules, used because Codex quota was exhausted;
- reviewer deviation/residual risk: explicitly accepted by the user after
  disclosure;
- Jules verdict: **PASS**;
- canonical exact-head CI: CircleCI **#118 SUCCESS** + Vercel **SUCCESS**;
- durable record: `docs/p6-independent-audit-closeout.md`.

PR #46 is merged at `6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`, and
CircleCI #169 + Vercel are SUCCESS on that merge commit. Production promotion is
verified at `opera-agent-vm` version 27 with
`verify_jwt=true` and deployment SHA
`0f2c3ada9562d7d3ccea492bd46e83f4994dc321319e37a539939de6dbd12455`.
All deployed files match the merge commit, the VM feature flag remains false, and
the VM tables remain empty. P6 is **ACCEPTED / CLOSED**.

**Exact next product action for any coding agent (including Z Code):** R0–R6 are ACCEPTED/CLOSED and the consolidated `main` head is `608f76c` (CI SUCCESS). Execute **R7 / T034–T038** (YouTube workflow cleanup) on `feat/pre-8e-usability-repair-r3`: add output-shape/timing tests for `youtube.get_transcript` (T034), reduce redundant query/wait/activation while preserving background-first fallback (T035), exclude unrelated comments/recommendations/sponsored content from primary transcript output where safely possible (T036), demonstrate >=50% improvement from the ~20.514 s frozen baseline or record an evidence-backed residual bottleneck (T037), then STOP for R7 acceptance on the standing CI-evidence basis (T038). Milestone 8E remains paused/not started.

## Browser-gate flakiness record — 2026-09-20

CircleCI #276 failed on `e22bc9e` (a docs-only diff touching
`next-session-handoff.md` and `project-context.md`; no runtime/test change).
Local evidence gathered instead of a blind rerun: Node suite **431/431 PASS**,
`npm run check` PASS, and the full Playwright/Chromium extension regression
completed cleanly (exit 0) in headed Windows mode, captured end to end. An
evidence-backed rerun commit then passed CircleCI + Vercel on identical runtime
content. A later local rerun exited 1 with output discarded, and the following
captured run exited 0 — confirming environment-sensitive flakiness (suspects:
the live Google Maps network test, port binding races, or service-worker
startup timing), not a repository defect.

Policy: a single browser-gate failure on a runtime-unchanged head is treated as
suspected flake; reproduce locally (headed on Windows), and rerun once with the
evidence recorded in the commit message. Two consecutive failures on the same
runtime content are NOT flakes: stop and follow the full Evidence → Research →
Regression Proof → Minimal Repair → Verification branch with the CI log
captured first.

## Preserved rollback / stash warning

- Accepted P5 remains the clean rollback baseline for this candidate.
- Signed rollback 1.5.2 remains available.
- Two accidental untracked 8E files remain preserved in the git stash named
  **"preserve accidental 8E files before completing checkpoint 8D"**.
  Never pop/apply/delete/build from that stash automatically.


## Spec Kit governance adoption gate

Branch: `chore/spec-kit-governance`.

The adoption vendors the official Spec Kit 1.0.8 Codex/PowerShell core, adds a
repository constitution derived from existing governance, and adds a regression
test preventing loss of the P6/8E scope lock.

Acceptance evidence head:
`f8e860df9803805704ac70c894800b47b6bf3dc4`.

- CircleCI #163: **SUCCESS**.
- Vercel: **SUCCESS**.
- Spec Kit governance adoption: **PASS / CLOSED**.

Do not use the Spec Kit tooling change itself to merge/promote P6 or start 8E.
The separate P6 audit gate is now closed by
`docs/p6-independent-audit-closeout.md`. There is no implicit next Spec Kit
checkpoint.
