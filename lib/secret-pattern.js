// @last-edited: 2026-10-10 UTC+7.
// @title: secret-pattern — the one credential-shape check the server refuses to accept.
// @state: one declaration, reached by nine modules that each carried their own copy of the literal.
// @dependencies: none.

// WHY one declaration and not nine: this is a security control, and a control
// held in nine copies is a control that weakens the moment somebody edits one
// copy and the other eight keep answering with the old shape. Every module that
// refuses a secret-like value now asks this file, so the set of shapes the server
// refuses is one readable list instead of a grep across the tree.

// WHY the shape is unchanged: this literal is byte-identical to the one the nine
// modules carried before, so no caller changes behaviour by importing it. What
// changes is that the next edit has exactly one place to happen.

// WHY the edge modules import across into lib/: supabase/functions/_shared/
// proof-engine.js already reaches lib/canonical-order.js the same way, so this
// follows an established path rather than opening a new one.

// WHY scripts/check.mjs asserts it: a tenth copy is the failure this file exists
// to prevent, so the gate fails if any other runtime file declares the pattern
// itself rather than importing it here.

export const SECRET_VALUE = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}|\bsk-[A-Za-z0-9_-]{20,})/;