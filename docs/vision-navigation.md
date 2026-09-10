# Vision-guided navigation

Opera Agent 1.5.0 begins Milestone 4 without adding another MCP tool or embedding site-specific code in the extension. ChatGPT remains the decision layer; Opera Agent supplies reliable, bounded observations and actions.

## Checkpoint 4A

Existing results now provide the signals needed for a generic loop:

- `read_page` returns `documentId`, mutation state, viewport/document dimensions, device and visual scale, browser zoom, element rectangles, true `inViewport` state, and stable keys.
- `wheel_at` identifies the actual scrollable ancestor under its coordinates and returns before/after position and extent, `moved`, `contentChanged`, `settled`, `reachedBoundary`, and the input path used.
- `scroll_page` returns equivalent document-level before/after metrics while retaining its previous top-level `scrollX` and `scrollY` fields.
- Coordinate observations include the document and viewport state that made those coordinates valid.

`stableKey` is for collection deduplication; a document-scoped `ref` remains the preferred action target. Links use their canonical absolute `href`, elements with an ID use that ID, and other elements use bounded semantic fields. Callers should retain the canonical URL alongside the key when a site exposes one.

## Bounded loop

The decision layer should use this sequence:

1. Observe with DOM data first and capture a screenshot only for canvas, missing semantics, low confidence, or verification after a meaningful change.
2. Prefer a current ref. Use coordinates only when the document, viewport, zoom/scale, and screenshot hash still match the observation.
3. Act with one operation or a short same-tab burst.
4. Wait for the returned scroll/action state to settle, then collect new stable keys or URLs.
5. Verify the intended state. On a coordinate failure, take one fresh observation before considering one bounded retry.
6. Stop on success, repeated no-change, a reached boundary with no new identities, or any configured iteration/time/byte limit.

A collector must set explicit limits for iterations, commands, captures, elapsed time, and result bytes. It must never interpret a map scale marker as a geographic search radius. Precise radius filtering requires coordinates and distance calculation outside the generic extension primitive.

## Scroll behavior

Debugger mouse-wheel input remains the primary coordinate path. Some inactive or fixed containers accept the event but do not move. When that happens and the measured container still has room in the requested direction, Opera Agent performs a direct bounded scroll on that same measured container and reports `inputMethod: "dom-fallback"`. It does not activate the tab or move the operating-system pointer.

Lazy loading is not considered complete merely because one wheel reaches the old bottom. A DOM mutation can increase `scrollHeight`, causing the returned `reachedBoundary` to remain false. The caller then collects newly loaded identities and performs another bounded pass.

## Site adapters

Google Maps may later receive a server-side workflow adapter for sector scanning, coordinate/radius filtering, and Place URL/ID deduplication. That adapter will be composed from these generic primitives. It will not add Maps selectors, ranking assumptions, or radius semantics to the extension.

Milestone 4 acceptance also requires at least two unrelated complex applications, signed real-Opera testing, and proof that all tests preserve the user's active tab and focused window.
