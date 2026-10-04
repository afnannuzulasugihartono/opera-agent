# Contributing

Simplification above everything. Current state, never a history book.

Related: [AGENTS.md](AGENTS.md) rules - [tests/README.md](tests/README.md)

## Development workflow

Use short-lived branches for changes, following the binding naming rules in
`AGENTS.md`:

```text
feat/*      fix/*      chore/*      docs/*      test/*      perf/*      refactor/*
release/<semver>
```

Before merging:

1. Run automated tests.
2. Verify extension syntax and manifest validity.
3. Run browser regression tests where applicable.
4. Update documentation for user-visible behavior.
5. Update `CHANGELOG.md` for notable changes.

## Project rules

- Keep the extension focused on generic browser primitives.
- Keep higher-level workflows in Supabase where possible.
- Avoid site-specific extension logic unless a browser-local primitive is genuinely required.
- Preserve backward compatibility unless a versioned protocol change is intentional.
- Never commit credentials, signing keys, Supabase service keys, or private tokens.
