# What people actually try, and pay for

Research note, 2026-10-20, revised 2026-10-21 after reading the forums. Companion to
`agent-surface.md`. That one asked how an agent chooses a tool; this one asks what a person
chooses to try, and what they already pay someone to do.

## Method

- DuckDuckGo HTML and Lite endpoints, because the configured search tool returned nothing.
- Reddit archive API (PullPush) for threads and comments, because reddit.com itself answers 403.
- Competitor pricing pages, fetched directly.
- Quora returns 403 behind a challenge; X and Threads need a login to read threads. **No
  evidence in this note comes from X, Threads or Quora**, and none is invented to fill the gap.

Limits: competitor telemetry is marketing, Reddit is self-selected, and Indonesian demand is
inferred from what is *sold*, not from what is discussed.

## What the work actually is

Browser Use publishes the distribution of its 30 task kinds:

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

Nearly a fifth of all browser-agent work is a login wall, and the industry's answer is
credential vaults, MFA handling, captcha solving, residential proxies and "digital personas" —
Notte advertises all five. That is a large, fragile machine built to *become* someone else.

Our browser is already logged in. No vault, no captcha, no persona. That is a structural cost
and risk advantage, not a feature.

## What buyers complain about

From the Notte launch thread (Hacker News, 2025-08), the loudest complaint was not speed:

> "Credit based pricing is broken. No way u produce sh*t then user get out of credit to get
> nothing done."

> "you pay credits and you get 'stuff' that 'might work'."

The founder conceded and promised the fix:

> "We're working on fail-credit refunds so charges only apply to successful runs."

The market has asked for success-only pricing. Nobody delivers it cleanly, because nobody can
prove success. `settled`, `covered` and `placed` are that proof.

## What the forums said, in their words

**1. Pulling statements from portals is a chore, done by professionals, every month.**

> "I've been growing my book of clients and one of the pain points is pulling the bank
> statements. From the start, getting access to their bank is a pain to try and explain the
> process. From there, the manual process of logging in and downloading the statements is a
> chore."
> — r/Bookkeeping, "How to avoid pulling bank statements?"
> https://www.reddit.com/r/Bookkeeping/comments/1bniiz4/

> "It finding it is very tedious having to go to my various banks' website every month and
> search out the PDF statements to download."
> — r/personalfinance
> https://www.reddit.com/r/personalfinance/comments/179amov/

**2. These professionals already keep the logins. The login is their workflow.**

> "I require a login from all my clients. It's a part of my process that has made life much
> easier."
> — r/Bookkeeping, same thread

> "I consider this to be routine, and I far prefer having account access than asking clients to
> provide."

That is the single most useful finding in this note. Our model — drive the session the user
already has — is not a workaround for a security problem. It is **what bookkeepers already do
by hand**, formalised.

**3. They reject services that store credentials.**

> "This sub isn't for farming info for your lame little scripts. None of these clients want to
> connect their bank accounts to your service. These already exist. Stop."

Every competitor in this space asks for the credential or the connection. We are the only
shape that answers this objection with architecture: the password never leaves the browser,
and there is no server that could hold it.

**4. Agencies are already served, and do not need us.** From r/agency "Too Many Client
Reports":

> "You gotta automate reports. If you're data is making it into BI dashboards you can automate
> report generation and sending with Rollstack."

> "I use Make.com & keep a Google Sheet updated... Still, it takes me ~30 min to edit an email."

Rollstack starts at **$833/month** billed yearly. The reporting wedge is real money, already
automated through APIs, and our browser advantage adds nothing there. I withdraw it as the
first product.

**5. Consumers do not have the pain we imagined.** In the same r/personalfinance thread the
majority say they never download statements at all. Consumer export is a bad first market.

## What Indonesia already pays for

The local market is small-ticket but real, and it is priced per unit of work:

| Seller | Offer | Price |
|---|---|---|
| Fastwork | jasa input / entri data | from Rp 50.000 |
| Sribu | jasa input data | from Rp 99.000, 1 day |
| Jasaketikin | input data Excel/website | Rp 150–500 **per cell**, by turnaround |
| Desainpromosi, Sketsaemas, PAKAR | jasa admin marketplace | monthly retainer |
| Shopee sellers | "Price List Jasa Input Data & Laporan Keuangan" | listed publicly |

Two readings, both true:

- Willingness to pay exists, but it is anchored at tens of thousands of rupiah per job. A
  product priced per job in that market is a freelancer, not a company.
- **The people selling those services are the best first buyers.** They already have the
  volume, the pain, and the client list; they would buy a tool that halves their hours. They
  are reachable on the same marketplaces where they advertise.

## Revised shortlist

| Candidate | Verdict |
|---|---|
| **Pulling client statements and documents from bank and vendor portals** | **First product.** Professional buyer, monthly, login-walled, already paid in hours, and hostile to credential storage — which is our shape |
| Marketplace seller/admin ops | Second. Reachable, but anchored at Rp 50–99k per job and exposed to marketplace terms |
| Agency reporting | Withdrawn. Already automated by BI and Rollstack |
| Consumer data export | Withdrawn. The pain is not there |
| Job applications | Rejected. Ethics and spam |
| Insurance/claims portals | Real money, unreachable without a US sales motion |

## The product, one sentence

> **Every client's statement, downloaded and filed from your own browser — and not one
> password stored anywhere.**

Concretely: for each client and period, open the portal, use the session already in the
browser, download the statement, name it `client-bank-period.pdf`, file it, and return a
manifest with proof: file exists, size, page count, period read from the page, and the
statement's own closing balance.

## The gap between that sentence and the code, and how it closed

There was **no download primitive**. Twenty-nine tools, none of them saved a file. The
extension already held the `debugger` permission, so the fix was one generic primitive:

- arm the folder with `Browser.setDownloadBehavior`,
- click the control the caller named,
- read the directory until a new file stops growing,
- return `{ path, bytes, file }` or a named failure.

It was written on 2026-10-21 and measured live against the signed-in Chrome, served by a
local HTTP server: `statement-2026-09.pdf`, 69 bytes, **462 ms**, `clicked.covered:false`.
A link that navigated instead of downloading answered `downloaded:false` in 3060 ms with
the URL it went to. The event-based version was rejected on purpose: the extension bridge
forwards commands and not CDP events, so it would pass on a debugging port and hang on the
profile that matters.

Generic, no site knowledge, and it unlocks invoices, exports and reports for every later
job. It is pull request #89.

## Two-week test, kill criteria fixed in advance

Week 1:

1. Find three bookkeepers or accounting-service owners who pull statements by hand. Sources:
   r/Bookkeeping and r/taxpros (read the rules; answer the existing thread, do not advertise),
   Indonesian "jasa pembukuan" groups, and Fastwork/Sribu sellers of data-entry services.
2. Ask for one client-month, live, on their machine. Record minutes, mistakes, and whether the
   file names match their own convention.
3. Give the result free. Ask only: "would you run this next month?"

Week 2:

1. Build `download`, then the job card over the existing primitives.
2. Run the same three clients unattended.
3. Compare minutes, defects, and cost per client-month.

**Kill criteria:**

- No bookkeeper lets the tool run on their machine after a ten-minute demo → the trust story is
  wrong, stop.
- Saving under ten minutes per client-month → the job is too small to sell.
- More than one wrong file in twenty (wrong period, wrong client, empty PDF) → the proof layer
  is not good enough to promise success.
- Nobody asks for month two → stop and take the second candidate.

## Pricing hypothesis, to be tested not assumed

Per client-month, with the first month free: **Rp 20.000 per client-month**, or
**Rp 500.000/month up to 30 clients**. Free if a statement fails to arrive. The number is a
hypothesis; the kill test is whether anyone renews without being asked.

## What not to do

- Do not sell browser access. It is $0.02 an hour and falling.
- Do not build credential storage. It is the machine we do not need and the liability we should
  not carry — and the forums show buyers refuse it.
- Do not launch a self-serve chat. The first ten users are talked to, not acquired.
- Do not treat a landing-page click as demand. Only a renewal is demand.

## Sources

- Browser Use pricing and task landscape: https://browser-use.com/pricing ,
  https://browser-use.com/showcase/landscape
- Browserbase pricing: https://www.browserbase.com/pricing
- Hacker News, Notte launch thread: https://news.ycombinator.com/item?id=44827216
- r/Bookkeeping, pulling bank statements: https://www.reddit.com/r/Bookkeeping/comments/1bniiz4/
- r/personalfinance, downloading statements: https://www.reddit.com/r/personalfinance/comments/179amov/
- r/agency, too many client reports: https://www.reddit.com/r/agency/comments/1d77l2o/
- Rollstack pricing: https://www.rollstack.com/pricing
- Indonesian service prices: https://fastwork.id/data-entry ,
  https://www.sribu.com/id/entry-data/website , https://jasaketikin.com/jasa-input-data/
