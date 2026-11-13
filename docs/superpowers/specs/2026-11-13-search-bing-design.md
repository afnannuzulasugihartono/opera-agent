# @last-edited: 2026-11-13 UTC+7.
# @title: search_bing - one call, the Bing SERP, in one structured object an agent can act on.
# @state: the design for the search_bing tool; the task this pins, the guarantees, and the refusal cases.
# @dependencies: `supabase/functions/opera-agent-mcp/tools.ts`, `tests/fixtures/mcp-contract-v1.json`, `tests/fixtures/bing-serp-page1.json`.

# WHAT THIS IS FOR

The shortest possible round-trip from "I know what to search for" to "here are the pages that answer it". Nothing more, nothing less. The tool must be usable as a first call by an agent that has never opened a browser in its life.

# SHAPE OF THE ANSWER

```json
{
  "ok": true,
  "kind": "search",
  "page": { "url": "...", "title": "..." },
  "search": {
    "query": "...",
    "engine": "bing",
    "pages": 1,
    "count": <n>,
    "truncated": <bool, true when Bing still has a next page and the tool did not take it>,
    "results": [
      {
        "rank": 1,
        "title": "Opera Agent: Private Local MCP Browser Automation Bridge",
        "url": "https://mcpmarket.com/server/opera-agent",
        "site": "mcpmarket.com",
        "snippet": "The Opera Agent is a private, secure bridge that connects AI agents using the Model Context Protocol (MCP) with a user's local web browser. It allows for local automation and real-time execution without routing sessions to the cloud."
      }
    ]
  }
}
```

# RULES OF THE ROAD

1. Default `pages: 1`. Maximum `pages` = 3. The agent asks for more explicitly; never the tool.
2. `truncated` is `true` iff Bing shows a Next control after the last page the tool fetched; otherwise `false`. The tool never hides that there is more.
3. Each result carries `title` (Bing's own h2/h3), `url` (the href Bing exposes), `site` (hostname), `snippet` (the card text Bing renders, verbatim) — all already present on the page, nothing invented.
4. Only external results are kept: `https://` links to third-party origins. Bing self-links (navigation, pagination, settings, sign-out) are dropped.
5. Output order = Bing's display order. Deduplicate identical URLs.
6. The background tab is closed on completion; failure leaves no state on the user's everyday browser either way.

# REFUSAL / SAFE MODE

- Sensitive-surface refusal — a search page is public browser content; the in-flight gate does not block it.
- Bing refuses or answers 429 with no attempt directive: surface the error, never fake results.
- Empty results page: `count: 0, truncated: false`. The tool is not required to invent an answer.

# IMPLEMENTATION SKETCH

Tools.ts gains one tool, `search_bing`, implemented in a new module `search-bing.ts`. Each page is one `browser.burst` (navigate → wait for `.b_algo` → read → find anchors) with `includeElements: true, maxElements: 200`. The server then parses the three streams (headings, anchors, paragraphs) into `results`, filtering Bing self-links and zipping by display order. If zip counts mismatch the tool ships `results` with what it has and `truncated: true`, rather than fabricating.

# RELEASE

Follows release discipline as usual (AGENTS.md `Every user-visible change ships through the Release bump button`). This is 1.6.51; the tools count goes 41 → 42; handoff + landing counts update in the same PR.
