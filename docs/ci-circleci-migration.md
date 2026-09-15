# CircleCI migration state

Date: 2026-09-15
Status: CONFIG COMMITTED, EXTERNAL PROJECT CONNECTION PENDING
Scope: CI infrastructure only; no Opera Agent runtime, Supabase, OAuth, MCP, extension, signing, pairing, policy, or 8D transaction behavior change.

## Why this exists

The current GitHub-hosted Actions run for the 8D branch repeatedly failed before any workflow step executed. The latest reproduced fingerprint was an immediate job failure with no steps and unavailable job logs (`BlobNotFound`). The application/test workflow itself had previously passed on the same code lineage, so the user chose CircleCI as the free hosted CI fallback rather than changing 8D runtime code to chase an infrastructure-side failure.

## Candidate configuration

CircleCI config was added at `.circleci/config.yml` in commit:

`721660802c91ab76b36e00e0ac6a24bd881df3c6`

The CircleCI job intentionally mirrors the existing `.github/workflows/ci.yml` gates:

1. checkout the exact VCS revision supplied by CircleCI;
2. Python 3.12 runtime;
3. Node.js 22.20.0 runtime with a major-version assertion;
4. `npm test`;
5. `npm run check`;
6. install Python Playwright and Chromium with system dependencies;
7. run `python tests/browser_extension_test.py`.

No deployment step, environment secret, Supabase credential, Management token, browser transaction acceptance credential, or production mutation is present in CircleCI configuration.

CircleCI config syntax uses version 2.1 with certified `circleci/node@7.2.1` and `circleci/python@2.0.3` orbs. The YAML parses locally. GitHub Actions is deliberately retained until CircleCI produces a successful independent hosted run, so rollback is trivial.

## External setup still required

Connect CircleCI Cloud to GitHub using the recommended CircleCI GitHub App and grant access only to:

`afnannuzulasugihartono/opera-agent`

Then create/set up the CircleCI project using the repository's existing `.circleci/config.yml` and run the branch:

`feat/semantic-runtime-1.6.0`

Use only the CircleCI Free plan. Do not add billing, deployment secrets, Supabase credentials, Management tokens, or production acceptance credentials.

The ChatGPT web-automation attempt did not reach CircleCI because the available TinyFish account rejected strict-agent mode before a browser run was created. The Opera Browser Connector was also disconnected. Therefore no CircleCI account/project/GitHub-App mutation is claimed yet.

## Acceptance for replacing GitHub-hosted Actions as the 8D CI evidence path

CircleCI is not the accepted replacement until a run on an exact committed branch head shows all of the following green:

- runtime version checks;
- `npm test`;
- `npm run check`;
- Playwright/Chromium installation;
- `python tests/browser_extension_test.py`.

Record the exact commit SHA and CircleCI pipeline/workflow/job identifiers. Only after that evidence exists should project governance be updated to treat CircleCI as an accepted CI executor for 8D. Do not call 8D accepted solely because this configuration file exists.
