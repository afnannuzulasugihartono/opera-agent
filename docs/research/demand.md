# What people actually try, and pay for

Research note, 2026-10-20. Companion to `agent-surface.md`. That one asked how an agent
chooses a tool; this one asks what a *person* chooses to try.

## Method, and its limits

The search engine returned nothing, so this is built from primary sources that answer
directly: competitor pricing pages, a competitor's own task-mix telemetry, and Hacker News
threads (via the Algolia API) where buyers and builders argue in public.

Limits, stated up front:

- **No Indonesian market data.** Local claims below are marked `[UNVERIFIED]` and need
  five conversations, not more browsing.
- **Competitor telemetry is marketing.** Browser Use's task mix is self-reported; direction
  is usable, precision is not.
- **n is small.** One pricing page, one task mix, two threads.

## What the work actually is

Browser Use publishes how its 30 kinds of task are distributed. The largest slices:

| Task | Share |
|---|---|
| **Getting past a login** | **18%** |
| Turning a page into data | 14% |
| Clicking through a site | 12% |
| Applying for jobs | 6% |
| Finding filings and reports | 5% |
| Signing in to a portal | 3% |
| Booking and buying | 3% |
| Filling in a form | 1% |

Two things fall out of that table.

1. **Nearly a fifth of all browser-agent work is a login wall.** The industry's answer is
   to build credential vaults, MFA handling, captcha solving, residential proxies and
   "digital personas" — Notte lists all five as features. That is a large, fragile,
   expensive machine built to *become* someone.
2. **The second and third largest tasks are "there is no API for this".** Reading a page,
   clicking through a site. Not glamorous, but that is where the volume is.

Opera Agent's structural advantage lands exactly on the top row: the browser is already
logged in. No vault, no MFA, no captcha, no proxy, no persona. The user's own session is
the credential. That is cheaper to run, safer to sell, and impossible to copy by a headless
cloud.

## What buyers complain about

From the Notte launch thread (Hacker News, 2025-08), the loudest complaint was not speed or
accuracy. It was **paying for failure**:

> "Credit based pricing is broken. No way u produce sh*t then user get out of credit to get
> nothing done."

> "I pay $xxxx for the Claude API, half of the time it breaks it's own code... So you pay
> credits and you get 'stuff' that 'might work'."

The founder conceded and promised the fix:

> "We're working on fail-credit refunds so charges only apply to successful runs."

That is the single most useful sentence in this research. **The market has already asked
for success-only pricing, and nobody can deliver it cleanly, because nobody can prove
success.** Our whole recent line of work — `settled`, `covered`, `placed`, per-step proof —
is the machinery that makes a verified-completion invoice possible.

The second complaint was trust in the *result*: it looked finished and was not. Same
family of problem. Same machinery answers it.

## What the market charges

| Player | Model | Anchor |
|---|---|---|
| Browserbase | infra, per browser-hour | $20 / $99 / custom; $0.10–0.12 per browser hour; captcha and stealth included |
| Browser Use | pay-as-you-go | $0.02 per browser hour, model + 20%; a hard task ≈ $0.15 |
| Notte | credits | $79/mo for 10k credits; ~$0.21 for a 10-step, 1-minute task |

Infrastructure is cheap and commoditising. The money is in **outcomes**, and the
willingness to pay collapses the moment the outcome is uncertain. That is why per-task
pricing is unpopular and per-success pricing is being promised.

## Six candidate products, scored

Scored 1–5 on: frequency (does it repeat), session-only (does it need the user's login),
artifact (is there a file/table at the end), payer (is there someone with budget), build
(can our generic primitives do it this month), risk (legal, ethical, account safety).

| Candidate | Freq | Session | Artifact | Payer | Build | Risk | Total |
|---|---|---|---|---|---|---|---|
| Agency reporting from ad/analytics dashboards | 4 | 5 | 5 | 5 | 4 | 2 | **25** |
| Marketplace seller ops (upload, reconcile, reply) `[UNVERIFIED]` | 5 | 5 | 5 | 4 | 3 | 3 | **25** |
| Bureaucracy forms (tax, visa, permits) `[UNVERIFIED]` | 2 | 5 | 5 | 5 | 2 | 4 | **23** |
| Personal data export (bank statements, invoices) | 3 | 5 | 5 | 3 | 3 | 4 | **23** |
| Insurance/claims portal work (US B2B) | 5 | 5 | 5 | 5 | 2 | 4 | **26** |
| Job applications | 4 | 5 | 3 | 2 | 4 | 5 | **23** |

The top two are tied on score but not on reachability. Insurance pays best and is
unreachable from here without a US sales motion and compliance. Agency reporting is
reachable this week, has a clean artifact, and repeats monthly.

## Recommendation

**First product: a monthly report, assembled from dashboards the client is already logged
into, priced per delivered report, free if it fails.**

Why this one:

- The artifact is obvious: a spreadsheet or deck in the client's own format.
- The login is the moat: ad platforms and analytics hold the numbers behind accounts.
- The buyer is a business, not a consumer, and already pays for reporting time.
- It exercises the generic engine end to end — navigate, read, extract, compose — with no
  per-site code in the extension.
- Failure is visible and cheap to refund, which is exactly the pricing promise the market
  asked for.

Positioning sentence, one line:

> Your monthly report, built from your own logged-in dashboards. You pay when it is
> delivered and verified — not when the agent tries.

## The two-week test, with kill criteria

Week 1 — do it by hand, with the tool as an assistant:

1. Find three agencies or small businesses that send a monthly report to clients.
2. Do one report each, live, on their machine or with their screen shared.
3. Measure: minutes for a human, minutes for us, defects found by the client, and whether
   they ask for the next month.

Week 2 — automate the steps that repeated:

1. Turn the repeated path into one job card over the existing primitives.
2. Run it for the same three clients, unattended.
3. Compare: time, defect rate, cost per report.

**Kill criteria, decided now so the result cannot be rationalised later:**

- If no client will pay Rp 300k per report after seeing one, the wedge is wrong.
- If a human takes under 45 minutes, the saving is too small to sell.
- If defect rate is above 1 in 5, the proof layer is not good enough to promise success.
- If two of three clients do not ask for month two, stop and pick another candidate.

## What to build only after that

- Success-only billing, backed by the proof fields (this is the pricing moat).
- A job card format: input, steps, verification, artifact.
- Audit log per run, because the buyer is handing over a logged-in session.

## What not to do

- **Do not sell browser access.** It is $0.02 an hour and falling.
- **Do not build credential storage.** That is the machine we do not need, and the
  liability we should not carry.
- **Do not launch a self-serve chat first.** The first ten users must be talked to, not
  acquired.
- **Do not trust a landing page test.** A click is not a payment.

## Open evidence gaps

1. Indonesian willingness to pay for report automation `[UNVERIFIED]`.
2. Whether agencies will hand over a logged-in session, or insist on screen-sharing.
3. The real defect rate of a report assembled by the current primitives. Unknown until run.
4. Whether browser-native agents (Claude in Chrome, Gemini in Chrome, Comet) make a
   separate extension unnecessary. The defence is cross-agent neutrality plus audit; it is
   not yet proven.

## Sources

- Browser Use pricing and task landscape: https://browser-use.com/pricing ,
  https://browser-use.com/showcase/landscape
- Browserbase pricing and stated verticals: https://www.browserbase.com/pricing
- Hacker News, Notte launch thread (credit pricing complaints):
  https://news.ycombinator.com/item?id=44827216
- Hacker News, browser-agent thread index (demand signal):
  https://hn.algolia.com/api/v1/search?query=browser%20agent&tags=story
