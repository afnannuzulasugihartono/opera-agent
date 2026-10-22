# @last-edited: 2026-10-22 UTC+7.
# @title: pull_request_template — what a reviewer needs from a change, before reading the diff.
# @state: the shape every pull request carries.
# @dependencies: none stated.

## What this change does

One paragraph, in prose. What moves, and for which person or case.

## The measurement

The number before and the number after, and how it was taken. If there is no
measurement, say what was driven instead and what it showed.

## The failure it prevents

The bug, the drift, or the slop this change stops. A reviewer reads this to know
what the code is for.

## What is still unverified

Anything a claim rests on that has not been driven. An unproven path is named as
unproven here rather than left for the next reader to assume.

## The gates

- [ ] `npm test`
- [ ] `npm run check`
- [ ] `py tests/browser_extension_test.py`, when the extension does something in a page

A gate that fails is fixed in this change, or the gate is changed deliberately
and the reason is in the commit.

## The pins

If the change moves bytes that `gates.lock` or `tests/helpers/boundary-locks.mjs`
freezes, the pin moves with it and the commit says why the criterion it
enforces did or did not change.
