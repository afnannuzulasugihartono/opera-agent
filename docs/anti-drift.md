@last-edited: 2026-10-10 UTC+7.
@related: [`AGENTS.md`](../AGENTS.md) - [`README.md`](../README.md) - [`handoff.md`](handoff.md)

# Anti-slop and anti-drift

How this repository keeps an automated agent from quietly making it worse, and — just as
importantly — where that defence stops and a human has to take over.

## The problem, stated honestly

An agent that can edit code can usually edit the code that checks the code. Give it a
task, and the cheapest way to "make the tests pass" is often to change the test. Every
quality gate in a repository is therefore only as strong as the authority behind it, and
most projects quietly pretend otherwise.

This repository does not pretend. It has two layers, and only the first is code.

## Layer 1 — make tampering loud

[`gates.lock`](../gates.lock) pins the git-blob SHA1 of every file that *defines an
acceptance criterion*: the test suite's structural rules, the byte-pins in
`boundary-locks.mjs`, the primitive allowlist, the CORS resolver, the credential check, the
secret-scanner config, and the CI workflow itself.

`npm run check` verifies those pins **before it evaluates anything else**, so a check that
was weakened cannot report its own success. `npm run gates:refresh` is the only thing that
re-pins, and it refuses to run from inside the gate.

What this buys, precisely: it does not *prevent* an edit. It converts a silent one into a
loud one that names the file, forces the admission into the diff, and cannot be done by
accident. Tampering with `tests/structure-gates.test.mjs` fails the gate on the next run —
verified, not assumed.

Re-pinning is deliberately uncomfortable: the pin carries no reason of its own, so whoever
re-pins must write in the commit why the criterion did or did not change.

### What Layer 1 cannot do

`scripts/gates.mjs` verifies `gates.lock`, and it is deliberately **not** listed inside it.
A verifier cannot pin its own hash — writing the hash changes it — so listing itself would
need an exemption, and an exemption is exactly the hole the file exists to close. That is
the soft spot, and it is written down in `gates.lock` rather than left for someone to find.

## Layer 2 — the part that actually holds

[`.github/CODEOWNERS`](../.github/CODEOWNERS) names the gate paths, the verifier, and the
release paths, and branch protection on `main` makes them owner-approvable only.

This is the root of trust. An agent cannot grant itself review rights, and no hash written
anywhere in this repository can take that authority away. **If you want one control that an
AI genuinely cannot edit, it is this setting — not `gates.lock`.**

## The rest of the floor

These predate this file and still carry most of the weight:

| Gate | Catches |
| --- | --- |
| `npm test` | behaviour, including contracts exercised end to end |
| `tests/structure-gates.test.mjs` | `extension/lib` reaching for `chrome.*`, worker files with no reason to exist |
| `tests/hygiene.test.mjs` | dead exports, dead files, comment spacing |
| `tests/boundary-locks.test.mjs` | a public contract changing without a re-pin |
| `tests/konsol-tables.test.mjs` | SQL policy drift, string for string |
| `scripts/check.mjs` | version drift, forbidden runtime constructs, generated-file drift |
| `gitleaks` | committed credentials |
| `py tests/browser_extension_test.py` | anything the extension does inside a real page |

The principle each one follows: **the signal must be more reliable than the thing it
checks.** A compiler and a test qualify. An agent grading its own work does not.

## The honest limits

- **No gate can detect slop.** There is no reliable scanner for AI-generated code, and
  there never will be — bad code is a verdict of domain expertise, not a computable
  property. A gate checks structure, not judgement.
- **A green suite is necessary, not sufficient.** It proves nothing contradicts the spec.
  It cannot prove the spec is what you wanted.
- **The gate can still be routed around** by editing the lock and the gate in one commit.
  That is precisely what Layer 2 exists to catch, and why `tests/` and `scripts/` are
  named explicitly in `CODEOWNERS` rather than left to the catch-all.
- **Provenance is not yet recorded.** Nothing marks which lines an agent wrote. The
  strongest available answer is the review conversation itself: a change nobody can explain
  is a change nobody should approve.