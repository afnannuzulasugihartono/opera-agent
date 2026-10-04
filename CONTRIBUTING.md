@last-edited: 2026-10-04 18:25 UTC+7.
@related: [AGENTS.md](AGENTS.md) rules - [tests/README.md](tests/README.md)

# Contributing

Simplify first, code first, comments second. State what is true now, never its history.

Cover every button on every site, and grow the capability the Goals in [`AGENTS.md`](AGENTS.md) name.


## Development workflow

Use short-lived branches for changes, following the binding naming rules in
[`AGENTS.md`](AGENTS.md):

```text
feat/*      fix/*      chore/*      docs/*      test/*      perf/*      refactor/*
release/<semver>
```

Before merging:

1. Run automated tests.
2. Verify extension syntax and manifest validity.
3. Run browser regression tests where applicable.
4. Update documentation for user-visible behavior.
5. Update `[CHANGELOG.md](CHANGELOG.md)` for notable changes.

## Project rules

- Keep the extension focused on generic browser primitives.
- Keep higher-level workflows in Supabase where possible.
- Avoid site-specific extension logic unless a browser-local primitive is genuinely required.
- Preserve backward compatibility unless a versioned protocol change is intentional.
- Never commit credentials, signing keys, Supabase service keys, or private tokens.
