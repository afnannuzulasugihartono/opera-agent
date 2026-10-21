@last-edited: 2026-10-21 UTC+7.
@related: [monetization](monetization.md) - [statement job](../jobs/statements.md) - [handoff](../handoff.md)

# The money: how somebody pays for this

## What is sold

One **delivered client-month**: one client's statement for one month, on the client's
own disk, with a line of proof. The month that was not delivered is not charged, and
the proof that says so is the same object the manifest holds.

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
| **Small fees matter** | Fixed processing fees (0.30-0.60) dominate small invoices | The seeded price is 500,000 cents (Rp 5.000) per client-month, so a fee is noise; the provider is a row, not a hard-wired choice |
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
the provider's signed notification  ->  paid (terminal; a later call cannot reopen it)
```

- `supabase/migrations/20261015090000_opera_billing.sql` — `opera_price_list` (what a
  kind of delivery is worth) and `opera_invoices` (one per customer per month, with
  the priced lines inside). The tables are readable by the server only: a customer
  reaches their invoice through a signed link, not through the table.
- `supabase/functions/_shared/billing.js` — the rules, and nothing else: the amount of
  an invoice, the manifest rows turned into lines, the invoice token, the provider's
  signature check, and the rule that only a settled transaction is a payment.
- `supabase/functions/opera-agent-billing/index.ts` — the function: it opens an
  invoice, serves the invoice page, and closes the invoice from a signed notification.
- `supabase/functions/opera-agent-mcp/tools.ts` — the `invoice_create` tool, so the
  agent that delivered the statements can hand the operator the bill for them.
- `tests/billing.test.mjs` — the money rules, proved (12 tests).

## Measured live, in production

The whole path was driven against the deployed functions, not simulated:

| What was driven | What came back |
|---|---|
| `invoice_create` through the MCP protocol, two manifest rows | invoice `Toko Sinar Jaya:2026-08`, two lines, **1,000,000 cents**, link returned |
| the link, opened as the customer | HTTP 200, both deliveries listed at Rp 5.000 each, **Total Rp 10.000** |
| a link with a wrong token | **401** `that link does not open that invoice.` |
| the same client-month twice | refused: `Toko Sinar Jaya 2026-06 is in the list twice; one client-month is one line` |
| a row with no client | refused by the tool schema before any write |
| a signed notification for 1,000 instead of 500,000 | **400** `the paid amount (1000) is not the invoice amount (500000)` |
| a signed notification with status `pending` | **400** `the transaction is not settled` |
| a signed `settlement` notification for the right amount | **200** `{"ok":true}`; the page then says `status paid` and `Paid. Thank you.` |
| the same notification replayed after the provider key was removed | **400** `the notification was not signed by the provider` |
| re-creating a paid invoice | refused: `... is paid; a later call does not reopen an invoice that has been paid.` |

Two lessons are now tests instead of comments. The first deploy created invoices and
then answered `Buffer is not defined` to every customer who opened one, because the
edge runtime has no Node `Buffer`; the comparison is now character by character and
a test deletes `globalThis.Buffer` to prove the rules still run. Midtrans spells a
settled transfer `settlement`, not `settled`, so the settled rule accepts the
provider's spellings and refuses a card capture under `challenge`.

## What the owner sets (three environment values)

| Value | What it is | Without it |
|---|---|---|
| `BILLING_SECRET` | the key that signs invoice links | no invoice can be opened; the function refuses |
| `OPERA_BILLING_TOKEN` | the operator's token for opening invoices | the `invoice_create` tool refuses |
| `MIDTRANS_SERVER_KEY` | the payment provider's server key | invoices are created and served, but the pay button is replaced by a transfer instruction, and no notification is believed |

The first two are set in the project's secrets already; the third is not, because
there is no provider account yet. The provider is one column on the invoice
(`provider`), and the signature check follows the provider's documented rule, so
swapping providers is a row and a function, not a rewrite. A provider's webhook URL
is the function itself: it recognises a notification by the order id and signature
it carries, not by a field the provider never sends.

## What is not decided

- The price itself: 500,000 cents per delivered client-month is the anchor the
  outreach sheet names, not a price anyone has agreed to.
- Whether a customer is billed per client or per statement. The unit today is the
  client-month, because that is what a bookkeeper's own price list looks like.
- Whether the provider is Midtrans, Xendit, Stripe, or a transfer. The seam is built
  and drilled with a signed test notification; the choice is the owner's.
