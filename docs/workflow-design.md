# Efficient Workflow Design

## Generic fast path

Every high-level workflow should follow the same shape:

```text
inspect cheap current state
→ reuse a suitable tab when safe
→ execute only missing actions
→ wait for the semantic condition
→ collect only requested data
→ stop as soon as the goal is satisfied
```

Site selectors belong in versioned Supabase workflow definitions. The extension remains a generic receive/validate/execute/collect/return layer.

## Reading

Use normal `page.read` when a caller needs interactive elements. For article, transcript, or other text extraction, request:

```json
{"limit":12000,"includeElements":false}
```

Read `nextOffset` again only while `hasMore` is true and while the workflow's bounded iteration/total limit has not been reached. Full-text workflow revisions are registered through `opera_register_workflow`, leaving earlier versions available for rollback.

## Navigation and interaction

- Prefer `tabs.open`/`tabs.navigate` with `wait:false`, followed by `page.wait_for` on the actual target state for dynamic pages.
- Reusing the current URL or active tab is safe; the extension reports `reused:true` for these no-op paths.
- Prefer query → fill → Enter when the target input's semantics support it.
- Do not reuse stale element refs across document changes.

## Waiting and parallelism

- Use `page.wait_for` for state changes.
- Fixed waits are bounded to 5 seconds and are included in telemetry.
- Parallel `foreach` is capped at four workers and is only appropriate for independent tabs/read-only branches.
- Mutating operations on the same tab remain serial.

## YouTube as a workflow, not an architecture

YouTube search, recommendation/ad handling, captions, and transcript selectors remain in server migrations. The same extension primitives continue to support arbitrary research sites, portals, dashboards, SPAs, media pages, and forms.
