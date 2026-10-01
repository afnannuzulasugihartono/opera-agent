# Operator runbook

This runbook is for the person holding the pager. It assumes no prior context
and no access to chat history.

**Reading rule.** Every command, table, RPC name, and behavior claim below was
checked against the repository at the commit that added this file. Where the
repository does not state something, this document says so explicitly instead of
guessing. If a step here contradicts what you observe, trust what you observe
and treat this document as the bug.

Companion documents:

- `docs/install.md` — install, pairing, and the smoke queries.
- `docs/api.md` — gateway request/response contract and error-code table.
- `SECURITY.md` — security principles and token-transport boundary.

## Conventions used here

Three function bases appear repeatedly, each built from the same project URL.
The bridge and update bases are exported by `extension/lib/endpoints.js` as
`DEFAULT_BRIDGE_URL` and `UPDATE_BASE_URL`; the **gateway base is not in that
module at all** and is documented in `docs/api.md:19-23`:

```bash
SUPABASE_URL="https://nenmkmtvjremqphfqnfw.supabase.co"
GATEWAY="$SUPABASE_URL/functions/v1/opera-agent-gateway"
BRIDGE="$SUPABASE_URL/functions/v1/opera-agent-bridge"
UPDATE="$SUPABASE_URL/functions/v1/opera-agent-update"
```

Every SQL block below is meant for the Supabase **SQL editor** (or any role with
`EXECUTE` on the function). That detail matters. In the core migration,
`opera_create_pairing_code` (`…_core.sql:218`), `opera_enqueue` (`:224`),
`opera_await` (`:225`), and `opera_run` (`:226`) are each `revoke`d from
`public`, `anon`, and `authenticated`, and the `grant ... to service_role` lines
that follow (`:227-230`) cover **only** `opera_pair_device`, `opera_heartbeat`,
`opera_claim_next`, and `opera_complete_command`. So these four operator-facing
functions are reachable from the SQL editor as the owner and **not** through
PostgREST with the service key — a PostgREST call will fail with a permission
error. The two cleanup RPCs are the opposite: they *are* granted to
`service_role` (`…_goal_head.sql:242`, `…_reactive_vm_host.sql:741`).

**Disabled devices — one rule for every incident.** A row in
`public.opera_devices` with `status = 'disabled'` was disabled by a human:
nothing in this repository writes `disabled`, and nothing writes it back.
**Re-enabling one is owner-only. Do not do it during an incident** (see
*Actions that are owner-only*). One narrow way a disabled device comes back
exists, and it is a side effect rather than a permission: `opera_pair_device`
does not check `status`, so pairing a device name whose row is disabled runs an
`ON CONFLICT (device_name) DO UPDATE` that sets `status = 'online'`
(`20260907204146_opera_agent_1_0_0_core.sql:129-132`; the `status='online'`
assignment is at `:131`). That is why "re-pair it" and "do not re-enable it
yourself" are both correct at once — but a re-pair is still a production write
to a shared row, it **overwrites `token_hash`** and invalidates every other
client using that device name, and if you do not know why the row was disabled
you must stop and escalate first. Incidents 1, 2, and 4 all defer to this
paragraph rather than restating it.

Device token handling: the device token is a 64-character lowercase hex string.
**Never print it, paste it into a ticket, or echo it into a shell transcript.**
Reference it as `$OPERA_AGENT_TOKEN` and let the shell expand it, exactly as
`docs/api.md` already does. The database stores only the SHA-256 hash in
`public.opera_devices.token_hash`, so you cannot recover the token from SQL even
if you wanted to.

---

# Part 1 — Incidents

## 1. Bridge unreachable (device not seen, commands time out)

### Symptoms

- An AI platform, MCP client, or `curl` call to the gateway returns
  `{"ok":false,"error":"Device is offline.","lastSeenAt":...}` with **HTTP 200**.
- Or it returns `504` / `AWAIT_TIMEOUT` — the command was enqueued but the device
  never reported back.
- Or `{"ok":false,"error":{"code":"DEVICE_NOT_PAIRED",...}}` with HTTP 401.
- The extension popup badge shows **Reconnecting** or **Not paired** instead of
  **Connected**. Those are the popup's labels for the connection states
  `reconnecting` / `unpaired` / `ready`
  (`extension/popup.js:27-32`).
- The user reports "the browser isn't listening."

Note the first case carefully: **a paired-but-offline device answers with HTTP
200 whose `error` is a plain string plus `lastSeenAt`, not an object with a
`code`.** There is no `error.code` to switch on. This is documented in
`docs/api.md:88-91` and comes from
`supabase/functions/opera-agent-gateway/index.ts:102-104`.

### Diagnose

**Step 1 — is the device row present, and when was it last seen?**

```sql
select device_name,
       status,
       extension_version,
       protocol_version,
       last_seen_at,
       round(extract(epoch from (now() - last_seen_at)))::int as seconds_since_seen,
       updated_at
  from public.opera_devices
 order by device_name;
```

`seconds_since_seen` is the single most useful column here. **The gateway treats
a device as offline when `last_seen_at` is null or older than 90 seconds**
(`supabase/functions/opera-agent-gateway/index.ts:102`; the same 90-second rule
is repeated in `public.opera_run`,
`20260907204146_opera_agent_1_0_0_core.sql:213`, and in
`public.opera_watch_event_ingest`).

Do **not** trust the `status` column to mean "reachable". The SQL only ever
writes `'online'` (on heartbeat and on command completion) and never writes
`'offline'`; the schema allows `('offline','online','disabled')` but no code path
in the repository sets `offline`
(`20260907204146_opera_agent_1_0_0_core.sql:17,148,176,157`). A row can read
`status = 'online'` with a `last_seen_at` from yesterday. `last_seen_at` is the
truth. `status = 'disabled'` is the one value that is authoritative — nothing in
the repository sets it either, so a disabled device was disabled by a human.

**Step 2 — smoke test from SQL.**

```sql
select public.opera_run('browser.ping', '{}'::jsonb, 5000, 'opera');
```

Interpretation of the returned envelope:

| Result | Meaning |
| --- | --- |
| `ok: true`, `result` present | Bridge, queue, and device are all healthy. Problem is above the device. |
| `ok: false`, `error: 'Device is not paired.'` | No enabled row named `opera`. Go to incident 2. |
| `ok: false`, `error: 'Device is offline.'` | Row exists; `last_seen_at` is stale. Go to step 3. |
| `ok: false`, `error: 'Method is not allowlisted.'` | `browser.ping` is missing or disabled in `public.opera_methods`. This is a data problem, not a device problem. |

**Step 3 — is the command stuck in the queue, or never arriving?**

```sql
select status, count(*) from public.opera_commands group by status order by status;
```

and the most recent rows:

```sql
select id,
       method,
       status,
       attempts,
       timeout_ms,
       round(extract(epoch from (now() - created_at)))::int as age_seconds,
       error ->> 'code' as error_code
  from public.opera_commands
 order by created_at desc
 limit 20;
```

- Rows sitting in `queued` with a growing `age_seconds` mean the device is not
  claiming. `public.opera_claim_next` is what claims them; nothing else does.
- Rows in `expired` with `error_code = 'EXPIRED'` were marked expired by the
  device's own claim pass, not by a failure
  (`20260907204146_opera_agent_1_0_0_core.sql:158`).
- `attempts > 0` with a non-terminal status means the device claimed the command
  and then stopped reporting — a device-side crash, not a network problem.

**Step 4 — is the bridge function itself reachable?**

`GET` on the bridge answers `405` with `{"ok":false,"error":"POST required."}`
when the function is deployed and serving
(`supabase/functions/opera-agent-bridge/index.ts:177`). Any other result
(404/5xx/DNS failure) is a deployment or network problem.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$BRIDGE"
```

Gateway liveness, unauthenticated:

```bash
curl -sS "$GATEWAY/health"
```

**Step 5 — device-side state.** Only the browser can answer this. Open the popup
and read it, in this order:

1. The status badge: **Connected**, **Connecting**, **Reconnecting**,
   **Starting**, or **Not paired**.
2. The error paragraph. **Know what it can and cannot tell you:** the popup runs
   every error string through a fixed mapping, and anything not in that table is
   replaced by the single sentence *"Something went wrong. Run self-test, then
   check the connection."* (`extension/lib/error-messages.js:26-32`). Only a
   handful of exact static strings are ever shown, each reworded — and none of
   them is a backend message. **The underlying cause (a fetch failure, an HTTP
   status, a database message) is deliberately never displayed.** The paragraph
   tells you *that* something failed, not *why*. Do not read a diagnosis out of
   its wording.
3. **Run self-test.** Its result block is raw JSON and is *not* mapped, so it is
   the one place the browser gives you detail. It reports the extension version,
   protocol version, tab count, the active tab, whether the content bridge
   answered, and how many methods the build exposes
   (`extension/background.js:1614-1631`). `contentBridge: false` means the
   content script is not answering in the active tab, and the `page.error` string
   beside it is the one unmapped diagnostic the popup will hand you.
4. The options page → **Connection → Bridge URL**. A non-empty value overrides the
   default bridge (`extension/background.js:83`). An empty field and a save
   restores the default from `extension/lib/endpoints.js`. A typo'd override is a
   common cause of a device that looks paired but never heartbeats.
5. **To get the error the popup hides**, open the extension service-worker
   console at `opera://extensions` → the extension → **service worker** →
   **Inspect**, set the log level to `debug` on the options page, and reproduce.
   The extension writes `[opera-agent:<level>] <CODE> <message>` lines there
   (`extension/lib/agent-log.js:27-32`). This is a user-side action; it is the
   only way to see the real failure text. Note that the ring buffer the library
   keeps (`agent-log.js`) is not this console output and does not survive a
   service-worker restart — read the console live.

### Fix

Device-side (the user or whoever holds the browser):

- **Bridge URL override wrong** → clear the field on the options page, save. The
  pull loop restarts immediately on the storage change
  (`extension/background.js:1685-1690`).
- **Service worker wedged** → reload the extension at `opera://extensions`, or
  restart the browser. The pull loop is restored by
  `chrome.runtime.onStartup` / `onInstalled` (`extension/background.js:1670-1678`).
- **Browser asleep / network down** → nothing to fix. The extension long-polls
  with `waitMs: 12000` and backs off from 250 ms to a 5 s cap on failure
  (`extension/background.js:1540-1578`); it reconnects on its own.
- **Extension genuinely broken** → badge **Reconnecting** with a repeating
  error. Capture the exact error from the service-worker console (step 5.5),
  not from the popup's mapped paragraph.

Database-side (operator with SQL access):

- **Commands stuck in `queued`** → do not delete them by hand as a first move.
  They age out on their own: `opera_claim_next` marks a queued/claimed command
  `expired` once `expires_at` has passed, and `expires_at` is
  `now() + timeout_seconds + 5`
  (`20260907204146_opera_agent_1_0_0_core.sql:158,189`). Deleting them destroys
  the only evidence of what the client was waiting for.
- **No repo-side fix exists** for: the browser being closed, the machine being
  asleep, the network being down, or the Supabase project being unreachable.

### Escalate when

- `status = 'disabled'` on the row. Nothing in the repository disables a device;
  a human did. See **Disabled devices** in *Conventions used here* — do not
  re-enable it during this incident.
- The gateway returns `GATEWAY_ERROR` with `outcome: "unknown"` — the command was
  committed to the queue and the wait response was lost
  (`opera-agent-gateway/index.ts:121-129`). The action may already have run.
  Escalate with the `commandId`.
- Commands are claimed (`attempts > 0`) but never complete. That is a device-side
  hang; it needs the extension build's `lastError` and version, not SQL.
- `public.opera_methods` is missing `browser.ping`. That is a data change to a
  shared allowlist table — owner-only.

---

## 2. Pairing code rejected

### Symptoms

The user pastes a code into the popup and presses **Pair device**, and pairing
does not complete.

**Expect the popup's wording to be nearly useless here.** The visible error is
mapped through `extension/lib/error-messages.js`, so the user sees one of only a
few fixed sentences:

| What the user sees | What it actually means |
| --- | --- |
| *"That pairing code is invalid. Check the code and try again."* | The input failed a **length** check — it must be 8–64 characters. Two different checks produce that same string: the extension's own, before any request is sent (`extension/background.js:1450`), and the bridge's equivalent check on the same range (`supabase/functions/opera-agent-bridge/index.ts:62-63`). So this sentence does **not** tell you which side rejected it. Real codes are 16 uppercase hex characters. |
| *"Pairing failed. Check the code and try again."* | A **narrow** fallback, not the general one. It is the bridge's own placeholder used when the `opera_pair_device` RPC returns no JSON at all (`opera-agent-bridge/index.ts:76`). The extension's equivalent fallback (`extension/background.js:1462`, and `extension/popup.js:70` if the background returns `ok:false` with no error string) only fires on a `2xx` response whose `ok` is falsy, and this bridge never returns that — so **in practice an operator will rarely see this sentence at all.** |
| *"Something went wrong. Run self-test, then check the connection."* | **The common case, and the least specific one. Both of the two most frequent real failures land here**, because neither of their strings is a key in the mapper's `KNOWN` table (`extension/lib/error-messages.js:10-24`): a **rejected, expired, consumed, or superseded code** comes back as `'Pairing code is invalid or expired.'` (`…_core.sql:128`), and an **unreachable bridge or a pairing request that hits the 15 s timeout** rejects with a network/abort error instead of any string the mapper knows (`extension/background.js:1453-1461`; `fetchJson` throws the raw rejection at `extension/background.js:101-115`). Both fall through to the generic sentence. **Never read this as "connection problem"** — it is at least as likely to be a bad code. Diagnose the code row (step 1) before touching the network. |

The underlying reasons — an expired code, a consumed code, a superseded code, a
bridge-URL override pointing at the wrong function, an unreachable bridge — are
**not** shown to the user and **cannot** be recovered from the popup. This is
deliberate: raw backend strings are suppressed so internals never reach the UI
(`extension/lib/error-messages.js:1-9`). Diagnose from the database side, below.
Do not send the user back to the popup expecting a clearer message.

**Triage rule, because GENERIC covers two different faults.** The same sentence
means "the database rejected the code" *or* "the bridge was not reached", and the
popup cannot tell you which. **Step 1 is the discriminator:** a code row that is
no longer `still_usable` means the database rejected it (fix: step 4, make a
fresh code); a code row that is still `still_usable` means the request did not
come back successfully at the bridge (fix: check the bridge-URL override, then
re-pair). Run step 1 before blaming the network.

### Diagnose

**Step 1 — look at the code rows.** Never select `code_hash`; it is a hash and it
tells you nothing an operator can act on.

```sql
select device_name,
       created_at,
       expires_at,
       consumed_at,
       (consumed_at is null and expires_at > now()) as still_usable
  from public.opera_pairing_codes
 order by created_at desc
 limit 20;
```

Four failure modes are visible in this result set, and all four are verifiable
from `opera_pair_device`'s `WHERE` clause
(`20260907204146_opera_agent_1_0_0_core.sql:127`): the code hash must match, the
`device_name` must match the one the code was created for, `consumed_at` must be
null, and `expires_at` must be in the future.

| What you see | What actually happened |
| --- | --- |
| No row for this `device_name` | No code was ever created for this name, or it was created more than 20 rows ago. Create a fresh one. |
| `still_usable = false`, `consumed_at` is null, `expires_at` in the past | Expired. The default TTL is 10 minutes and is clamped to 1–60 minutes. |
| `still_usable = false`, `consumed_at` set | Already used. Each code is single-use; `opera_pair_device` stamps `consumed_at` on success (`…_core.sql:133`). |
| Several rows, the newest `still_usable = false` and an **older** row also unconsumed | Superseded. `opera_create_pairing_code` **consumes every unconsumed code for the same device name** before creating the new one (`…_core.sql:114`). The old code cannot work. |

**Step 2 — check the device row.**

```sql
select device_name, status, extension_version, protocol_version,
       last_seen_at, created_at, updated_at
  from public.opera_devices
 order by device_name;
```

- A row with `status = 'disabled'` can never authenticate: every authentication
  helper filters on `status <> 'disabled'`
  (`opera_auth_device`, `…_core.sql:141`). `opera_pair_device` is the exception —
  it does not check status, so a disabled device *can* be re-paired and comes back
  as `online`. See **Disabled devices** in *Conventions used here* for why that
  is still not something to do during an incident.
- A row that already exists is **not** an error. `device_name` is unique and
  `opera_pair_device` upserts on it, so pairing again **overwrites
  `token_hash`**. If a second browser pairs as `opera`, the first browser's token
  stops working immediately. This is the single most common cause of "it worked
  yesterday": someone re-paired and invalidated the other client.

**Step 3 — clock skew.** `expires_at` is computed with `now()` on the database
(`…_core.sql:116`) and compared against `now()` on the same database, so skew
between the database and the *browser* clock cannot cause an expiry. The browser
never sees the deadline. If you suspect clock problems, check the database
server's clock, not the laptop's.

**Step 4 — regenerate.**

```sql
select public.opera_create_pairing_code('opera', 10);
```

The returned JSON contains `ok`, `deviceName`, `code`, and `expiresAt`. The
`code` value is the only time it is ever visible; only its SHA-256 hash is stored.
Give the code to the user through a channel you trust. Do not put it in a ticket
or a commit.

TTL behavior, verified: `p_ttl_minutes` is clamped to 1–60 minutes regardless of
what you pass (`least(greatest(coalesce(p_ttl_minutes,10),1),60)`,
`…_core.sql:113`). A device name of 1–64 characters after trimming is required,
otherwise the function returns `{"ok":false,"error":"Invalid device name."}`
(`…_core.sql:112`).

### Fix

- **Expired / used / superseded / missing** → create a fresh code and pair again.
  There is no repair step; the old rows are inert.
- **Wrong bridge URL on the device** → the pairing request went somewhere that
  has no pairing RPC. Fix the override on the options page first, then re-pair.
  See the options-page troubleshooting note "Bridge override".
- **`status = 'disabled'`** → the single rule is in **Disabled devices** under
  *Conventions used here*. Read it before doing anything with this row.
- **No repo-side fix exists** for: a browser that refuses to store the token, a
  profile that resets `chrome.storage.local`, or a user who loses the pairing
  code before using it.

### Escalate when

- Re-pairing succeeds but the device is still not seen — that is incident 1, not
  a pairing problem.
- You are being asked to disable a device. Nothing in the repository does this;
  it is an owner-only production data change.
- Pairing works from one browser and not another for the same `device_name`.
  Because the name is unique, the two browsers are fighting over one row.

---

## 3. Update stuck on the legacy channel

### Symptoms

- The browser reports an extension update that is not the current release, or
  reports no update at all while `docs/install.md` says a newer version exists.
- An update-related HTTP request returns `404 No active release for extension ID`.
- Someone fetches the shared update URL and gets the wrong release.
- The user reports the extension did not update itself.

Background: the update channel is **database-driven**, not file-driven. The
update function looks up `public.opera_releases` for `active = true` **and** a
matching `extension_id`, and serves nothing if no row matches
(`supabase/functions/opera-agent-update/index.ts:46-56,92-96`). Publishing an
update means inserting an active row; there is no other mechanism in the
repository.

### Diagnose

**Step 1 — what release is actually active?**

```sql
select version, extension_id, active, created_at
  from public.opera_releases
 order by created_at desc;
```

Current identity is `ohbbpamcljckmjhcpkcmefdobkoeaick`
(`docs/install.md:8`; the identity history is at `docs/install.md:13`). The
legacy identity is `pagjlnohdemoohcncicjmaejedcmcocm`
(`opera-agent-update/index.ts:11`).

**Read the constraint before you change anything.** The active-row constraint is
the partial unique index `opera_releases_one_active_per_identity_idx` on
`(extension_id) where active = true`
(`supabase/migrations/20260909045456_opera_agent_per_identity_update_channels.sql:13-15`).
It permits **at most one active release per signing identity, and places no limit
across identities.** An earlier table-wide index,
`opera_releases_one_active_idx` on `(active) where active = true`
(`20260908021039_opera_agent_releases.sql:13-14`), was deliberately **dropped** at
`…per_identity_update_channels.sql:5`; that same migration moved the primary key
to `(extension_id, version)` (`:10-11`) and states its purpose in the first line:
"Allow the legacy and replacement signing identities to publish independently."

So **each identity can have its own active release at the same time**, and a
request is always resolved by its own extension ID
(`opera-agent-update/index.ts:46-56,90-91`) — one identity is never served
another's CRX.

**The mundane reading of a 404.** If step 1 shows an active row for
`pagjlnohdemoohcncicjmaejedcmcocm` but none for `ohbbpamcljckmjhcpkcmefdobkoeaick`,
the current identity simply has **no active release published**. That is a
publishing gap, not a schema limit, and not by itself evidence that anything is
"stuck on the legacy channel".

**Step 2 — the identity diagnostic.** Requesting the shared URL with no ID
returns the legacy channel **by design**: when no ID is present the function
falls back to `LEGACY_EXTENSION_ID`
(`opera-agent-update/index.ts:42`). This is not a bug and it is not a cache
problem. To ask "what would the current identity receive?", ask with the ID:

```bash
curl -sS "$UPDATE/update.xml?id=ohbbpamcljckmjhcpkcmefdobkoeaick"
```

- `200` with a `<gupdate>` body → the channel is serving this identity. The
  version in the body is the version the browser would be offered. If that is
  the expected version, the problem is on the browser side.
- `404 No active release for extension ID` → there is no active
  `opera_releases` row for this identity. Go back to step 1.
- `400 Invalid extension ID` → the ID does not match `^[a-p]{32}$`
  (`opera-agent-update/index.ts:12,43`). You have a typo or a wrong ID, not a
  server problem.
- The **unversioned** shared URL returns a legacy release → expected behavior.

The same resolution applies to `/health` on the update function, so it also needs
the ID or it will report the legacy channel:

```bash
curl -sS "$UPDATE/health?id=ohbbpamcljckmjhcpkcmefdobkoeaick"
```

**Step 3 — is the browser actually asking?** The update function records every
`update.xml` and `.crx` request it serves, with the served version and the
user-agent, in `public.opera_update_events`
(`opera-agent-update/index.ts:58-77`; table at
`20260908074202_opera_agent_update_telemetry.sql`). No IP address is stored.

```sql
select requested_at,
       request_kind,
       method,
       path,
       query_string,
       served_version,
       user_agent
  from public.opera_update_events
 order by requested_at desc
 limit 50;
```

Interpretation:

`query_string` is stored verbatim from the request URL, leading `?` included
(`opera-agent-update/index.ts:70`), so it is the raw record of which identity the
updater presented. Three forms matter, and you need the healthy one to judge the
others:

- **Healthy (a real browser):** `?x=id%3Dohbbpamcljckmjhcpkcmefdobkoeaick%26v%3D1.6.13`
  — the Chromium app-metadata parameter, which the resolver reads **first**
  (`:36-44`).
- **Operator-issued:** `?id=ohbbpamcljckmjhcpkcmefdobkoeaick` — the manual
  diagnostic form, read only as a fallback when `x` carries no `id` (`:41`). Rows
  in this shape are your own `curl`s, not a browser.
- **No ID resolvable:** the field is empty, or holds an `x=` with no `id=` inside
  it. The resolver then falls back to `LEGACY_EXTENSION_ID` (`:42`), so the
  request was resolved against the legacy identity — and would have been
  answered with a `404` if the legacy identity has no active release, which is
  also why such a row can be absent.

Then, per row:

- **No recent row for this identity** → the browser may not be polling, **or the
  request never reached a served response.** Telemetry is written only *after* a
  matching active release has been found (`:92-99,112`), so a
  `404 No active release for extension ID` is **never recorded**. An empty
  `opera_update_events` therefore cannot distinguish "the browser is not asking"
  from "the browser asked and was 404'd" — confirm with the step 2 `curl` before
  concluding anything about the browser. If the channel is healthy, the update
  check is browser-scheduled and no repository code forces or schedules it; check
  that the installed extension still has the private `update_url` from
  `extension/manifest.json:49` and that the browser has not been switched to a
  different update policy by enterprise policy.
- **Rows present, `served_version` is the version you expect, device still old** →
  the channel is fine and the browser declined or has not yet applied the update.
- **Rows present with an empty or ID-less `query_string`** → the request arrived
  with no usable ID and was resolved to the legacy channel. The browser is not
  appending its installed ID, which per `docs/install.md:21` it normally does
  automatically.

**Step 4 — confirm what the device reports.**

```sql
select device_name, extension_version, protocol_version, last_seen_at, updated_at
  from public.opera_devices
 order by device_name;
```

`extension_version` is written by the heartbeat and the claim pass
(`20260907204146_opera_agent_1_0_0_core.sql:148,157`), so it is the best
available evidence that an update was adopted. It lags `last_seen_at` in the
sense that a stale `last_seen_at` means a stale `extension_version` too — see
incident 1.

### Fix

- **No active row for the current identity** (the legacy identity may or may not
  have one; the two are independent) → this is a production data change to
  `public.opera_releases`. Owner-only. Do not write to that table during an
  incident.
- **A new release is needed** → publishing is owner-only work. `docs/release-process.md`
  requires a git tag, a GitHub Release, a `CHANGELOG.md` update, passing tests, and
  a packaged and signed extension artifact. None of that is an incident action.
- **Browser is not polling** → user-side. Confirm the extension is installed from
  the private channel and that `opera://extensions` shows the expected version.
  Reloading the extension is a user action.
- **No repo-side fix exists** for: a browser that has update checks disabled by
  enterprise policy, or a store/sideload build that ignores `update_url`.

### Escalate when

- Anyone asks you to insert or flip an `opera_releases` row during an incident.
  That is a signed-release production change and it is owner-only.
- The active release's `sha256` does not match the published CRX.
- `opera_update_events` shows requests for an identity nobody in the incident
  recognizes.

---

## 4. Gateway 401s

### Symptoms

`POST /command` returns HTTP 401. Two different 401s exist and they mean
different things:

| Body | Code | Meaning |
| --- | --- | --- |
| `{"ok":false,"error":{"code":"UNAUTHORIZED","message":"Missing token (x-opera-agent-token header or body.apiKey)."}}` | `UNAUTHORIZED` | No token arrived at all. |
| `{"ok":false,"error":{"code":"UNAUTHORIZED","message":"Invalid token for device."}}` | `UNAUTHORIZED` | A token arrived and did not match. |
| `{"ok":false,"error":{"code":"DEVICE_NOT_PAIRED","message":"Device is not paired."}}` | `DEVICE_NOT_PAIRED` | The device disappeared or was disabled while the command was in flight. |

Both source and full table: `docs/api.md:93-107`. The `DEVICE_NOT_PAIRED` row in
that table has been corrected to match the code, so the two documents now agree:
**an already-disabled device returns `UNAUTHORIZED`, not `DEVICE_NOT_PAIRED`**
(step 3 below is the reading to use, and it is the one the code supports).

### Diagnose

**Step 1 — rule out "no token" first.** The gateway reads exactly three
carriers, in this precedence order (`opera-agent-gateway/index.ts:55-60`,
documented in `docs/api.md:36-49`):

1. `x-opera-agent-token: <token>`
2. `Authorization: Bearer <token>` — the `Bearer ` prefix is optional and matched
   case-insensitively, so a bare token works
3. `apiKey` in the JSON body

**A `?apiKey=` query parameter is never read on any route.** If the caller is
putting the token in the URL, that is the bug — and it also means the token has
been written into proxy and browser logs. The header carriers exist precisely so
the token stays out of bodies that may be logged (`docs/api.md:43-45`).

**Step 2 — is the gateway even up?**

```bash
curl -sS "$GATEWAY/health"
```

`GET /health` and `GET /openapi.json` require no token
(`docs/api.md:51-52`). If these fail, this is not an auth problem — it is a
deployment or network problem, and `docs/api.md` should still tell you which
routes exist. Note the caveat in `docs/api.md:146-150`: the served
`/openapi.json` is the authority and the markdown can drift, so if the two
disagree, trust the served spec and report the drift.

**Step 3 — separate "token wrong" from "device gone".** The gateway verifies the
token *before* it looks at the queue
(`opera-agent-gateway/index.ts:87-104`), and the verification helper,
`public.opera_verify_device`, requires all three of: a row named `opera`, a
matching `token_hash`, and `status <> 'disabled'`
(`20260922000000_opera_agent_ut_etw.sql:83-91`). Consequences:

- **A disabled device returns `UNAUTHORIZED`, not `DEVICE_NOT_PAIRED`.** This is
  surprising enough to be worth stating plainly: a `401 UNAUTHORIZED` with
  "Invalid token for device" is the signature of a disabled device as much as of
  a wrong token. Check `status` before you go hunting for a credential problem.
- `DEVICE_NOT_PAIRED` only appears when the device goes away between
  verification and enqueue, or when the enqueue path reports "not paired"
  (`opera-agent-gateway/index.ts:101,132-134`).

**Step 4 — check the device row and the audit trail.**

```sql
select device_name, status, extension_version, protocol_version,
       last_seen_at, created_at, updated_at
  from public.opera_devices
 order by device_name;
```

**This query answers a question `opera_verify_device` cannot.** The helper
returns a bare `{ok: false}` for *every* failure — no row, wrong hash, and
disabled device are indistinguishable at the RPC boundary. The table below is
what separates them:

| Query result | Conclusion |
| --- | --- |
| **No rows at all** | The device `opera` has never been paired. `UNAUTHORIZED` is correct. Go to incident 2 and pair it. |
| A row with `status = 'disabled'` | Disabled by a human. `UNAUTHORIZED` is correct. Owner-only. |
| A row, status `online` or `offline`, `updated_at` recent | The device exists and is enabled, so the token itself is wrong, stale, or from another browser. Continue below. |
| A row, `updated_at` long in the past | The device has not contacted the server in a long time. Auth may be fine; you also have an incident 1 problem. |

Do not select `token_hash`. The database cannot tell you whether a caller's
token matches — it stores only the hash, and
`20260907204146_opera_agent_1_0_0_core.sql:16` constrains it to 64 lowercase hex
characters. The token is hashed **lowercased** before comparison
(`opera-agent-gateway/index.ts:87`), so a token supplied with uppercase hex still
matches, and a token that is not 64 hex characters simply never matches.

Was the device recently re-paired? `opera_pair_device` upserts on `device_name`
and overwrites `token_hash` (`…_core.sql:129-132`). A successful re-pair is
audited:

```sql
select created_at, event_type, device_id, details
  from public.opera_audit
 where event_type in ('device.paired', 'pairing_code.created')
 order by created_at desc
 limit 20;
```

A `device.paired` row inside the incident window means the token rotated, and
every holder of the previous token now gets `401`. Cross-reference incident 2.

**Step 5 — reproduce without printing the token.**

First, a thing you need to know before you start: **if you do not already have
`$OPERA_AGENT_TOKEN` in your shell environment, this step cannot be run, and
there is no way for you to obtain the token.** The plaintext token exists in
exactly one place — `chrome.storage.local` on the paired browser. The database
holds only its SHA-256 hash, which cannot be reversed. Do **not** ask the user to
paste the token into a chat, a ticket, or a terminal you share; that converts a
credential problem into a credential incident. If the token is unavailable, skip
to step 4 and work from the database side, and say in your escalation that step 5
could not be run for lack of the token.

With the variable already exported, and letting the shell expand it:

```bash
curl -sS -X POST "$GATEWAY/command" \
  -H "content-type: application/json" \
  -H "x-opera-agent-token: $OPERA_AGENT_TOKEN" \
  -d '{"method":"browser.ping","params":{},"waitMs":2000}'
```

Do not add `set -x`, do not echo the variable, and do not paste the expanded
command back into a ticket.

Read the result:

| Result | Conclusion |
| --- | --- |
| `200` with `ok: true` | The token is valid and the device is online. The 401 is in the caller's request, not in the credentials — go back to step 1 and check its carrier and its origin. |
| `401 UNAUTHORIZED` "Invalid token for device" | The token did not verify. Go back to step 3 and 4. |
| `401 UNAUTHORIZED` "Missing token" | The shell variable is empty or unset. This is a local problem, not a server one. |
| `200` with `error: "Device is offline."` and `lastSeenAt` | **Auth passed.** This is incident 1, not incident 4. The device is not being seen. |
| `504` / `AWAIT_TIMEOUT` | **Auth passed.** Also incident 1 — the device authenticated but did not report back in time. |
| `403` or a CORS-shaped browser error | Not this incident. See step 6. |

**Step 6 — if the caller is a browser page and got no response at all.** CORS on
the gateway is fail-closed: an `Access-Control-Allow-Origin` header is echoed
only for an exact match against the allowlist, which comes from the
`CORS_ALLOWED_ORIGINS` environment variable when set, otherwise the extension
and consent-page defaults (`supabase/functions/_shared/cors.js:1-22`). A missing
`Origin` header gets no ACAO header at all; an unlisted origin gets no ACAO
header. Browser-side, that looks like a failed request with no readable body —
not a 401.

The bridge function behaves differently: it sends
`Access-Control-Allow-Origin: *`
(`opera-agent-bridge/index.ts:11-16`). Authentication there is the device token
on every action, not the origin. So: **if a browser caller is blocked with no
ACAO header, it reached the gateway or the update function, never the bridge.**

### Fix

- **Token in the query string** → move it to a header. This is a caller fix, and
  it is a security fix too, because the token has been in URLs and logs.
- **Token rotated by a re-pair** → the caller must obtain a new token by pairing
  again. See incident 2.
- **Device disabled** → see **Disabled devices** in *Conventions used here*.
  Owner-only; do not re-enable during an incident.
- **Origin not allowlisted** → add the origin to `CORS_ALLOWED_ORIGINS` for the
  deployed function. That is an environment change and therefore owner-only.
- **No repo-side fix exists** for: a token that was never issued, a caller
  pointing at the wrong project base URL, or a token pasted with surrounding
  whitespace/quotes.

### Escalate when

- You are asked to print, copy, or rotate a device token. Rotation is
  owner-only.
- The 401s started with no `device.paired` audit row and no config change you can
  find — that is unexplained credential behaviour.
- The caller is the MCP function or another edge function rather than a
  human-operated client, and its service-role configuration is in scope.

---

# Part 2 — Proposed SLOs

> **Everything in this part is a proposal, not a commitment.** The figures are
> starting points for the owner to accept, edit, or reject. None of them is a
> published target, and adopting one is a decision, not a fact about this
> system. Where the repository does not imply a number, none is given.

**What does not exist today, for all three.** There is no monitoring
configuration, no dashboard definition, no alerting rule, and no SLO-evaluation
job anywhere in this repository. There is no metrics exporter in any edge
function; the only observability artifact is a structured `console` write
(`supabase/functions/_shared/edge-log.js:1-25`) that goes to whatever log
collector the Supabase project has configured. Nothing in the repository reads
those logs. Circling is the CI gate for tests; there is no continuous
performance gate. So every SLO below has to be built before it can be tracked,
and the cost of building it should be weighed against the value of the number.

The latency figures already recorded in `docs/benchmarks.md` are **local
loopback observations from an isolated browser profile, explicitly labelled
"observations, not latency assertions."** They are not a production baseline and
must not be quoted as one.

## SLO 1 — Pairing success rate

- **Proposal:** ≥ 95% of pairing codes created are consumed by a successful
  pairing within their TTL, measured over a rolling 7 days. Owner-adjustable; a
  low-volume deployment will have a denominator too small to be meaningful, and
  the owner should decide whether to measure an absolute count instead.
- **Measurement artifact:** `public.opera_audit`, which has exactly two relevant
  `event_type` values — `pairing_code.created` and `device.paired`
  (`20260907204146_opera_agent_1_0_0_core.sql:118,134`). Numerator is
  `device.paired` rows; denominator is `pairing_code.created` rows; the ratio is
  taken per 7-day window.
- **The honest caveat, which matters more than the number:**
  **failed pairing attempts are not recorded anywhere.** `opera_pair_device`
  returns `'Pairing code is invalid or expired.'` before it writes any audit row
  (`…_core.sql:127-128`). So the denominator counts attempts-to-pair but the
  numerator only counts successes that reached the database. A user who typed a
  typo into the popup is invisible to this metric. This SLO can only measure
  "codes that were used successfully", not "attempts that succeeded". Making it
  measure the latter requires a code change that adds an audit write on the
  failure path, plus a migration — owner decision, not an incident fix.
- **Also does not exist:** no pairing-failure log, no funnel view, no per-browser
  breakdown. The device name is recorded in `pairing_code.created` details, and
  there is only ever one device name in normal operation.

## SLO 2 — Command latency

- **Proposal:** express this as a ceiling that the code already enforces, not as
  an invented percentile. The gateway clamps the caller's `waitMs` to
  **500–32000 ms** and defaults it to 12000 ms when absent, non-numeric, or zero
  (`opera-agent-gateway/index.ts:39-40,84`; `docs/api.md:79`). A caller asking
  for more than 32 s silently gets 32 s. **Any command that has not completed
  within 32000 ms of enqueue is reported as `AWAIT_TIMEOUT` (HTTP 504).** The
  SQL layer is more permissive — `opera_await_adaptive` clamps to 100–55000 ms
  (`20260922000000_opera_agent_ut_etw.sql:97`) — but the gateway never passes a
  value outside 500–32000, so **32000 ms is the real ceiling on this path.**
- **How a p95 would actually be measured:** `public.opera_commands` already
  carries the three timestamps needed — `created_at`, `claimed_at`,
  `completed_at` — and the RPCs return them precomputed as `timing.queuedMs` and
  `timing.totalMs`
  (`20260922000000_opera_agent_ut_etw.sql:100`). A p95 is a percentile over
  `totalMs` for terminal-status rows in a window. Queue time and execution time
  should be tracked separately: a rising `queuedMs` with a flat `totalMs - queuedMs`
  is a device-availability problem (incident 1), not a latency problem.
- **What does not exist:** no latency percentile is computed anywhere. There is
  no query, job, or dashboard that produces one. `opera_commands` is not purged
  (see Part 3), so the raw material grows without bound and the owner would need
  a pruning policy *before* a long-window percentile is trustworthy.
- **Do not propose a target number from this repository.** The only published
  numbers are local loopback observations in `docs/benchmarks.md`, measured on an
  isolated profile with no production network in the path. The owner must set the
  target from production evidence.

## SLO 3 — Update propagation time

- **Proposal:** time from a release becoming the active row in
  `public.opera_releases` to the paired device reporting that version in
  `public.opera_devices.extension_version`. This is inherently **hours to days**,
  because the check is browser-scheduled and nothing in the repository forces it
  (`extension/manifest.json:49` sets `update_url`; there is no push path). Treat
  it as a coarse health signal, not a latency SLO. Owner-adjustable.
- **Measurement artifact:** two tables. `public.opera_update_events` records
  every served `update.xml`/`.crx` request with `requested_at` and
  `served_version`
  (`20260908074202_opera_agent_update_telemetry.sql:1-12`). Join the first
  request serving version V against the first moment
  `opera_devices.extension_version` becomes V.
- **The honest caveat:** `opera_update_events` records that a manifest was
  **served**, not that it was **installed**. Adoption is inferred from the next
  heartbeat that carries the new version, which is itself browser-scheduled. A
  device that never polls shows as "never adopted", not as "failed". There is no
  install-confirmation event anywhere in the repository.
- **Also does not exist:** no adoption report, no rollout view, and
  `opera_update_events` is not purged (Part 3), so it grows unbounded.

---

# Part 3 — Data retention

**Read this first: there is no scheduler in this repository.** The two cleanup
RPCs and the VM deadline reaper all exist and are all safe to call, but
**nothing in the repository calls them.**
Verified by searching the whole tree: there is no `pg_cron` extension, no
`cron.schedule` call, no `pgagent`, no GitHub Actions `schedule:` block (the only
workflow file is `.github/workflows/release.yml`, which has no schedule), no
Vercel cron configuration, and no Supabase scheduled invocation. The only
extensions any migration installs are `pgcrypto`
(`20260907204146_opera_agent_1_0_0_core.sql:4`) and `pg_net`
(`20260908031756_opera_agent_async_workflow_runner.sql:1`). If the owner wants
these RPCs to run on a timer, that infrastructure has to be built first; it does
not exist yet.

| Data class | Where it lives | What purges it | Retention window actually enforced |
| --- | --- | --- | --- |
| Command history | `public.opera_commands` | **manual** — no RPC, no job. No purge statement exists in any migration for this table. | **none enforced.** Rows age out of the *queue* (`expires_at`, set to `now() + timeout_seconds + 5`) but the row itself is kept forever. `opera_claim_next` only flips `status` to `expired`. |
| Audit rows | `public.opera_audit` | **manual** | **none enforced.** |
| Watch events | `public.opera_watch_events` | **manual.** One-time sweep only: the `20260922000000_opera_agent_ut_etw.sql` migration ends with a single `delete ... where created_at < now() - interval '24 hours'` (line 130). That is a migration-time statement, not a recurring purge, and it has not run since. | **none enforced.** The migration comment calls it "a notification stream, not an archive" — the intent is 24 h, the enforcement does not exist. |
| Update telemetry | `public.opera_update_events` | **manual** | **none enforced.** No IP address is stored (table comment). |
| Pairing-code rows | `public.opera_pairing_codes` | **manual.** Nothing deletes them. Codes expire functionally via `expires_at` checked in `opera_pair_device`; the rows persist. | **none enforced.** Functional expiry only: default 10 minutes, clamped to 1–60 minutes. |
| Goal-head metadata | `opera_agent_private.goal_heads` | `public.opera_goal_cleanup(p_retention_seconds integer default 86400)` | **86400 s (1 day) by default.** Rejects anything outside **3600–604800 s** with SQLSTATE `22023`. Deletes rows whose `expires_at` is older than the retention window, **or** whose `status` is `CANCELLED`/`EXPIRED` and whose `updated_at` is older than the window. Returns the deleted row count. `security definer`, `search_path = pg_catalog, opera_agent_private` (`20260911162525_opera_agent_goal_head.sql:215-233`). |
| Reactive-VM runs and rate windows | `opera_agent_private.vm_runs`, `opera_agent_private.vm_rate_windows` | `public.opera_vm_cleanup(p_retention_seconds integer default 86400)` | **86400 s (1 day) by default**, same **3600–604800 s** guard and same SQLSTATE `22023`. Deletes `vm_runs` whose `status` is one of `SUSPENDED`, `RETURNED`, `LIMIT_REACHED`, `FAILED`, `CANCELLED`, `EXPIRED` and whose `updated_at` is older than the window; deletes `vm_rate_windows` whose `window_start` is more than 10 minutes old. Returns `{"runsDeleted":n,"rateWindowsDeleted":n}`. `security definer`, same `search_path` (`20260912061541_opera_agent_reactive_vm_host.sql:693-715`). Note the rate-window cutoff is a hardcoded 10 minutes and is **not** affected by `p_retention_seconds`. A run's `status` becoming `EXPIRED` is not retention either — see **Not a purge: `opera_vm_expire`** below. |
| Workflow run history | `public.opera_workflow_runs` | **manual** | **none enforced.** |
| Edge logs | Whatever log collector the Supabase project has configured | the platform's own retention settings — **not a repository concern** | **unknown.** No repository artifact states the platform's retention. |
| Browser logs | In-memory ring buffer, max 200 entries, per context (`extension/lib/agent-log.js:4`); plus the browser's own devtools console | nothing — the buffer is discarded when the context ends | **none.** Not persisted anywhere. A service-worker restart or tab navigation loses it. Level defaults to `warn`; raise it to `debug` on the options page for an active incident. |
| Device tokens | `public.opera_devices.token_hash` (SHA-256 hex only; the plaintext token exists only in `chrome.storage.local` on the paired browser) | **manual.** The popup's **Unpair device** button is *local only* — it removes the local storage keys and stops the pull loop (`extension/background.js:1475-1480`). It does **not** delete or disable the database row. | **none enforced.** Rotating a token means re-pairing the device name, which overwrites `token_hash` (`20260907204146_opera_agent_1_0_0_core.sql:129-132`). |

## Calling the two cleanup RPCs

Both are `revoke`d from `public`, `anon`, and `authenticated` and **granted to
`service_role`**. An owner or `postgres` role can also call them directly. From
the SQL editor:

```sql
select public.opera_goal_cleanup();       -- default 86400
select public.opera_vm_cleanup();         -- default 86400
```

Both raise an exception if you pass a retention outside 3600–604800 seconds. To
choose a window explicitly:

```sql
select public.opera_goal_cleanup(604800);  -- 7 days, the maximum allowed
select public.opera_vm_cleanup(3600);       -- 1 hour, the minimum allowed
```

**There is no repository evidence that either has ever been executed against
production.** Treat the first run as a rehearsal: run it with the default window,
read the returned counts, and confirm the numbers are plausible before choosing a
window.

## Not a purge: `opera_vm_expire` — the VM *deadline* reaper

`opera_vm_expire` is the third RPC an operator looking for "what expires VM
runs" should know about, and it is **not** a retention function. It changes a
run's `status`; it never deletes a row. Deleting is `opera_vm_cleanup`'s job
alone.

```sql
public.opera_vm_expire(p_limit integer default 100) returns integer
```

`security definer`, `search_path = pg_catalog, opera_agent_private`, `revoke`d
from `public`/`anon`/`authenticated` and granted to `service_role` — the same
posture as the two cleanup RPCs
(`20260912061541_opera_agent_reactive_vm_host.sql:664-691,727,740`). What it
does, verified from the body:

- Flips `QUEUED` or `RUNNING` runs in `opera_agent_private.vm_runs` whose
  `expires_at <= clock_timestamp()` to `EXPIRED` (`:675-687`). `expires_at` is
  the run's own hard deadline and is bounded to at most 5 minutes after
  `created_at` by a table check constraint (`:81`).
- Clears `available_at`, `lease_owner`, and `lease_expires_at` on those rows, and
  sets `error_code` to `RUN_DEADLINE` **only if it is still null** (`:684-685`) —
  so a run that already failed for another reason keeps its original code.
- Processes **all tenants**, oldest `expires_at` first, capped at `p_limit` rows
  per call, using `for update skip locked` so it is safe to run concurrently
  (`:675-682`). A limit outside **1–1000** raises SQLSTATE `22023` (`:674`).
- Returns the number of rows it transitioned.

It is the **cross-tenant, batched** form of a transition that
`opera_vm_claim` already performs for one tenant on demand
(`:314-319`), so a run that is being claimed is not going to be missed. Two
differences worth knowing: `opera_vm_expire` does **not** check the
`milestone7_vm_enabled` config flag that `opera_vm_claim` checks
(`:304-307`), and it can be run as a standalone sweep for tenants that are not
currently claiming. There is no repository evidence it has ever been executed.
**What the code does not say:** whether the design intends it as a periodic
sweeper or purely as an operator-triggered repair for abandoned runs. Nothing in
this repository calls it, so the intent is not recoverable from the code.

## Purging the classes with no automated purge

There is no repository-verified purge statement for command history, audit rows,
watch events, update telemetry, pairing codes, or workflow runs. Nothing in this
repository deletes them, and inventing a `DELETE` here would be an unverified
instruction in the one document that must not contain any.

If the owner decides a purge is required, the shape to review is:

```sql
-- TEMPLATE. UNTESTED. Not executed by any repository artifact, not covered by
-- any test, and not reviewed. The owner must confirm the table name, the time
-- column, and the row count before running anything.
--
-- delete from <schema>.<table> where <timestamp_column> < now() - interval '<window>';
--
-- Wrap in an explicit transaction, SELECT the count first, and take a dump
-- before deleting anything from a shared production database.
```

Rows in these tables are the audit trail. Deleting them is a production data
decision with no rollback in this system.

---

# Part 4 — Accessibility appendix

**This states only what is in the code. It makes no conformance claim.**

## What shipped

All of the following is in `extension/popup.html` and `extension/options.html`
and was verified by reading those files:

| Element | Semantics | Location |
| --- | --- | --- |
| Status badge | `aria-live="polite"` on `<span id="statusBadge">` | `popup.html:18` |
| Self-test result | `aria-live="polite"` on `<pre id="selfTestResult">` | `popup.html:52` |
| Error message | `role="alert"` on `<p id="error">` | `popup.html:31` |
| Card sections | `aria-labelledby` on each `<section class="card">`, pointing at that section's `<h2>` | `popup.html:21,34,44`; `options.html:44,63` |
| Pairing code input | `<label for="pairCode">` bound to `<input id="pairCode">` | `popup.html:38-39` |
| Bridge URL input | `<label for="bridgeUrl">` bound to `<input id="bridgeUrl">` | `options.html:50-51` |
| Log level input | `<label for="logLevel">` bound to `<select id="logLevel">` | `options.html:52-53` |
| Buttons | Native `<button>` elements throughout, including `type="submit"` for the settings form | `popup.html:40,48,49,50`; `options.html:58` |
| Save confirmation | `role="status"` with `aria-live="polite"` on the save hint | `options.html:59` |
| Decorative icon | `aria-hidden="true"` on the brand SVG | `popup.html:12`; `options.html:36` |
| Document language | `<html lang="en">` on both pages | `popup.html`, `options.html` |

Because every control is a native element with a bound label or an accessible
name from its text content, keyboard operation and focus order follow the
browser's native behaviour. There is no custom key handling, no
`tabindex` manipulation, and no focus trap anywhere in the extension UI.

## What has NOT been done

- **No WCAG conformance claim.** No conformance level has been assessed, assessed
  against any success criterion, or asserted anywhere in this repository.
- **No assistive-technology testing.** No screen-reader test (NVDA, JAWS,
  VoiceOver, Narrator, Orca), no switch-access test, no voice-control test has
  been run. There is no record of one.
- **No contrast measurement.** No colour pair has been measured against WCAG
  contrast thresholds. `extension/styles.css` and the inline `<style>` block in
  `options.html` define the palette; nothing in the repository measures it.
- **No automated accessibility audit.** No axe, Lighthouse, or equivalent
  accessibility check runs in CI. The test suite does not assert accessibility
  properties.
- **No usability testing** with assistive-technology users.

The semantics above are a reasonable baseline. They are not evidence of
accessibility, and this appendix should not be cited as if they were. If the
owner needs a conformance claim, that is a separate piece of work with its own
evidence.

---

# Escalation

## What to hand the owner

Every escalation should carry these four things. An escalation without them will
come back.

1. **The exact failing output**, pasted verbatim and unedited: the HTTP status
   and full JSON body, or the exact SQL and its exact result or error. Include
   the SQLSTATE for SQL errors. If the failure came from the browser, include the
   popup's error paragraph verbatim and the self-test result block.
2. **The head SHA** of the branch or commit under investigation
   (`git rev-parse HEAD`).
3. **That head's CI status** — CircleCI, which is the canonical code/test gate,
   plus Vercel for the deployment check. Not "CI is probably green"; the run URL
   or an explicit statement that it was not checked.
4. **What you already ruled out**, using this runbook. Say which incidents you
   walked and what the result was. "I checked incidents 1 and 2, device is paired
   and last seen 4 minutes ago" saves the owner the first ten minutes.

Explicitly **do not** include: any device token, any pairing code, any signing
material, any service-role key, or raw captured page content. If you paste a
token by accident, treat it as compromised and say so in the escalation.

## Actions that are owner-only

Do not perform any of these during an incident, even when the diagnosis is
certain:

- **Production deployment or promotion.** CI being green does not authorize it.
- **Signing or promoting a release.** Inserting or activating a row in
  `public.opera_releases`, and any private signing-key operation. Private signing
  keys must never enter the repository (`SECURITY.md:11`).
- **Token or key rotation**, including re-pairing a device that other clients
  depend on, and any `CORS_ALLOWED_ORIGINS` change on a deployed function.
- **Production SQL writes.** Enabling or disabling a device, changing
  `public.opera_methods`, inserting into `public.opera_releases`, or any purge.
  Reads are fine; writes are not.
- **Deleting anything.** No purge in this system has a rollback.
- **Changing CI configuration**, including turning a red job green.

## If you are not sure

Re-read the Diagnose section for the matching incident and run the queries. They
are read-only. If the answer still is not in this document, it is not in the
repository either — say so in the escalation rather than filling the gap with a
guess. A confident wrong instruction at 3am costs more than a documented gap.
