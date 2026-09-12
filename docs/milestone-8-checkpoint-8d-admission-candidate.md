# Checkpoint 8D local admission candidate

Date: 2026-09-13. Baseline: `13525710db304e6a134159eb97c37309b908f057`.

Status: **local candidate only; 8D remains IN PROGRESS, not ACCEPTED**.
No 8E work, production mutation, deployment, or browser dispatch occurred.

## Implemented boundary

`lib/transaction-admission-8d.js` is an isolated library with six trusted
server-installed adapters. Requests cannot supply identity, policy, grant,
adapter code, or executor authority. Absent policy fails closed; only a
server-authenticated synthetic identity in DARK is admitted. OFF and ENFORCED
cannot enter this local candidate. Outputs never enable browser dispatch.

Admission validates the immutable prepared envelope and actual argument/action
digests; obtains the current ledger and checks tenant, goal, revision, status,
validity, and exact authorization; obtains the current device/tab/document
target; and requires an exact server grant narrowing the current authorization
to action and target. Exactly one direct ledger AUTHORITY record is supported.
Other authority sources are deliberately unavailable in this first candidate.

Every top-level argument needs an OPERAND record whose digest covers its entire
value (including nested content), plus an exact authenticated provenance record
returned by the resolver. The resolver must verify source and transforms from
trusted state, not echo the submitted record. Count/depth/size budgets are checked.
Input is snapshotted before asynchronous work. Results are frozen, digest-only
metadata and a deterministic `tx1:` key, not a commit capability or approval.

The internal action digest binds `{descriptorId, method, argumentsDigest}`;
the commit key follows the frozen plan's tenant/transaction/prepare/target tuple.
Frozen public schemas, fixtures, MCP source, and tool inventory are unchanged.

## Evidence and limitations

- TDD red: `ERR_MODULE_NOT_FOUND` before the implementation existed.
- Focused admission tests: 12/12 PASS.
- Syntax, `npm run check`, and whitespace checks: PASS, 1.6.0 / 26 capabilities.
- Final local full regression: 222/222 PASS (58.66 seconds); an intermediate
  full regression also passed 220/220 before the final two tests were added.
- Tests use explicit synthetic trusted adapters. They do NOT prove real OAuth
  authentication, ledger decryption/head resolution, permission/constraint
  evaluation, or authenticated source/transform resolution in production.
- No SQL, encrypted transaction tokens, durable journal, nonce CAS, rate tables,
  lease recovery, actual PostgreSQL role/concurrency tests, advisor checks, or
  production probe has been implemented/claimed by this unit.
- PATH probes did not resolve docker/psql/supabase/deno; the conventional
  PostgreSQL install directory was absent. This is not an exhaustive tooling
  investigation and does not justify substituting SQLite/string scans.

## Remaining 8D work

Continue within 8D: install/locate isolated real PostgreSQL tooling, build private
SQL/journal/approval/rate/lease/token storage tests-first, connect actual trusted
admission adapters, and exercise all frozen 8D role/tenancy/CAS/recovery/crypto/
limits/cleanup gates. Obtain independent exact SQL/host review before separately
authorized production mutation. No MCP/OAuth cutover, browser executor, new CRX,
or 8E is authorized by this local admission result.

Rollback is repository-only; no production rollback or extension update is needed.

## Repository closeout evidence

Implementation/test/context commit: `c117b2d155356e0399bfbb6285687d6e4f568cdb`.
Standard GitHub CI run `34707313560` (#174) at that exact head completed SUCCESS,
including unit/static and Chromium extension regression. Temporary validation
PR #30 is CI-only and must be closed without merge after the final documentation
head passes. No workflow instrumentation was introduced. Net diff from baseline:
six files (library, tests, this record, context, handoff, changelog).
Verify the final docs-head CI and PR closure remotely; this record does not turn
the local admission candidate into 8D acceptance or authorize production.
