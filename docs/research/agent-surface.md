# The agent's choice

Research note, 2026-10-20. Not a plan of record: a reading of the evidence, so the plan
that follows can be argued with.

## The question

Not "what would make Opera Agent better" — that invites a feature list. The question is:

> An AI agent has a browser task. It can fetch the HTML, drive its own browser, use
> Playwright MCP, or use Opera Agent. What makes it reach for Opera Agent **first**, and
> what makes it come back the second time?

The second half matters more. Agents do not form habits; they form expectations from the
last failure.

## Method

Four sources, deliberately different in kind.

1. **What the tool builders say.** Anthropic, *Writing effective tools for agents* (2025-09-11).
2. **What the closest competitors ship.** Playwright MCP and Chrome DevTools MCP — read
   from their own READMEs, not from summaries.
3. **What the research measures.** SeeAct (Zheng et al., 2024), whose finding is in its
   title: a generalist web agent *if grounded*.
4. **What this repository does under a real drive.** One agent, one day, three commits,
   numbers below. Small n, but first-hand.

The honest limit: n=1 agent, and that agent had just written the tool. Fresh-agent
evidence would need an eval, which is the first thing this note recommends.

## What the field converged on

Seven patterns, each shipped by someone and each justified by a failure they hit.

| Pattern | Who ships it | The failure it answers |
|---|---|---|
| Wait for the page to settle after **every** action | Playwright MCP (`--timeout-settle`, 500 ms default); Chrome DevTools MCP ("automatically wait for action result") | The next call reads a page that has not finished reacting |
| Address elements by **reference**, not coordinates | Playwright MCP (`target`: "exact target element reference from the page snapshot") | A coordinate is stale the moment the layout moves |
| **Search** the page server-side instead of dumping it | Playwright MCP (`browser_find`) | The accessibility tree does not fit in a context window |
| Errors that **carry the next move** | Chrome DevTools MCP design principles ("Self-Healing Errors"); Anthropic | The agent retries the same call, or gives up |
| **Token-optimised** answers, references for heavy assets | Chrome DevTools MCP ("Return semantic summaries"; "Reference over Value") | 50k lines of JSON for one question |
| The **surface is a budget** | Playwright (`--caps` opt-in); Chrome DevTools (`--slim`) | Tool schemas are loaded whether or not they are used |
| **Start the browser yourself** | Chrome DevTools MCP starts a browser on first use | "Not reachable" as the first thing an agent ever sees |

Two admissions from the competitors are worth more than the features:

- Playwright's README says coding agents are better served by a **CLI plus skills** than by
  MCP, because MCP "avoids loading large tool schemas and verbose accessibility trees into
  the model context". The people who built the most-used browser MCP say the protocol is
  not the cheap road for a coding agent.
- Chrome DevTools ships a slim mode for "basic tasks". Even a 20-tool surface is too much
  for some tasks.

Neither ships what this product's architecture is built around: a **real signed-in
profile** and **server-side, site-generic workflows**. That is the moat. Everything below
is about not losing the race to the moat.

## Where Opera Agent stands, measured

All numbers from this repository, today.

| Fact | Number |
|---|---|
| Tools on the default surface | **33** |
| Characters of name + description + schema, loaded every request | **23,916** (~5,979 tokens) |
| Longest descriptions | `read_page` 856, `capture_page` 824, `scroll` 780 |
| Average description | 372 characters |
| One search task, cold | **7 calls**, 7,611 chars, 897 ms |
| `read_page` on a settled YouTube results page | **11,574–13,483 chars** |
| What each action returns (the `elements` list) | **1,392–1,852 chars** |
| `sleep()` written by the agent in one drive | **5** |
| Silent-failure classes found in one day | **3** |
| `read_page` blind window during navigation | ~1.2 s (text `0` → 3,984 → 13,483) |
| `readyState` reliability as a "ready" signal | said `complete` at 1.9 s with 871 of 8,478 chars |

The three silences, all fixed today, are the useful part:

1. `read_page` answered `text: ""` for the first ~1.2 s with no signal that the page was
   still filling in. Fixed with two samples: `settled`, `grewBy`, `ready`.
2. `click_row` reported a click on a row while a dialog owned the point. Fixed with
   `covered`, `coveredBy`, `coveredText` — and the fix itself failed silently for an hour
   because `DOM.resolveNode` needs `DOM.enable` and the `catch` swallowed it.
3. `type` that inserted nothing offered two guesses instead of naming the focused element.
   Fixed: the failure now says `focus was on body, which takes no text`.

Three silences in one day, in a codebase that already had an advice engine and 1,274
tests. The pattern is not carelessness; it is that `catch { return {} }` looks like
robustness. Why it is the most expensive habit for an agent: every silent fallback is a
place where the agent cannot tell "nothing happened" from "I cannot see".

## Against my own nine proposals

I listed nine improvements before reading anything. The evidence reorders them and
falsifies one.

| My proposal | Verdict |
|---|---|
| `guide("here")`: one call says what this page is and what to do | **Keep, first.** The measured discovery loop was 6 calls; Anthropic's consolidation advice and Chrome DevTools' "progressive complexity" both point the same way |
| Settle by default, report the delta | **Keep, first — and it is table stakes.** Both competitors already do the waiting half. Acting behind them is not a design choice, it is a gap |
| Machine-readable `next` moves | **Keep.** Neither competitor offers executable next calls; both only advise. This is a real differentiator, and the advice engine already exists |
| `read_page` outline/diff modes | **Keep.** 13,483 chars per read, against Playwright's `--snapshot-mode none` and `browser_find` |
| One-command browser bootstrap | **Keep — table stakes.** Chrome DevTools starts the browser itself. Ours answered `not reachable` and named no road |
| `list_tabs` on both roads | **Keep, small bug.** It returned empty over the debug port while `/json/list` had the target |
| Tab hygiene | **Keep, small.** 15 tabs from one drive |
| No silent `catch` | **Keep, principle.** Today's three silences are the proof |
| Collapse the surface to ~6 verbs | **Revise. I was wrong in form.** Both competitors ship 20–30 tools and add slim/caps modes instead of collapsing; the lever is a small *default* surface plus opt-in capabilities and cheap answers, not a hard six. Charging toward six would cost coverage the product needs |

One thing I expected to find and did not: our element handles (`opera-<backendNodeId>`)
are as durable as Playwright's refs. The reference pattern is already here. It is the
one area where the code is ahead of the notes.

## The uncomfortable finding

The competitor is not Playwright MCP. It is `fetch` plus reading the HTML, or whatever
browser the agent harness already has. For a public page, `fetch` is one call, zero
schema, and no browser to start. Opera Agent wins only where the session matters: the
signed-in profile, the real app, the click that changes state.

So the product is not competing on capability. It is competing on **the cost of the first
five minutes** and **the trustworthiness of each answer**. Today the first five minutes
cost: start a browser by hand, discover a port, write a JSON-RPC client, add a retry
loop, and sleep five times. That is why I nearly did not use it.

This inverts the usual priority. Coverage is the goal, but coverage does not get used if
the entry is expensive and the answers are not trusted.

## Ranked work, with acceptance criteria

Ordered by effect on the choice, not by ease.

### P0 — the first five minutes

1. **`guide("here")`** — one call: tab, title, url, `settled`, the top ~20 actionable rows
   (role, name, rect), and 3 structured next calls.
   *Gate:* the YouTube search task, cold, in ≤ 4 tool calls. Today: 7–10.
2. **Settle by default on every mutating call**, plus a measured delta:
   `changed: {url, textDelta, focus, appeared, disappeared}`.
   *Gate:* a drive that contains zero `sleep()` and still lands a search and opens a video.

### P1 — the cost of every answer

3. **`read_page` modes**: `outline` (headings, landmarks, actionable rows) and `since`
   (a token from the last read, returning only what moved).
   *Gate:* outline ≤ 2,000 chars on the YouTube results page (today 13,483); idle `since`
   ≤ 200 chars.
4. **Structured `next`** on every failure, beside the prose.
   *Gate:* a test that pins the shape, and one live failure replayed by an agent with no
   reading of prose.
5. **Bootstrap and tabs**: `npm run browser`; the "not reachable" error names it;
   `list_tabs` answers on the debug-port road.
   *Gate:* from a cold machine, first successful `read_page` in ≤ 2 calls.

### P2 — the surface and the trust

6. **Proof field on every mutating answer**: what changed, measured, not asserted.
7. **Description budget**: merge the five highest-overlap tools; keep optional power as
   capabilities, not default tools.
   *Gate:* schema ≤ 3,000 tokens (today 5,979).
8. **Ten site guides as data** (Google first). Not per-site code: `guide()` entries that
   say which roles name the search box, the results, the editor.
   *Gate:* each guide's claim is exercised by one live drive, recorded in the commit.

## What not to build

- **Per-site primitives.** The moat is generic; a site tool spends it.
- **Screenshots as the primary channel.** SeeAct's finding is about grounding, not vision:
  a screenshot without element identity moves the problem, it does not solve it.
- **More primitives.** The surface is already 33 tools and 5,979 tokens of schema.
- **A planner (`run_task`).** The value is the see → decide → act → verify loop. A plan is
  the thing the loop replaces.

## Open questions only the owner can answer

1. Is the primary consumer an MCP client (yours), or the in-product chat? The answer
   changes whether schema cost or latency dominates.
2. Signed-in real profile or headless scale? The first is the moat; the second is a
   commodity.
3. Which five sites carry the user's own work this month? Guides should follow real use,
   not a list.

## Sources

- Anthropic, *Writing effective tools for agents — with agents*, 2025-09-11.
  https://www.anthropic.com/engineering/writing-tools-for-agents
- Microsoft, Playwright MCP, README (accessibility snapshots, refs, `--timeout-settle`,
  `browser_find`, `--snapshot-mode`, `--caps`, CLI+skills note).
  https://github.com/microsoft/playwright-mcp
- Chrome DevTools MCP, README and design principles (auto-start, wait for action,
  token-optimised, self-healing errors, reference over value, progressive complexity).
  https://github.com/ChromeDevTools/chrome-devtools-mcp
- Zheng et al., *GPT-4V(ision) is a Generalist Web Agent, if Grounded*, 2024.
  https://arxiv.org/abs/2401.01614
