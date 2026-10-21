// @last-edited: 2026-10-21 UTC+7.
// @title: monetization — what a delivery is worth, to whom, and what an agent hands over.
// @state: the offer shape, the billing unit, the metering shape, and the three decisions still open.
// @dependencies: none.

// WHY THIS DOCUMENT EXISTS
//
// A tool is not bought; a result is. The question that decides whether this earns
// anything is not "what does the browser driver cost" but "what is a delivered client
// month worth to a bookkeeper, and what may an agent that uses this hand to its own
// user". Both answers change what gets built next, and both were being answered in
// chat.
//
// The answers below are the ones this tree can already support. The ones it cannot
// are named as open, with what would settle them, because a price guessed in advance
// is a promise made on no evidence.

## The offer

One client, one portal, one month: a file with the right name, and a line of proof.

- The file: `nama-klien-bank-2026-09.pdf`, in a folder the person already knows.
- The proof: bytes, the kind of file sniffed from its own bytes, the page count, and
  the closing balance exactly as the portal printed it, with the page named as its
  source.
- The manifest: one line per client-month, refused twice for the same month.

The unit of billing is the **delivered client-month**, and it is free when the
delivery fails. That is the whole promise: a month that is not delivered is not
charged, and the proof is the reason the charge is defensible.

## What the proof object is for

The proof is not a log line. It is an object another agent can hand to its own user
and be believed, so it is frozen: [`tests/fixtures/statement-proof-v1.json`](../tests/fixtures/statement-proof-v1.json)
names every field and its type, and `tests/statement-proof.test.mjs` fails when the
record drifts from it.

What it deliberately does **not** claim: that the balance inside the PDF equals the
balance on the page. Reading text out of a compressed PDF needs a parser, and a
manifest that pretends to have checked is worse than one that says where the number
came from.

## What a third-party agent would pay for

An agent that drives this for its own users needs three things, and none of them is a
tool call:

1. **A task, not a verb.** "Deliver this client's statement for this month" has to be
   one operation with one answer, so the agent does not have to learn the loop. The
   statement job is that operation on the local surface; on the cloud surface it does
   not exist yet.
2. **A metered unit.** A price list an agent can budget against: per delivered
   client-month for a bookkeeper, and per task or per page for an agent that resells
   the work. The metering shape is the same either way - a proof object carries what
   was done, and the counter is what was delivered.
3. **A trust boundary the agent can explain to its user.** No password, no session
   cookie leaves the browser, no file is uploaded anywhere. The deliverable is a file
   and a manifest on the user's own disk.

## What makes another agent choose this over plain browser automation

- The session is the user's own: already signed in, no second login, no captcha, no
  rented browser.
- The evidence is a file on disk and a manifest, which is what a bookkeeper hands to a
  client - not a screenshot.
- The cost per delivery is small: 6,997 characters and about 1.2 seconds of tool time
  for one client-month.
- Failure is named: a cause and the next move, never a silent "ok".

## The three decisions still open

1. **The price.** Undecided, and it should stay undecided until a delivery happens.
   The anchor in the outreach sheet is Rp 5.000 per client-month for Indonesia and
   US$1.50 for the English market; those are anchors, not prices.
2. **Unattended delivery.** Today the job needs an operator on the call, which makes
   this a service with a ceiling of hours. For it to be income, the statement job has
   to run on the client's own machine without a person watching - the extension and
   the cloud bridge path - and leave the file and the manifest there. Acceptance:
   the client runs one command, the manifest gains a row, and nobody is on a call.
3. **Whether the cloud surface grows the job.** The 31 cloud tools have no `download`
   and no statement calls, so an agent on rented infrastructure cannot deliver a file
   to the user's disk today. Either the job moves to the device, or the cloud surface
   grows a delivery call. The first is smaller and keeps the data on the machine.

## What would settle the price

Three bookkeepers, one client each, one month, free. Then the only number that
matters is the one they answer: would you pay this for next month, and would you pay
it per client or per month.
