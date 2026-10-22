@last-edited: 2026-10-22 UTC+7.
@related: [`AGENTS.md`](AGENTS.md) - [`README.md`](README.md) - [`docs/handoff.md`](docs/handoff.md)

# Contributing

The rules that bind a change live in [`AGENTS.md`](AGENTS.md) and nowhere else. This
file answers a different question: what a change has to look like when it arrives
here, and how a reviewer reads it.

## Before you start

Read [`AGENTS.md`](AGENTS.md). It is short, and every line of it binds the work.
Then read [`docs/handoff.md`](docs/handoff.md) for what is true right now and what
is next, so the change lands on the state of the tree rather than on a memory of it.

## The shape of a change

- One concern per pull request. A change that does two things is two changes, and
  the reviewer reads them one at a time.
- Short-lived branches off the current stack, named for what they carry.
- The commit message says what moved and why, in prose, and it is read before the
  diff. It is not a subject line.
- Every change ends with a fresh run against the artefact, not a restated
  intention. The runs are `npm test`, `npm run check`, and
  `py tests/browser_extension_test.py` for anything the extension does inside a page.

## What a reviewer needs

- The measurement, not the claim: the number before and the number after, and how
  it was taken.
- The failure it prevents, named in the commit, so the next person knows what the
  code is for.
- What is still unverified, stated plainly. An unproven path is named as unproven
  rather than left for someone to assume.

## The gates

Three run on every pull request, on Linux, with the browser harness under a
virtual display:

| Gate | What it proves |
| --- | --- |
| `npm test` | the fast suite, the contract, and the format of every file |
| `npm run check` | the version, the primitive allowlist, and the runtime safety scan |
| `py tests/browser_extension_test.py` | what the extension does inside a real page |

A gate that fails is fixed in the same change, or the gate is changed deliberately
and the reason is in the commit. A gate is never weakened to let a change through.

The acceptance surface is pinned in [`gates.lock`](gates.lock). A change that
moves those bytes re-pins them in the same commit and says why the criterion
they enforce did or did not change.

## Where things are

| Question | Answer |
| --- | --- |
| What are the rules? | [`AGENTS.md`](AGENTS.md) |
| What is true now, and what is next? | [`docs/handoff.md`](docs/handoff.md) |
| What may I do with a credential? | [`docs/security.md`](docs/security.md) |
| What primitives may the extension expose? | [`docs/api.md`](docs/api.md) |
| How does this repo resist slop and drift? | [`docs/anti-drift.md`](docs/anti-drift.md) |
| What did a release contain? | [`docs/releases/`](docs/releases/) |

## Reporting a vulnerability

Not as an issue. [`docs/security.md`](docs/security.md) has the private route and
what to include.
