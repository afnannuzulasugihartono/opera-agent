# Agent Call Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Opera Agent honestly callable as a browser agent: one working entry point per surface, a recorded proof that the shipped extension drives a real browser through the public MCP surface, and a call guide that matches the code.

**Architecture:** `scripts/extension-run.mjs` drives the real product path end to end: the shipped `extension/` is loaded into a real Chrome, the extension's own loopback bridge link connects to the local bridge, and an MCP client speaks stdio to `local/bin/opera-local.js` with `OPERA_LOCAL_TRANSPORT=bridge`. Every call and answer is written to `proof/extension-run.jsonl` and `proof/extension-run.md`. `scripts/hosted-mcp-check.mjs` records what the hosted MCP surface answers to a client that has no token yet. `docs/agent-call.md` is the call guide, and a test pins it to the code so it cannot drift.

**Tech Stack:** Node 22, Chrome DevTools Protocol over WebSocket, MCP JSON-RPC over stdio, `node:test`.

**Spec:** none written; this plan is the design. The goal it serves: Opera Agent is legitimately callable as a browser agent.

## Global Constraints

- One accent `#3ecf8e`; no money figures outside `/harga`; no visitor-visible benchmark or tool talk on `/bukti`.
- Gates for every change: `npm test`, `npm run check`, `node scripts/format-comments.mjs --check`; `py tests/browser_extension_test.py` when the extension changes behaviour inside a page.
- Branch off `origin/main`; conventional commits; PR from `.github/pull_request_template.md`; merge `gh pr merge <n> --squash --admin --delete-branch=false`; deploy only when `landing/` changed.
- The proof runner must never touch the shared browser port 9222 and must use a throwaway profile.
- Secrets: no token, no account, no password in the tree, in the record, or in the chat.

## Review Focus

- The extension connecting to the bridge from a stale port: the extension probes `9451, 19451, 9333, 9222` (`extension/worker/bridge-link.js:46`), so the run must fail loudly when the bridge is not on a port the extension probes.
- The drive silently falling back to CDP: `local/bin/opera-local.js:43` asks per call, so a call before the extension connects must be refused rather than answered from a debugging port.
- A record that claims more than the run did: the test must re-read the jsonl and compare it with the markdown, not with a stored summary.
- The hosted surface answering with a token that leaked into the record: the hosted check records status codes and the discovery document, never a credential.
- The call guide naming a surface that does not exist: every URL in the guide is compared with `extension/lib/endpoints.js`.

---

### Task 1: The extension path, proven end to end

**Files:**
- Create: `scripts/extension-run.mjs`
- Create: `proof/extension-run.jsonl`, `proof/extension-run.md`, `proof/extension-portal.jpg`
- Modify: `scripts/proof-run.mjs` (let `speakMcp` choose the transport)
- Test: `tests/extension-run.test.mjs`

**Interfaces:**
- Consumes: `serveCompany()` and `speakMcp()` from `scripts/proof-run.mjs`; `createBridgeServer` from `local/bridge-ws.js` through the MCP server; the `extension/` folder as shipped.
- Produces: `runExtensionProof({ port, bridgePort })` returning `{ calls, download, capture, toolCount }`, and the record files the test reads.

- [ ] **Step 1: Write the failing test**

```js
// tests/extension-run.test.mjs
test('the recorded extension run drove the browser through the extension', () => {
  const lines = fs.readFileSync(new URL('../proof/extension-run.jsonl', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const calls = lines.filter((entry) => entry.kind === 'call');
  assert.deepEqual(calls.map((entry) => entry.tool), [
    'browser_status', 'open_url', 'read_page', 'find_elements', 'download', 'capture_page', 'close_tab'
  ]);
  assert.ok(lines.find((entry) => entry.kind === 'header').transport === 'bridge');
});

test('the record and the markdown agree on the bytes', () => {
  const md = fs.readFileSync(new URL('../proof/extension-run.md', import.meta.url), 'utf8');
  const download = fs.readFileSync(new URL('../proof/extension-run.jsonl', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map((line) => JSON.parse(line)).find((entry) => entry.kind === 'download');
  assert.ok(md.includes(download.sha256));
  assert.ok(fs.existsSync(new URL('../proof/extension-portal.jpg', import.meta.url)));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/extension-run.test.mjs`
Expected: FAIL — the record files do not exist.

- [ ] **Step 3: Let `speakMcp` carry the transport**

In `scripts/proof-run.mjs`, change the spawn env so the transport is a parameter and `cdp` stays the default:

```js
export function speakMcp({ port, cwd = process.cwd(), env = process.env, transport = 'cdp' } = {}) {
  const child = spawn(process.execPath, [path.join(cwd, 'local', 'bin', 'opera-local.js')], {
    cwd,
    env: { ...env, OPERA_LOCAL_TRANSPORT: transport, OPERA_LOCAL_PORT: String(port) },
    stdio: ['pipe', 'pipe', 'inherit']
  });
```

- [ ] **Step 4: Write the runner**

`scripts/extension-run.mjs` does, in order:

1. `serveCompany()` for the portal fixture, so the drive reads a page it did not create.
2. `speakMcp({ transport: 'bridge', env: { ...process.env, OPERA_BRIDGE_PORT: String(bridgePort) } })`. The MCP server owns the bridge on `127.0.0.1:9451`, which is the port the extension probes first (`extension/worker/bridge-link.js:46`).
3. Wait for `GET http://127.0.0.1:<bridgePort>/health` to answer `ok: true`.
4. Launch Chrome with the shipped extension: `--load-extension=<repo>/extension`, `--disable-extensions-except=<repo>/extension`, `--remote-debugging-port=<port>`, `--user-data-dir=<temp>`, `--headless=new`.
5. Wait for the bridge health to report `linked: true`, which is the extension's own socket. A timeout names the port and the extension id.
6. Call, over MCP stdio, in this order: `browser_status`, `open_url` (the portal), `read_page`, `find_elements` (the download button), `download` (into a temp folder), `capture_page`, `close_tab`.
7. Write `proof/extension-run.jsonl` (one line per call with tool, arguments, answer summary and answer text), `proof/extension-portal.jpg` (the capture) and `proof/extension-run.md` (the readable record with the tool count, the download hash and the capture size).

The runner refuses to continue when `browser_status` does not report the bridge as the road in use, so a run that fell back to CDP cannot be recorded as an extension run.

- [ ] **Step 5: Run the runner and the test**

Run: `node scripts/extension-run.mjs` then `node --test tests/extension-run.test.mjs`
Expected: the runner prints the record path; the test passes.

- [ ] **Step 6: Commit**

```bash
git add scripts/extension-run.mjs scripts/proof-run.mjs proof/extension-run.jsonl proof/extension-run.md proof/extension-portal.jpg tests/extension-run.test.mjs
git commit -m "feat(proof): drive a real browser through the shipped extension"
```

---

### Task 2: The call guide, true to the code

**Files:**
- Create: `docs/agent-call.md`
- Modify: `local/README.md`, `docs/product/pilot-runbook.md`
- Test: `tests/agent-call-docs.test.mjs`

**Interfaces:**
- Consumes: `extension/lib/endpoints.js` (the live URLs), `local/tools.js` (the tool names), `local/package.json` (the package name and bin).
- Produces: `docs/agent-call.md`, the one file a reader is sent to when they ask how to call Opera Agent.

- [ ] **Step 1: Write the failing test**

```js
// tests/agent-call-docs.test.mjs
test('the call guide names every surface that exists', () => {
  const guide = fs.readFileSync(new URL('../docs/agent-call.md', import.meta.url), 'utf8');
  assert.ok(guide.includes(ENDPOINTS.SUPABASE_PROJECT_REF ? 'opera-agent-mcp' : ''));
  assert.match(guide, /local\/bin\/opera-local\.js/);
  assert.match(guide, /extension/);
});

test('the guide and the README agree with the tool list', () => {
  const tools = [...fs.readFileSync(new URL('../local/tools.js', import.meta.url), 'utf8')
    .matchAll(/name:\s*'([a-z_]+)'/g)].map((m) => m[1]);
  const readme = fs.readFileSync(new URL('../local/README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes(`The server advertises ${tools.length} tools`));
  for (const tool of tools) assert.ok(readme.includes(tool), `the README must name ${tool}`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/agent-call-docs.test.mjs`
Expected: FAIL — the guide does not exist, and the README still says 39 tools.

- [ ] **Step 3: Fix `local/README.md`**

- The install line becomes the command that works today from a clone: `node local/bin/opera-local.js`, with `npx opera-local` named as the published form that is not on the registry yet (`npm view opera-local` answers 404).
- The transport paragraph is corrected: the loopback road is one WebSocket (`local/bridge-ws.js`), not a held `POST /poll`.
- The tool count and the tool list are replaced with the names `local/tools.js` registers, and a test pins both.

- [ ] **Step 4: Fix `docs/product/pilot-runbook.md`**

Replace `npx opera-local` with the command that works from a clone, keeping the rest of the runbook as it is.

- [ ] **Step 5: Write `docs/agent-call.md`**

Three surfaces, in the order a reader meets them:

1. **Hosted MCP** — the URL from `extension/lib/endpoints.js`, OAuth discovery, the device header, and the OpenCode config block that already lives on `/docs`.
2. **Local stdio MCP** — `node local/bin/opera-local.js`, the environment variables, and the client config for OpenCode, Claude Desktop and any stdio MCP client.
3. **The extension road** — what the extension is for, how the everyday browser is driven without a debugging port, and the record from Task 1 as the evidence.

Each surface carries the one thing a caller gets wrong: the hosted one needs a paired device and a login, the local one needs a browser with a debugging port or the extension, and the extension one needs the loopback bridge.

- [ ] **Step 6: Run the test and the suite**

Run: `node --test tests/agent-call-docs.test.mjs` then `npm test`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add docs/agent-call.md local/README.md docs/product/pilot-runbook.md tests/agent-call-docs.test.mjs
git commit -m "docs(agent): one guide to call Opera Agent, true to the code"
```

---

### Task 3: The hosted surface, checked as a client sees it

**Files:**
- Create: `scripts/hosted-mcp-check.mjs`, `proof/hosted-mcp.json`
- Test: `tests/hosted-mcp.test.mjs`

**Interfaces:**
- Consumes: the hosted MCP URL from `extension/lib/endpoints.js`.
- Produces: `proof/hosted-mcp.json`, holding the discovery document and the status codes a tokenless client gets.

- [ ] **Step 1: Write the failing test**

```js
// tests/hosted-mcp.test.mjs
test('the hosted MCP surface answers a client that has no token', () => {
  const record = JSON.parse(fs.readFileSync(new URL('../proof/hosted-mcp.json', import.meta.url), 'utf8'));
  assert.equal(record.discovery.status, 200);
  assert.equal(record.discovery.authorization_servers.length, 1);
  assert.equal(record.initialize.status, 401);
  assert.ok(record.initialize.wwwAuthenticate.includes('resource_metadata'));
  assert.ok(!JSON.stringify(record).includes('eyJ'), 'no token may be recorded');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/hosted-mcp.test.mjs`
Expected: FAIL — the record does not exist.

- [ ] **Step 3: Write the checker**

`scripts/hosted-mcp-check.mjs` fetches `GET <mcp>/.well-known/oauth-protected-resource` and posts an MCP `initialize` without a token, then writes `proof/hosted-mcp.json` with the statuses, the `WWW-Authenticate` header and the discovery document. It records no credential, and it writes nothing when the network is unreachable.

- [ ] **Step 4: Run the checker and the test**

Run: `node scripts/hosted-mcp-check.mjs` then `node --test tests/hosted-mcp.test.mjs`
Expected: the record is written; the test passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/hosted-mcp-check.mjs proof/hosted-mcp.json tests/hosted-mcp.test.mjs
git commit -m "feat(proof): record what the hosted MCP surface answers"
```

---

### Task 4: The site says which road the browser is driven on

**Files:**
- Modify: `landing/bukti.html`, `landing/docs.html`
- Test: `tests/landing-sample.test.mjs`, `tests/landing-claims.test.mjs`

**Interfaces:**
- Consumes: the record from Task 1.
- Produces: two sentences on the site that point at the proof.

- [ ] **Step 1: Write the failing test**

```js
test('the proof page names the extension road and links the record', () => {
  const page = read('bukti.html');
  assert.match(page, /extension/i);
  assert.match(page, /extension-run\.md/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/landing-sample.test.mjs`
Expected: FAIL — the page says nothing about the extension.

- [ ] **Step 3: Edit the two pages**

`landing/bukti.html`: one sentence in the hero that says the run drove the browser through the extension that ships with the product, and one link to the record. `landing/docs.html`: one line under the MCP section pointing at `docs/agent-call.md` for the local road.

No tool names, no timings, no money figures.

- [ ] **Step 4: Run the landing tests**

Run: `node --test tests/landing-sample.test.mjs tests/landing-claims.test.mjs tests/landing-i18n.test.mjs tests/landing-visual.test.mjs tests/landing-hosting.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add landing/bukti.html landing/docs.html tests/landing-sample.test.mjs
git commit -m "feat(site): name the road the browser was driven on"
```

---

### Task 5: Gates, pull request, merge, deploy

- [ ] **Step 1: Run every gate**

Run: `npm test`, `npm run check`, `node scripts/format-comments.mjs --check`
Expected: green.

- [ ] **Step 2: Open the pull request**

Use `.github/pull_request_template.md`: what changed, the measurement, the failure it prevents, what is still unverified, the gates, the pins.

- [ ] **Step 3: Merge and deploy**

Run: `gh pr merge <n> --squash --admin --delete-branch=false`, then dispatch `.github/workflows/deploy-site.yml` because `landing/` changed, then read `https://opera-agent.pages.dev/bukti` and `https://opera-agent.pages.dev/docs` to confirm the new copy is live.
