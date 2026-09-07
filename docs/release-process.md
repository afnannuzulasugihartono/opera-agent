# Release Process

Each stable release should include:

1. Git tag such as `v1.0.0`.
2. GitHub Release with human-readable notes.
3. Updated `CHANGELOG.md`.
4. Passing automated tests.
5. Packaged and signed extension artifact when needed.
6. Backend migration notes when applicable.
7. Upgrade notes only when user action is required.

## Release note sections

- Highlights
- Added
- Changed
- Fixed
- Security
- Known issues
- Upgrade notes

## Branch convention

```text
main
feature/*
fix/*
release/*
```
