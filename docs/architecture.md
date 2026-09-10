# Architecture

## Overview

```text
ChatGPT
   |
   v
Supabase workflow / command layer
   |
   +--> versioned workflow registry / runner
   |
   v
opera_commands
   |
   v
opera-agent-bridge
   |
   v
Opera Agent extension
   |
   v
Local Opera Browser
   |
   v
DOM / tabs / media / trusted input
   |
   v
structured result
   |
   v
Supabase
   |
   v
ChatGPT
```

## Core boundary

The browser extension is deliberately generic and should be updated rarely. Its responsibility is:

1. receive a command;
2. validate the command against the browser-method allowlist;
3. execute one generic browser primitive or one strictly bounded same-tab burst;
4. enforce local safety boundaries;
5. collect a bounded structured result;
6. report completion durably.

The extension should **not** own product/site workflows such as "learn a YouTube video", "fill LinkedIn", or "research this site". Those are composed in the versioned Supabase workflow layer.

## Supabase responsibilities

Supabase owns:

- pairing/device registry;
- command queue and expiry;
- workflow definitions and versions;
- orchestration, conditions, bounded repeats and foreach;
- retries/timeouts;
- audit logs;
- cross-chat access;
- rollback of workflow definitions;
- signed release metadata/update delivery.

## Current generic browser primitives

Protocol 1 in Opera Agent 1.2.0 exposes 25 methods:

```text
browser.ping
browser.burst

tabs.list
tabs.get
tabs.find
tabs.open
tabs.activate
tabs.close
tabs.navigate
tabs.reload

page.read
page.query
page.find
page.collect_links
page.click
page.pointer
page.fill
page.focus
page.scroll
page.key
page.wait_for

media.state
media.play
media.pause
media.seek
```

Trusted click/key behavior is selected through parameters on the generic page primitives; it is not a site-specific method. `browser.burst` is a linear, same-tab transport optimization over eight existing page actions, not a workflow language; site-specific orchestration remains in Supabase.

## Latency architecture

The performance target is not "make every selector faster". The preferred order is:

1. remove redundant browser operations;
2. collapse known same-tab action chains into one bounded local burst;
3. collapse wider chat-side sequences into one server workflow;
4. replace fixed waits with observable state waits;
5. avoid unnecessary page reload/navigation;
6. minimize result payload size;
7. optimize queue/claim polling without increasing permanent idle load;
8. only then optimize individual primitive implementation details.

The bridge therefore uses a short fast-start polling window for active command chains, then returns to the conservative idle poll interval. The 1.1.0 source candidate replaces content readiness reads with an internal ping, lets text-heavy workflows omit element serialization, and skips redundant activation/navigation. Normal `page.read` behavior remains element-rich and caller-configurable.

The workflow runner records bounded operational metadata—queue/execution timing, command count, response byte counts, retry count, and intentional fixed waits—without recording page text or form values. Per-command records are capped at 200 entries.

See [performance.md](performance.md), [workflow-design.md](workflow-design.md), and [benchmarks.md](benchmarks.md) for the implementation and measurements.

## Version boundary

Server workflow versions and extension versions are intentionally independent:

- workflow improvements can be deployed/rolled back without replacing the browser extension;
- extension changes require a normal signed release; legacy updates require the legacy signing identity;
- the explicitly authorized 1.1.0 new-key build is a separate installation, so it does not claim legacy identity continuity;
- historical migrations and release notes remain preserved.

## Design goal

Most future behavior should be expressible as versioned server workflows built from generic primitives. The quarantined local-plan/v2 experiment is not active and is not part of the 1.1.0 candidate.
