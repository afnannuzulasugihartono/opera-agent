# Tests

Opera Agent should be tested at several layers:

- unit tests
- protocol validation
- Supabase integration tests
- mock browser pages
- trusted-input tests
- reconnect and restart tests
- timeout and retry tests
- duplicate-command/idempotency tests
- sensitive-field safety tests
- real Chromium regression tests
- real Opera acceptance tests

Known legacy bugs should become regression tests so they do not return in the rebuilt architecture.
