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
deliveries (the manifest)  ->  priced lines (the price list)  ->  an invoice
                                                                  |
                                        the customer opens a signed link, sees the lines,
                                        the amount and the way to pay
                                                                  |
                                        the provider's signed notification  ->  paid
```

- `supabase/migrations/20261015090000_opera_billing.sql` — `opera_price_list` (what a
  kind of delivery is worth) and `opera_invoices` (one per customer per month, with
  the priced lines inside). The tables are readable by the server only: a customer
  reaches their invoice through a signed link, not through the table.
- `supabase/functions/_shared/billing.js` — the rules, and nothing else: the amount of
  an invoice, the invoice token, the provider's signature check, and the rule that only
  a settled transaction is a payment.
- `supabase/functions/opera-agent-billing/index.ts` — the function: it opens an
  invoice, serves the invoice page, and closes the invoice from a signed notification.
- `tests/billing.test.mjs` — the money rules, proved.

## What the owner sets (three environment values)

| Value | What it is | Without it |
|---|---|---|
| `BILLING_SECRET` | the key that signs invoice links | no invoice can be opened; the function refuses |
| `OPERA_BILLING_TOKEN` | the operator's token for opening invoices | nobody can open an invoice |
| `MIDTRANS_SERVER_KEY` | the payment provider's server key | invoices are created and served, but the pay button is replaced by a transfer instruction, and no notification is believed |

The provider is one column on the invoice (`provider`), and the signature check is
written against the provider's documented rule, so swapping providers is a row and a
function, not a rewrite. The seeds are a pilot: the first month is free, and the price
that follows is an anchor until three customers have paid it.

## What is not decided

- The price itself: 500,000 cents per delivered client-month is the anchor the
  outreach sheet names, not a price anyone has agreed to.
- Whether a customer is billed per client or per statement. The unit today is the
  client-month, because that is what a bookkeeper's own price list looks like.
- Whether the provider is Midtrans, Xendit, Stripe, or a transfer. The seam is built;
  the choice is the owner's.
