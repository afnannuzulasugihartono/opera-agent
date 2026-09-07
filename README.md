# Opera Agent

Opera Agent is a local browser-control bridge for Opera. It connects ChatGPT and Supabase workflows to the user's local Opera browser without moving the browsing session to a cloud browser.

The rebuilt project starts at **1.0.0** and follows Semantic Versioning.

## Architecture

```text
ChatGPT
   |
   v
Supabase
Command / Workflow Layer
   |
   v
Opera Agent Extension
   |
   v
Local Opera Browser
   |
   v
Structured Results
   |
   v
Supabase
   |
   v
ChatGPT
```

The extension is intentionally thin: receive, validate, execute, collect, and return. Higher-level workflows belong in Supabase whenever possible.

## Repository structure

```text
extension/   Browser-local bridge and primitives
supabase/    Database, Edge Functions, commands, workflows
scripts/     Development and release utilities
tests/       Unit, integration, browser, and regression tests
docs/        Architecture, history, versioning, and releases
```

## Documentation

- [Architecture](docs/architecture.md)
- [Versioning](docs/versioning.md)
- [Release process](docs/release-process.md)
- [Project history](docs/history.md)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## Status

The project is being rebuilt from scratch. The first stable release will be **Opera Agent 1.0.0**.

Previous Local Opera Agent v3 builds are preserved only as historical references during the rebuild.
