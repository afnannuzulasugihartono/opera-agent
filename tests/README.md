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

## Real Opera focus audit

Checkpoint 2A is implemented in `browser_extension_test.py`. It uses a temporary Opera profile and two tabs, then fails if a background command changes the user's active tab or the focused Opera window.

On Windows:

```powershell
$env:OA_BROWSER_EXECUTABLE='C:\Users\ASUS\AppData\Local\Programs\Opera\opera.exe'
$env:OA_BROWSER_HEADLESS='0'
py -3 tests\browser_extension_test.py
```

The JSON result must contain `backgroundFocusPreserved: true`. The tested command matrix and explicit foreground-only exceptions are documented in `docs/background-execution.md`.
