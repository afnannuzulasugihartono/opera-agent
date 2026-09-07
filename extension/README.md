# Extension

Browser-local Opera Agent code lives here.

The extension should remain a thin bridge responsible for:

- receiving validated commands
- executing allowlisted browser primitives
- reading structured browser/page state
- using trusted CDP input where required
- returning results to Supabase
- reconnecting safely after service-worker, browser, sleep, or network interruptions

Site-specific workflows should normally live outside the extension.
