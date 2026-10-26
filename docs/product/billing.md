@last-edited: 2026-10-26 UTC+7.
@related: [monetization](monetization.md) - [statement job](../jobs/statements.md) - [handoff](../handoff.md)

# The money: how somebody pays for this

## What is sold

A **firm-month**: up to 15 client-months for Rp 99.000, or up to 50 for Rp 249.000,
with each client-month above the cap at Rp 10.000. A client-month is one client, one
portal, one month. The month that was not delivered is not charged; the invoice is
issued only after the firm accepts the first batch, and the proof is the manifest row.

## What makes people actually pay

The search for this turned up vendor pages rather than research, so the claims below
are marked for what they are. What they agree on is worth more than a study would
be, because every one of them is a company that gets paid this way.

| What buyers say they pay for | Where it shows | What we do about it |
|---|---|---|
| **A flat monthly fee, not an hourly one** | Outsourced bookkeeping is sold as a flat monthly fee nearly everywhere; hourly is what people buy when nobody can say what they will get | The unit is a client-month: a known number per client per month, billed monthly |
| **Only pay for what you use** | "You can only use the service you need, so you don't have to pay for services you don't" | An account with no delivered client-months is billed nothing. The price list is per kind, so a new kind is a new row, not a new plan |
| **A way to pay in one click** | "Every invoice includes a payment link, so clients pay in one click" | The invoice is a page with the amount and a pay button; the link carries its own authority, so it keeps working after a redeploy |
| **An invoice you can check** | Invoicing guides insist the invoice names the work, the terms and the amount | The invoice lists every delivery it charges for, line by line, and says which month each line is for |
| **Being chased, kindly** | Late payment is normal: 24-31% of invoices paid late (vendor platform data, 2026) | An open invoice is a query the operator can run; the amount is recomputed from the deliveries, never from memory |
| **Small fees matter** | Fixed processing fees (0.30-0.60) dominate small invoices | The pilot is Rp 99.000 and the firm plan Rp 249.000, so a fixed fee is small; below Rp 100.000 the checkout offers QRIS only, because a Rp 4.000 virtual-account fee is 4% of a Rp 99.000 bill |
| **Trust before money** | "Trusted partner", "we'll clearly point it out" | The proof names what failed too: a delivery that was not made is not on the invoice, and the balance says where it was read from |

The honest summary: **nobody pays for a browser agent.** They pay for a month of
their client's statements being done, without them downloading anything, and for
knowing it happened. The agent is how that is delivered, and it must stay invisible
in the invoice.

## How the money moves

```
delivered client-months (the manifest on the device)
        |
        |  invoice_create: the manifest rows, not a typed number
        v
priced lines (the price list)  ->  an invoice (one per customer per month)
        |
        |  the customer opens the signed link: the lines, the amount, the way to pay
        v
        +--> the provider's signed notification  ->  paid (terminal)
        |         a signature that does not match asks the provider what it recorded
        |
        +--> a transfer recorded by the operator ->  paid (terminal)
```

- A transfer is recorded by `settle-manual`: the operator token, the exact amount, and
  a note naming who confirmed it. It writes the same terminal paid state as the
  provider, and the invoice page shows the note and the time.
- `supabase/migrations/20261015090000_opera_billing.sql` — `opera_price_list` (what a
  kind of delivery is worth) and `opera_invoices` (one per customer per month, with
  the priced lines inside). `20261021120000_opera_provider_order_id.sql` adds the
  provider's own order id, because the readable invoice id has characters Midtrans
  refuses. `20261022090639_opera_price_decision.sql` sets the plan and overage prices.
  `20261026082000_opera_notification_log.sql` records every notification that reaches
  the function and what it did with it. The tables are readable by the server only: a
  customer reaches their invoice through a signed link, not through the table.
- `supabase/functions/_shared/billing.js` — the rules, and nothing else: the amount of
  an invoice, the plan line and its overage, the manifest rows turned into lines, the
  invoice token, the provider's signature check and the readings of the stored key,
  the provider status request, the rule that only a settled transaction is a payment,
  the rule that a paid invoice is not paid again, the legal provider order id, and the
  QRIS-only rule for small invoices.
- `supabase/functions/opera-agent-billing/index.ts` — the function: it opens an
  invoice, serves the invoice page, closes it from a signed notification or from the
  provider's own answer when the signature does not match, writes every notification
  down, and records a transfer with the operator's note.
- `supabase/functions/opera-agent-mcp/tools.ts` — the `invoice_create` tool, so the
  agent that delivered the statements can hand the operator the bill for them. It is
  the one door for both kinds of bill: pass the deliveries for a per-delivery invoice,
  or pass the same deliveries with `plan` (`plan.pilot` or `plan.firm`) for a plan
  month. There is no second path for an operator to learn.
- `tests/billing.test.mjs` — the money rules, proved (39 tests).

## Measured live, in production

The whole path was driven against the deployed functions, not simulated:

| What was driven | What came back |
|---|---|
| `invoice_create` through the MCP protocol, two manifest rows | invoice `Toko Sinar Jaya:2026-08`, two lines, **1,000,000 cents**, link returned |
| the link, opened as the customer | HTTP 200, both deliveries listed at Rp 5.000 each, **Total Rp 10.000** |
| a link with a wrong token | **401** `that link does not open that invoice.` |
| the same client-month twice | refused: `Toko Sinar Jaya 2026-06 is in the list twice; one client-month is one line` |
| a row with no client | refused by the tool schema before any write |
| a signed notification for Rp 500.000 on a Rp 5.000 invoice (the 100× unit bug) | **400** `the paid amount (500000.00) is not the invoice amount (500000 cents)` |
| a signed notification with status `pending` | **400** `the transaction is not settled` |
| a signed `settlement` for Rp 5.000, addressed to the derived provider order id `oa-de91a14853-Toko-Sinar-Jaya-2026-09`, not the invoice id | **200** `{"ok":true,"invoice":"Toko Sinar Jaya:2026-09"}`; the page then says `status paid` |
| re-creating that paid invoice | **409** `... is paid; a later call does not reopen an invoice that has been paid.` |
| the same notification replayed after the provider key was removed | **400** `the notification was not signed by the provider` |
| `settle-manual` with no operator token, after the 2026-10-22 deploy | **401** `the operator token is missing or wrong` |
| the price list after the price decision (read with SQL) | `plan.pilot` 9,900,000 cents; `plan.firm` 24,900,000; overage 1,000,000 |
| a real QRIS payment of Rp 99.000 in the sandbox, driven through the provider's simulator | provider `settlement`; invoice `Uji Sandbox:2027-06` **paid** 0.2 s later |
| a notification-shaped body with no signature for an order that is only `pending` | **400**; the log says `the signature did not match and the provider reports pending for that order` |
| a notification for an invoice already paid | **200** `the invoice was already paid at ...`; `paid_at` unchanged |

Three lessons are now tests instead of comments. The first deploy created invoices and
then answered `Buffer is not defined` to every customer who opened one, because the
edge runtime has no Node `Buffer`; the comparison is now character by character and
a test deletes `globalThis.Buffer` to prove the rules still run. Midtrans spells a
settled transfer `settlement`, not `settled`, so the settled rule accepts the
provider's spellings and refuses a card capture under `challenge`. And the ledger is
cents while Midtrans charges rupiah: the first version sent cents, so a Rp 5.000
invoice would have asked the customer for Rp 500.000. The conversion is now a tested
boundary in both directions, and the 100× notification is refused live.

The Snap request is proved twice: against a provider stood up in the test, and against
the real one. Driven live on 2026-10-26, a plan invoice came back with `provider`
`midtrans`, a derived order id and a `pay_url`, so Midtrans accepted the charge and
returned a checkout link.

**The money path closed on 2026-10-26, in sandbox.** A QRIS payment of Rp 99.000 was
driven through the provider's own simulator; the provider reported `PAID`, and invoice
`Uji Sandbox:2027-06` became `paid` 0.2 seconds after the notification arrived. The run
is recorded in `opera_notification_log` — `pending` then `settlement`, `user_agent
Veritrans`, `gross_amount 99000.00` — so "the provider never reached us" and "it reached
us and we refused" are now different rows instead of the same silence.

That log is what found the remaining defect. The signature stored in the project does
not sign these notifications under any of the three readings tried (as stored, trimmed,
printable ASCII), while the same key opens the charge. So a refused signature is a
question, not an ending: the function asks the provider what it recorded for that order,
over the same key, and closes the invoice only when the provider answers `settlement`
(or an accepted `capture`) for the exact amount. A forged body cannot pass, because the
provider answers about its own transaction. What is still owed is a clean re-paste of
the server key from the dashboard; until then every close is provider-confirmed, which
is the stronger of the two proofs.

Production is a different matter: the account is still under review and no real money
has moved, so a real customer payment closing a real invoice is `[UNVERIFIED]`.

The plan line is proved live as well: a plan invoice driven on 2026-10-26 came back as
one line of Rp 99.000 for two delivered client-months, which is the plan's cap doing its
job rather than two per-delivery lines. The positive manual settlement is still proved
by unit tests only: the function refuses an unauthenticated settlement, and the
operator token is not in the agent's environment. The first real transfer is the live
proof. `[UNVERIFIED]`

## What the provider charges (measured 2026-10-21)

Midtrans is **free to start, not free per sale**: signup, setup and monthly maintenance
cost nothing, and the only charge is a fee on each successful transaction. The fee
depends on the method the customer picks, and the fixed part is what matters at our
unit size. Figures below are from `midtrans.com/id/biaya` on 21 October 2026; every
fee except QRIS, GoPay and ShopeePay is quoted before VAT.

| Method | Fee | On a Rp 10.000 invoice | On a Rp 150.000 invoice |
|---|---|---|---|
| QRIS | 0,7% (VAT included) | **Rp 70** | **Rp 1.050** |
| GoPay / ShopeePay | 2% (VAT included) | Rp 200 | Rp 3.000 |
| DANA / OVO | 1,5% + VAT | Rp 150 + VAT | Rp 2.250 + VAT |
| Virtual account (BCA, BNI, BRI, Mandiri, Permata, CIMB) | Rp 4.000 + VAT | **Rp 4.000 (40%)** | Rp 4.000 (2,7%) |
| Card (Visa, Mastercard, JCB, Amex, UnionPay) | 2,9% + Rp 2.000 + VAT | **Rp 2.290 (22,9%)** | Rp 6.350 (4,2%) |
| Minimarket (Indomaret, Alfamart) | Rp 5.000 + VAT | Rp 5.000 (50%) | Rp 5.000 (3,3%) |
| Withdrawal to a bank account | Rp 5.000 per transfer | — | — |

The current prices are Rp 99.000 and Rp 249.000; the columns above are measurement
points, and the QRIS-only rule covers the pilot bill. The conclusion is a rule, not a
preference: **below Rp 100.000 the checkout offers QRIS only**. A virtual account costs
Rp 4.000 whether the invoice is Rp 99.000 or Rp 500.000, so on the pilot bill the fixed
fee is four percent of the money; QRIS is the only method with no fixed fee and every
Indonesian bank and e-wallet app can scan it.
Above the threshold a fixed fee is small enough that choice is worth more, and the
provider's own list is used. The rule lives in `snapPaymentMethods` and is tested at the
boundary. The withdrawal fee is per transfer, not per invoice, so it is paid once a
month, never once per customer.

## A client outside Indonesia

The payer is the bookkeeper, not their client, so "foreign client" means a bookkeeper
who is not in Indonesia. Midtrans can take their money, but it cannot price in their
currency: a card issued by a foreign bank is accepted (Midtrans says so explicitly), the
charge is in rupiah, and the card issuer does the conversion. Settlement is rupiah to an
Indonesian bank account, which needs an Indonesian entity (KTP; NPWP for cards).

| Path | What it costs | What it needs | Where it fails |
|---|---|---|---|
| **Midtrans card** (foreign-issued) | 2,9% + Rp 2.000 + VAT, charged in IDR | Indonesian entity, Midtrans account | cannot price or settle in USD; the payer's issuer adds its own FX |
| **Paddle** (merchant of record) | 5% + $0.50 per checkout | a software product; Indonesia is not on Paddle's unsupported-seller list; payout monthly, minimum $100, wire or Payoneer, $15 SWIFT for some countries | Paddle's AUP excludes pure human services, and $0.50 dominates an invoice below ~$20 |
| **PayPal Business Indonesia** | 4,4% + $0.30 on international commercial transactions, plus the conversion spread; withdrawal free above Rp 1.500.000, Rp 16.000 below | PayPal business account | the paid state needs IPN/webhook work; the FX spread is real |
| **Wise / bank transfer** | the lowest FX cost of the four, with no gateway percentage | an invoice with bank details | no automatic paid state until a bank feed or Wise webhook is wired |
| **Stripe Indonesia** | — | — | Stripe's own page: IDR only, bank transfer only, **no cross-border or international transactions** |

So the choice is not "Midtrans or Stripe". For a domestic customer it is Midtrans with
QRIS first. For a foreign customer the order is: Paddle if the offer is sold as software
and the invoice is at least about $20; otherwise Midtrans card (simplest, but the bill is
in rupiah) or Wise/manual for the first few clients. The price for a foreign customer
must be set in USD with a monthly minimum, not converted from Rp 99.000: at that unit the
$0.50 fixed fee alone is larger than the whole invoice.

## What the owner sets (five environment values)

| Value | What it is | Without it |
|---|---|---|
| `BILLING_SECRET` | the key that signs invoice links | no invoice can be opened; the function refuses |
| `OPERA_BILLING_TOKEN` | the operator's token for opening invoices and recording a transfer | the `invoice_create` tool and `settle-manual` refuse |
| `MIDTRANS_SERVER_KEY` | the payment provider's server key | invoices are created and served, but the pay button is replaced by a transfer instruction, and no notification is believed |
| `MIDTRANS_ENVIRONMENT` | `sandbox` or `production`: which host the charge and the status question go to | the function assumes `production`, and a sandbox key is refused by that host |
| `BILLING_BANK` | the account line printed on an unpaid invoice | the invoice says to transfer but does not name the account |

The first two are set in the project's secrets already; the provider key and the
environment are set for sandbox; the last is the owner's own account line, and the
invoice is honest without it but harder to pay. The environment is stated and never
read from the key: this merchant's sandbox and production keys both start
`Mid-server-`, so a prefix proves nothing. The provider is one column on the invoice
(`provider`), and the signature check follows the provider's documented rule, so
swapping providers is a row and a function, not a rewrite. A provider's webhook URL
is the function itself: it recognises a notification by the order id and status code
it carries, never by a field name the provider might not send.

## How a plan invoice is made

`invoice_create` takes a `plan` with the delivered rows, and it is the same door the
per-delivery invoice goes through. It prices one plan line and adds an overage line
only for the rows above the cap; a plan with no delivered row is refused. The value is
the price-list kind (`plan.pilot` or `plan.firm`), so a plan nobody priced is refused
rather than billed as zero. The command is in
[`first-three-bookkeepers.md`](first-three-bookkeepers.md#8-perintah-operator).

## What is not decided

- Whether a customer stays on `plan.pilot` or moves to `plan.firm`. The plan is a
  price, not an entitlement check; the operator chooses it from the delivered count,
  and `planInvoiceLines` refuses a plan it cannot price.
- Which provider is contracted. Midtrans is wired in rupiah (QRIS only below
  Rp 100.000, the provider's list above) and the callback is drilled with real sandbox
  payments. The account is still under business review, so no real money has moved and
  the production host is untested with a live payment.
- Multi-currency. `opera_price_list` is unique on `kind`, so it holds one price per
  kind. A USD price needs the uniqueness to become `(kind, currency)` and the invoice
  to choose the row by the customer's currency. Until then `snapPaymentMethods`
  refuses a non-rupiah invoice instead of sending dollars to a rupiah-only provider.
- The foreign price and its minimum: a USD price with a monthly minimum around $20,
  because Paddle's $0.50 fixed fee is larger than the whole Rp 99.000 pilot unit.
