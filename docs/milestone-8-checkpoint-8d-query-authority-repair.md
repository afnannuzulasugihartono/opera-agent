# Checkpoint 8D fixed Management operator query authority

2026-09-14. Test-only integration repair; overall8D IN PROGRESS, no8E.

## Exact observations

Digest-repair commit1d81e8e25da1936968cff0bdefd23c456ec568d0 received independent
exact-commit PASS and standard CI34819389218 SUCCESS. Native PostgreSQL29/29
also passed. Its bounded cloud retry still failed preflight before OAuth or
fixtures. Master was restored OFF by the enclosing finally.

Sanitized actual Management trace: functions200, secrets200, secrets200,
database/query400 with SQLSTATE42501/permission denied. No credential, secret,
request payload or raw remote error was printed. A diagnostic invocation first
failed due to Windows PowerShell native argument quote handling; corrected
single-quoted JavaScript literals yielded the trace above. Both attempts restored
master OFF; the parse failure established no application acceptance.

With masterOFF, the same fixed SELECT current_user plus operator_state under
read_only=true returned400 permission denied; false returned201, effective role
postgres, hostEnabled=false, epoch0. A separate ordinary SELECT current_user
with read_only=true returned201 and role supabase_read_only_user. This establishes
the actual query-role difference; these were observational queries only.

Official [ordinary query API](https://supabase.com/docs/reference/api/v1-run-a-query)
and [read-only query API](https://supabase.com/docs/reference/api/v1-read-only-query)
document the options; the sanitized current_user differential supplies the actual
effective-role evidence. The current primary OpenAPI schema also confirms bounded
parameters are supported. No string interpolation workaround was introduced.

## Minimal boundary repair

All fixed private operator queries now pin Management read_only=false. Removed
the misleading readOnly option and its call sites. Every SQL definition and
parameter expression is preserved, as are project/function/pin, ownership,
epoch checks, deadlines, cleanup and redaction. The operator credential remains
in its separate trusted realm and memory only. No arbitrary query input, dynamic
privilege retry/fallback, grant or new principal was introduced.

SELECT text alone does not imply no effects: trusted functions can lock or write.
Safety rests on the closed reviewed statement/function set. Restricted client
and read-only roles retain their denial; ordinary authority is already the
operator's authority for fenced writes, not new agent authority.

Tests first: realistic restricted-role42501 double exposed6 failures/13tests
against the old helper. After repair focused backend/controller/operator/live
43/43 PASS, zero skips, Deno/static and whitespace PASS. Independent reviewer
independent_8d_gate reran43/43 and static/diff, compared every unchanged SQL and
parameter expression, and returned PASS on the implementation delta. Reviewed
backend SHA25647e011c0c61c6034f8df808e23ce788a390cf88997d42d10ab1316f5b137c1d4;
tests SHA2563c02f360a5daca4f439da67cc8a03371699d77c0c60fa1cfdaaf3dca553c3834.
Full default suite316/316 PASS, zero skips. Freeze commit/CI binding before
enabled retry; no overall8D acceptance claimed.

No production grants, schema, Edge/lib source, bundle pin, extension, publicMCP,
OAuth configuration, signing or pairing changed. No OAuth or fixture has run.

## Next

Verify exact-head CI, bind review to that committed
candidate, then retry the already authorized bounded manual-PKCE controller.
Remaining durability/concurrency/nonce/minute/retention and authorization evidence
still need explicit final mapping and independent8D acceptance before8E.
