# Architecture

## Overview

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
Result / DOM / Media / Input State
   |
   v
Opera Agent Extension
   |
   v
Supabase
   |
   v
ChatGPT
```

## Extension responsibilities

The extension should:

1. Receive a command.
2. Validate it against an allowlist.
3. Execute a browser primitive.
4. Collect structured results.
5. Return the result.

The extension should not own product-level workflows such as "learn a YouTube video" or "deep research this site" unless a browser-local primitive is genuinely required.

## Supabase responsibilities

Supabase should own:

- command registry
- workflow definitions
- orchestration
- retries and timeouts
- audit logs
- workflow versioning
- cross-chat access
- rollback of server-side commands

## Primitive examples

- `tabs.list`
- `tabs.open`
- `tabs.close`
- `tabs.activate`
- `tabs.navigate`
- `page.read`
- `page.elements`
- `page.click`
- `page.fill`
- `page.key`
- `page.scroll`
- `page.wait`
- `media.state`
- `cdp.click`
- `cdp.key`

## Design goal

The browser extension should be stable and rarely updated. Most new behavior should be expressible as server-side workflows built from generic primitives.
