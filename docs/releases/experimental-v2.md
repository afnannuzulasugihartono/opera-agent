# Experimental v2 local-plan work — not released

This document records an **unreleased experiment**, not a stable Opera Agent extension version.

## What was tested

On 2026-09-09 a production migration temporarily registered a generic `browser.plan` method and four server workflows:

- `browser.v2_status`
- `research.v2_read_current_full`
- `research.v2_read_url_full`
- `research.v2_crawl_urls`

The idea was to execute a bounded declarative sequence of existing browser primitives inside one local claimed command, reducing backend round trips while keeping site-specific logic on the server.

## Why it was quarantined

The installed stable extension remained **Opera Agent 1.0.1**, protocol `1`, and advertised the original **23 primitives**. It did **not** advertise or implement `browser.plan`.

Therefore the v2 workflows were not valid production capabilities. They were disabled and `browser.plan` was disabled in the method registry by migration `20260909012749_opera_agent_quarantine_unreleased_v2.sql`.

No v2 workflow run was recorded before quarantine.

## Current status

- Stable installed extension: **1.0.1**
- Stable extension ID: `pagjlnohdemoohcncicjmaejedcmcocm`
- Stable protocol: `1`
- Stable browser primitive count: **23**
- `browser.plan`: **disabled / unreleased**
- v2 workflows: **disabled / historical only**

The separate `opera-agent-update-v2` Edge Function is also an experimental artifact. The stable extension update URL continues to use `opera-agent-update`, so the v2 update function is not part of the shipped update path.

## Future requirements

A local-plan feature may be revisited only as a normal backward-compatible extension release after:

1. the original CRX signing identity is securely available;
2. the extension implements a bounded, allowlisted local plan executor with no remote JavaScript or recursive plans;
3. Chromium regression passes;
4. real Opera acceptance passes;
5. the packed CRX keeps the stable extension ID;
6. update, rollback, safety, timeout, and result-size boundaries are verified.

This historical record should remain even if a future stable version implements a different design.
