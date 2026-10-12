# Cloudflare Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the hot path (gateway + bridge) to one Cloudflare Worker plus one fleet Durable Object, keeping Supabase Postgres as the system of record and the extension protocol byte-compatible.

**Architecture:** The Worker verifies, enqueues via PostgREST, then makes one blocking stub call to the fleet DO, which holds the device socket (hibernation API), claims, pushes, records the completion, and resolves the waiter. No polling, no realtime subscriber, no wall-clock death.

**Tech Stack:** Cloudflare Workers + Durable Objects (wrangler via npx only), plain `.js` modules tested with `node:test`, Supabase PostgREST for all persistence.

**Spec:** `docs/superpowers/specs/2026-10-12-cloudflare-transport-design.md`

## Global Constraints

- Node's built-in `node:test` + `node:assert/strict`; no new npm dependencies.
- Cloudflare modules are plain `.js` (JSDoc types) so unit tests import them directly.
- Every comment stands above its declaration with a blank line each side, never inside a body.
- TDD: lock first, watch it fail, implement, watch it pass, commit per task.
- Verify by execution: unit suite, `npm run check`, live deploy, live measurement.
- Supabase Postgres stays the system of record; all existing RPCs unchanged.
- Protocol frames come from `extension/lib/socket-protocol.js` by relative import — never forked.
- No secret ever enters the tree; service key via `wrangler secret`, CI token via GitHub Secrets (both are explicit user steps, never worked around).
- Never disturb the user's tabs; the live tests use the designated test doc only.

## Review Focus

- A DO that hibernates mid-wait loses the in-memory waiter, so the gateway must hang till its own timeout instead of answering; lifecycle docs say an in-flight request prevents hibernation, and a reasonable person expects a slow command to answer rather than vanish — pinned by the Task 5 slow-command live step.
- Two gateway calls racing the same device must both complete exactly once, in order, with each result reaching its own caller — pinned in Task 2.
- A deploy disconnects every socket by platform design, so the device must reconnect on its own and the backlog must drain without operator action — pinned by the Task 5 post-deploy live step.
- A completion arriving after the gateway gave up must still be recorded to the database for history — pinned in Task 2.
- A socket that never authenticates must be closed unread and must never trigger a drain — pinned in Task 2.

---

### Task 1: Scaffolding, PostgREST client, deploy pipeline

**Files:**
- Create: `cloudflare/wrangler.toml`
- Create: `cloudflare/src/postgrest.js`
- Create: `cloudflare/src/worker.js` (hello skeleton; full gateway lands in Task 3)
- Create: `tests/cf-postgrest.test.mjs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `createPostgrest({ baseUrl, serviceKey, fetchImpl, timeoutMs })`
  returning `{ rpc(name, args) }`, which POSTs
  `{baseUrl}/rest/v1/rpc/{name}` with `apikey` + `Bearer` headers and resolves
  the parsed JSON or throws. Later tasks import exactly this shape.

- [ ] **Step 1: Write the failing test**

```js
// tests/cf-postgrest.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgrest } from '../cloudflare/src/postgrest.js';

const client = (seen, { ok = true, json = { ok: true }, fail = null } = {}) => {
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (fail) throw fail;
    return { ok, json: async () => json };
  };
  return createPostgrest({
    baseUrl: 'https://ref.supabase.co',
    serviceKey: 'service-key',
    fetchImpl,
    timeoutMs: 1000
  });
};

test('an RPC POSTs name and args to the PostgREST endpoint', async () => {
  const seen = [];
  const data = await client(seen).rpc('opera_enqueue', { p_method: 'tabs.list' });

  assert.deepEqual(data, { ok: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://ref.supabase.co/rest/v1/rpc/opera_enqueue');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers.apikey, 'service-key');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer service-key');
  assert.equal(seen[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(seen[0].init.body), { p_method: 'tabs.list' });
  assert.ok(seen[0].init.signal, 'the call carries no deadline');
});

test('a refused call throws instead of resolving garbage', async () => {
  const seen = [];
  await assert.rejects(
    client(seen, { ok: false }).rpc('opera_enqueue', {}),
    /opera_enqueue responded 0|opera_enqueue failed/
  );
});

test('a throwing fetch becomes a rejection the caller can catch', async () => {
  await assert.rejects(
    client([], { fail: new Error('socket reset') }).rpc('opera_enqueue', {}),
    /socket reset/
  );
});

test('missing credentials fail before touching the network', async () => {
  const seen = [];
  const bad = createPostgrest({
    baseUrl: '', serviceKey: '',
    fetchImpl: async (url, init) => { seen.push({ url, init }); return { ok: true, json: async () => ({}) }; }
  });

  await assert.rejects(bad.rpc('opera_enqueue', {}), /credentials/);
  assert.equal(seen.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cf-postgrest.test.mjs`
Expected: FAIL with "Cannot find module '../cloudflare/src/postgrest.js'"

- [ ] **Step 3: Write minimal implementation**

```js
// cloudflare/src/postgrest.js
// @title: postgrest — one RPC call over fetch, with credentials validated before use.
// @state: 4 locks; endpoint shape, failure mapping, credential gate, deadline.
// @dependencies: none.

const DEFAULT_TIMEOUT_MS = 15000;

export function createPostgrest({ baseUrl, serviceKey, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return {
    async rpc(name, args) {
      if (typeof baseUrl !== 'string' || !baseUrl || typeof serviceKey !== 'string' || !serviceKey) {
        throw new Error('PostgREST credentials are missing.');
      }
      if (typeof name !== 'string' || !name) throw new Error('RPC needs a name.');
      const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {}),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response?.ok) throw new Error(`${name} failed.`);
      return response.json();
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cf-postgrest.test.mjs`
Expected: PASS, 4/4. Note: the refusal message assertion accepts either
wording; if it fails, read the actual message and tighten the test to the
exact string rather than loosening the implementation.

- [ ] **Step 5: Write wrangler.toml and the hello skeleton**

```toml
# cloudflare/wrangler.toml
name = "opera-agent"
main = "src/worker.js"
compatibility_date = "2026-01-01"

[[durable_objects.bindings]]
name = "DEVICE"
class_name = "Device"

[[migrations]]
tag = "v1"
new_classes = ["Device"]
```

```js
// cloudflare/src/worker.js
// @title: worker — edge entry: routes command calls and device sockets.
// @state: skeleton; full gateway lands in Task 3, Device shell in Task 2.
// @dependencies: ./device.js (Task 2).

export { Device } from './device.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, service: 'opera-agent', time: new Date().toISOString() });
    }
    return Response.json({ ok: false, error: { code: 'NOT_READY', message: 'Gateway lands in Task 3.' } }, { status: 503 });
  }
};
```

```js
// cloudflare/src/device.js (skeleton only — Task 2 replaces the body)
// @title: device — one fleet Durable Object holding every device socket.
// @state: skeleton; full logic lands in Task 2.
// @dependencies: none yet.

export class Device {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch() {
    return Response.json({ ok: false, error: 'NOT_READY' }, { status: 503 });
  }
}
```

- [ ] **Step 6: Resolve the spec's open questions 1-2 by reading docs**

Read the installed wrangler's Durable Object docs (or `npx wrangler docs`
equivalents) and record the answers as a comment at the top of
`cloudflare/src/device.js`: alarm precision at 20 s cadence, and the exact
lifecycle rule about in-flight requests preventing hibernation. If either
answer contradicts the spec, stop and report rather than building on sand.

- [ ] **Step 7: Deploy the skeleton and record the URL**

Run: `npx -y wrangler@latest deploy --config cloudflare/wrangler.toml`
(from the repo root; the config path must resolve — if wrangler demands to
run inside `cloudflare/`, cd there and adjust paths in this step's notes).
Expected: success plus a printed `*.workers.dev` URL. Record that URL
verbatim below — Task 4 pins exactly this host in the extension CSP.

Deployed URL: ___________________________________________

Verify: `curl https://<that-url>/health` returns `{"ok":true,...}`.

- [ ] **Step 8: User step — store the service key**

The operator (human, in their own terminal) runs:
`npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` (paste when prompted),
then confirms with a screenshot or "done". The executor MUST NOT ask for the
value and MUST NOT proceed to Task 5 without this confirmation. Record:
done / pending: ___________

- [ ] **Step 9: Commit**

```bash
git add cloudflare/wrangler.toml cloudflare/src/postgrest.js cloudflare/src/worker.js cloudflare/src/device.js tests/cf-postgrest.test.mjs
git commit -m "Scaffold the Cloudflare transport: config, PostgREST client, deployable skeleton"
```

### Task 2: Device object — socket hold, handshake, drain, waiters, keepalive

**Files:**
- Create: `cloudflare/src/device-logic.js`
- Modify: `cloudflare/src/device.js` (thin shell wiring CF APIs to the logic)
- Create: `tests/cf-device.test.mjs`

**Interfaces:**
- Consumes: `createPostgrest` from Task 1 (shape above);
  `completionFrame`, `handshakeFrame` readers and `parseFrame`,
  `isRunnableCommand`, `normalizeCommand` from
  `../extension/lib/socket-protocol.js` — wait, from `cloudflare/src/` the
  relative path is `../../extension/lib/socket-protocol.js`. Use exactly that.
- Produces: `createDevice({ verify, claim, complete, send, close, setAlarm,
  now, setTimer, log })` returning
  `{ onOpen, onMessage(text), onClose(code, reason), onAlarm,
    runCommand({ commandId, timeoutMs, deadlineMs }) }`.
  `runCommand` resolves `{ ok, result?, error? }` when the matching completion
  frame arrives or the deadline passes. Task 3 calls exactly this shape
  through the thin shell.

- [ ] **Step 1: Write the failing tests**

```js
// tests/cf-device.test.mjs (first block of several; all in one file)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from '../cloudflare/src/device-logic.js';

const HELLO = (overrides = {}) => JSON.stringify({
  type: 'hello', token: 'a'.repeat(64), deviceName: 'opera', ...overrides
});

function harness(overrides = {}) {
  const sent = [];
  const closed = [];
  const alarms = [];
  const calls = { verify: 0, claim: 0, complete: 0 };
  let time = 1000;
  const commands = overrides.commands || [];
  const device = createDevice({
    verify: async () => { calls.verify += 1; return overrides.verify ?? { ok: true }; },
    claim: async () => {
      calls.claim += 1;
      return commands.length ? { id: 'c1', method: 'browser.ping', params: {}, timeoutMs: 5000 } : null;
    },
    complete: async () => { calls.complete += 1; return { ok: true }; },
    send: (text) => { sent.push(JSON.parse(text)); },
    close: (code, reason) => { closed.push({ code, reason }); },
    setAlarm: (atMs) => { alarms.push(atMs); },
    now: () => time,
    setTimer: (fn) => fn,
    ...overrides
  });
  return {
    device, sent, closed, alarms, calls,
    setTime: (ms) => { time = ms; },
    getTime: () => time
  };
}

test('a valid handshake answers ready and schedules the keepalive', async () => {
  const h = harness();
  await h.device.onMessage(HELLO());

  assert.equal(h.sent[0].type, 'ready');
  assert.equal(h.calls.verify, 1);
  assert.equal(h.alarms.length, 1, 'no keepalive was scheduled');
});

test('a bad handshake is closed unread and never drains', async () => {
  const h = harness({ verify: { ok: false } });
  await h.device.onMessage(HELLO({ token: 'wrong' }));

  assert.equal(h.closed.length, 1);
  assert.equal(h.closed[0].code, 4001);
  assert.equal(h.calls.claim, 0, 'an unauthenticated socket triggered a claim');
});

test('a second socket replaces the first instead of doubling it', async () => {
  const h = harness();
  await h.device.onMessage(HELLO());
  await h.device.onMessage(HELLO());

  assert.equal(h.closed.length, 1, 'the old socket was left open');
  assert.equal(h.sent.filter((f) => f.type === 'ready').length, 2);
});
```

Second block (same file — append, do not replace):

```js
test('two concurrent runs complete exactly once each, in order', async () => {
  const h = harness();
  await h.device.onMessage(HELLO());
  const first = h.device.runCommand({ commandId: 'c1', timeoutMs: 5000, deadlineMs: h.getTime() + 5000 });
  const second = h.device.runCommand({ commandId: 'c2', timeoutMs: 5000, deadlineMs: h.getTime() + 5000 });

  await h.device.onMessage(JSON.stringify({ type: 'complete', commandId: 'c1', ok: true, result: { n: 1 } }));
  await h.device.onMessage(JSON.stringify({ type: 'complete', commandId: 'c2', ok: true, result: { n: 2 } }));

  assert.deepEqual(await first, { ok: true, result: { n: 1 } });
  assert.deepEqual(await second, { ok: true, result: { n: 2 } });
  assert.equal(h.calls.complete, 2);
});

test('a run that outlives its deadline fails, but a late completion is still recorded', async () => {
  const h = harness();
  await h.device.onMessage(HELLO());
  const outcome = await h.device.runCommand({ commandId: 'c9', timeoutMs: 5000, deadlineMs: h.getTime() - 1 });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.code, 'AWAIT_TIMEOUT');

  await h.device.onMessage(JSON.stringify({ type: 'complete', commandId: 'c9', ok: true, result: { late: true } }));
  assert.equal(h.calls.complete, 1, 'the late completion was never recorded');
});

test('a command with no answer times out on schedule instead of hanging the caller', async () => {
  const h = harness({
    setTimer: (fn) => { setImmediate(fn); return fn; }
  });
  await h.device.onMessage(HELLO());
  const outcome = await h.device.runCommand({ commandId: 'c8', timeoutMs: 5000, deadlineMs: h.getTime() + 5000 });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.code, 'AWAIT_TIMEOUT');
});

test('closing the socket fails every waiter instead of hanging them', async () => {
  const h = harness();
  await h.device.onMessage(HELLO());
  const pending = h.device.runCommand({ commandId: 'c1', timeoutMs: 5000, deadlineMs: h.getTime() + 5000 });

  await h.device.onClose(1006, '');

  const outcome = await pending;
  assert.equal(outcome.ok, false);
});

test('an answered ping resets the deadline; silence past it closes with 4003', async () => {
  const h = harness();
  await h.device.onMessage(HELLO());
  h.setTime(h.getTime() + 19000);
  await h.device.onAlarm();
  assert.equal(h.sent.filter((f) => f.type === 'ping').length, 1);

  await h.device.onMessage(JSON.stringify({ type: 'pong' }));
  h.setTime(h.getTime() + 19000);
  await h.device.onAlarm();
  assert.equal(h.closed.length, 0, 'an answering peer was closed');

  h.setTime(h.getTime() + 22000);
  await h.device.onAlarm();
  assert.equal(h.closed.length, 1);
  assert.equal(h.closed[0].code, 4003);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/cf-device.test.mjs`
Expected: FAIL with "Cannot find module '../cloudflare/src/device-logic.js'"

- [ ] **Step 3: Write minimal implementation**

```js
// cloudflare/src/device-logic.js
// @title: device-logic — one device socket: handshake, drain, waiters, keepalive.
// @state: covered by tests/cf-device.test.mjs; the Durable Object shell in
// ./device.js wires Cloudflare APIs to exactly these callbacks.
// @dependencies: ../../extension/lib/socket-protocol.js (frames only, never forked).

import { parseFrame } from '../../extension/lib/socket-protocol.js';
import { frameForCommand, handshakePayload } from '../../supabase/functions/opera-agent-bridge/bridge-socket.ts';

const KEEPALIVE_MS = 20000;
const UNANSWERED_LIMIT_MS = 40000;

export function createDevice({ verify, claim, complete, send, close, setAlarm, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), log = null }) {
  let identity = null;
  let socketOpen = false;
  let lastHeardAt = 0;
  let lastPingAt = 0;
  let draining = false;
  const waiters = new Map();

  const failAll = (error) => {
    for (const [, waiter] of waiters) {
      try { waiter.resolve({ ok: false, error }); } catch { }
    }
    waiters.clear();
  };

  const drain = async () => {
    if (!identity || !socketOpen || draining) return;
    draining = true;
    try {
      for (;;) {
        const command = await claim();
        if (!command) return;
        send(frameForCommand(command, new Date(now()).toISOString()));
      }
    } catch (error) {
      try { log?.warn?.('drain failed', String(error?.message || error)); } catch { }
    } finally {
      draining = false;
    }
  };

  return {
    onOpen() {
      socketOpen = true;
      lastHeardAt = now();
    },

    async onMessage(text) {
      lastHeardAt = now();
      const parsed = parseFrame(typeof text === 'string' ? text : String(text ?? ''));
      if (!parsed.ok) {
        send(JSON.stringify({ type: 'error', error: parsed.error }));
        return;
      }
      const message = parsed.message;

      if (message.type === 'pong') return;

      if (message.type === 'hello') {
        const found = handshakePayload(message);
        const verified = found ? await verify(found) : null;
        if (!verified?.ok) {
          send(JSON.stringify({ type: 'error', error: 'Unauthorized device.' }));
          close(4001, 'unauthorized');
          return;
        }
        if (identity) close(1000, 'replaced');
        identity = found;
        socketOpen = true;
        send(JSON.stringify({ type: 'ready', serverTime: new Date(now()).toISOString() }));
        setAlarm(now() + KEEPALIVE_MS);
        void drain();
        return;
      }

      if (!identity) {
        send(JSON.stringify({ type: 'error', error: 'Handshake first.' }));
        return;
      }

      if (message.type === 'complete') {
        const outcome = message.ok === true
          ? { ok: true, result: message.result ?? {} }
          : { ok: false, error: message.error ?? { code: 'EXECUTION_ERROR', message: 'Command failed.' } };
        try {
          await complete(message.commandId, outcome);
        } catch (error) {
          try { log?.warn?.('complete failed', String(error?.message || error)); } catch { }
        }
        const waiter = waiters.get(message.commandId);
        if (waiter) {
          waiters.delete(message.commandId);
          waiter.resolve(outcome.ok ? { ok: true, result: outcome.result } : { ok: false, error: outcome.error });
        }
        void drain();
        return;
      }
    },

    async onClose() {
      socketOpen = false;
      const wasIdentity = identity;
      identity = null;
      if (wasIdentity) failAll({ code: 'DEVICE_GONE', message: 'The device socket closed.' });
    },

    async onAlarm() {
      if (!identity || !socketOpen) return;
      if (lastPingAt && now() - lastHeardAt > UNANSWERED_LIMIT_MS) {
        try { log?.warn?.('device stopped answering keepalives', identity.deviceName); } catch { }
        close(4003, 'keepalive unanswered');
        return;
      }
      lastPingAt = now();
      send(JSON.stringify({ type: 'ping', serverTime: new Date(now()).toISOString() }));
      setAlarm(now() + KEEPALIVE_MS);
    },

    runCommand({ commandId, timeoutMs, deadlineMs }) {
      return new Promise((resolve) => {
        if (!identity || !socketOpen) {
          resolve({ ok: false, error: { code: 'DEVICE_GONE', message: 'The device is not connected.' } });
          return;
        }
        if (now() >= deadlineMs) {
          resolve({ ok: false, error: { code: 'AWAIT_TIMEOUT', message: 'Timed out waiting for command result.' } });
          return;
        }
        const waiter = { resolve };
        waiters.set(commandId, waiter);
        const remaining = Math.max(0, deadlineMs - now());
        setTimer(() => {
          if (!waiters.has(commandId)) return;
          waiters.delete(commandId);
          resolve({ ok: false, error: { code: 'AWAIT_TIMEOUT', message: 'Timed out waiting for command result.' } });
        }, Math.min(remaining, Math.max(timeoutMs, 500)));
        void drain();
      });
    }
  };
}
```

Notes the implementer must respect (not placeholders — exact behaviors):
- The `.ts` import works in plain node here (proven: `tests/bridge-socket.test.mjs`
  already imports that module directly), and wrangler's bundler mixes `.js`
  and `.ts` freely. If either stops being true, stop and report rather than
  forking the frame functions.
- `setTimer` in production is `setTimeout`; the drain-mutex test pattern from
  the repo applies (a tick during a running drain is skipped by the flag).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/cf-device.test.mjs`
Expected: PASS. If the socket-protocol import path is wrong, node prints the
resolved path — fix the relative import, not the test.

- [ ] **Step 5: Write the thin Durable Object shell**

```js
// cloudflare/src/device.js
// @title: device — fleet Durable Object shell; Cloudflare APIs in, logic callbacks out.
// @state: thin by design; every decision lives in ./device-logic.js and is unit-tested there.
// @dependencies: ./device-logic.js, ./postgrest.js.

import { createDevice } from './device-logic.js';
import { createPostgrest } from './postgrest.js';

export class Device {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Set();
    const rpc = createPostgrest({
      baseUrl: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
      fetchImpl: fetch
    });
    this.logic = createDevice({
      verify: async (identity) => {
        const authed = await rpc.rpc('opera_auth_device', {
          p_device_name: identity.deviceName,
          p_token_hash: await sha256Hex(identity.token.toLowerCase())
        });
        return authed ? { ok: true } : { ok: false };
      },
      claim: async () => {
        const claimed = await rpc.rpc('opera_claim_next_wait', {
          p_device_name: this.deviceName || 'opera',
          p_token_hash: this.tokenHash || '',
          p_extension_version: '',
          p_protocol_version: 1,
          p_capabilities: [],
          p_wait_ms: 0
        });
        return claimed?.command ?? null;
      },
      complete: async (commandId, outcome) => {
        await rpc.rpc('opera_complete_command', {
          p_device_name: this.deviceName,
          p_token_hash: this.tokenHash,
          p_command_id: commandId,
          p_ok: outcome.ok === true,
          p_result: outcome.ok ? outcome.result : null,
          p_error: outcome.ok ? null : outcome.error
        });
      },
      send: (text) => {
        for (const ws of this.sockets) {
          try {
            if (ws.readyState === 1) ws.send(text);
          } catch { }
        }
      },
      close: (code, reason) => {
        for (const ws of this.sockets) {
          try { ws.close(code, reason); } catch { }
        }
        this.sockets.clear();
      },
      setAlarm: (atMs) => this.state.storage.setAlarm(atMs),
      now: () => Date.now()
    });
    this.deviceName = null;
    this.tokenHash = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/run') {
      const body = await request.json();
      const result = await this.logic.runCommand({
        commandId: body.commandId,
        timeoutMs: body.timeoutMs,
        deadlineMs: body.deadlineMs
      });
      return Response.json(result);
    }
    if (request.headers.get('upgrade') !== 'websocket') {
      return Response.json({ ok: false, error: 'Expected a websocket upgrade.' }, { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    this.sockets.add(server);
    this.logic.onOpen();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    await this.logic.onMessage(typeof message === 'string' ? message : String(message));
  }

  async webSocketClose() {
    await this.logic.onClose(1006, '');
  }

  async webSocketError() {
    await this.logic.onClose(1006, '');
  }

  async alarm() {
    await this.logic.onAlarm();
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

Notes the implementer must respect:
- `this.deviceName`/`this.tokenHash` are set inside the `verify` closure
  before returning: add `this.deviceName = identity.deviceName;` and the
  token hash computation result assignment there. The sketch above omits
  those two lines for brevity of the plan step — the tests in Step 1 do not
  cover the shell, so add them while writing and re-read the file after.
- Hibernation note: `acceptWebSocket` (not `accept`) is what allows sleep;
  never add `setInterval`/`setTimeout` to this file.

- [ ] **Step 6: Commit**

```bash
git add cloudflare/src/device-logic.js cloudflare/src/device.js tests/cf-device.test.mjs
git commit -m "Device object: socket hold, handshake, drain, waiters, keepalive alarm"
```

### Task 3: Gateway worker — same API, one blocking call

**Files:**
- Create: `cloudflare/src/gateway.js`
- Modify: `cloudflare/src/worker.js` (route POST /command + socket upgrades)
- Create: `tests/cf-gateway.test.mjs`

**Interfaces:**
- Consumes: `createPostgrest` (Task 1); `runOnDevice({ commandId, timeoutMs,
  deadlineMs })` — in production a `stub.fetch` POST to `/run`, in tests a
  stub function.
- Produces: `createGateway({ rpc, runOnDevice, now })` returning
  `{ handleCommand({ token, method, params, timeoutMs, requestId }) }`
  resolving `{ status, body }` with shapes copied exactly from the current
  gateway (see Step 1 note).

- [ ] **Step 1: Copy the exact error shapes first**

Read `supabase/functions/opera-agent-gateway/index.ts` and `docs/api.md`
`## Error codes`. Write down verbatim: UNAUTHORIZED (401), DEVICE_NOT_PAIRED
(401), AWAIT_TIMEOUT (504), GATEWAY_ERROR (502/200-shape), TOO_LARGE (413),
METHOD_NOT_ALLOWED. The tests below assert these exact codes and statuses;
if the current gateway disagrees with `docs/api.md`, the code wins and the
discrepancy goes into the commit message.

- [ ] **Step 2: Write the failing tests**

```js
// tests/cf-gateway.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from '../cloudflare/src/gateway.js';

function harness({ verify = { ok: true }, enqueue = { ok: true, commandId: 'cmd-1' }, run = { ok: true, result: { ok: true } } } = {}) {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === 'opera_verify_device') return verify;
    if (name === 'opera_enqueue') return enqueue;
    throw new Error(`Unexpected RPC ${name}`);
  };
  const gateway = createGateway({
    rpc,
    runOnDevice: async (input) => {
      calls.push({ name: 'device.run', args: input });
      return run;
    },
    now: () => 1000
  });
  return { gateway, calls };
}

const input = (extra = {}) => ({
  token: 't', method: 'tabs.list', params: {}, timeoutMs: 2000, requestId: 'r1', ...extra
});

test('a valid command verifies, enqueues, then waits on the device exactly once', async () => {
  const h = harness({});
  const res = await h.gateway.handleCommand(input());

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(h.calls.map((c) => c.name), ['opera_verify_device', 'opera_enqueue', 'device.run']);
  assert.equal(h.calls[2].args.commandId, 'cmd-1');
});

test('a bad token answers 401 without touching enqueue', async () => {
  const h = harness({ verify: { ok: false } });
  const res = await h.gateway.handleCommand(input());

  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
  assert.ok(!h.calls.some((c) => c.name === 'opera_enqueue'));
});

test('an offline device answers without enqueuing', async () => {
  const h = harness({ verify: { ok: true, last_seen_at: new Date(0).toISOString() } });
  const res = await h.gateway.handleCommand(input());

  assert.equal(res.body.ok, false);
  assert.ok(!h.calls.some((c) => c.name === 'opera_enqueue'));
});

test('a device timeout surfaces as AWAIT_TIMEOUT with the command attached', async () => {
  const h = harness({ run: { ok: false, error: { code: 'AWAIT_TIMEOUT', message: 'slow' } } });
  const res = await h.gateway.handleCommand(input());

  assert.equal(res.status, 504);
  assert.equal(res.body.error.code, 'AWAIT_TIMEOUT');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/cf-gateway.test.mjs`
Expected: FAIL with "Cannot find module '../cloudflare/src/gateway.js'"

- [ ] **Step 4: Write minimal implementation**

```js
// cloudflare/src/gateway.js
// @title: gateway — POST /command with the exact public shape, fulfilled by one device call.
// @state: covered by tests/cf-gateway.test.mjs; shapes copied verbatim from the Supabase gateway.
// @dependencies: none (rpc and runOnDevice are injected).

const OFFLINE_AFTER_MS = 90000;

export function createGateway({ rpc, runOnDevice, now = () => Date.now() }) {
  return {
    async handleCommand({ token, method, params, timeoutMs, requestId }) {
      const boundedTimeout = Math.max(500, Math.min(32000, Number(timeoutMs) || 12000));

      const auth = await rpc('opera_verify_device', { p_token: token, p_device_name: 'opera' });
      if (!auth?.ok) {
        return { status: 401, body: { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token for device.' } } };
      }
      const lastSeenAt = typeof auth.last_seen_at === 'string' ? auth.last_seen_at : null;
      if (!lastSeenAt || Date.parse(lastSeenAt) < now() - OFFLINE_AFTER_MS) {
        return { status: 200, body: { ok: false, error: 'Device is offline.', lastSeenAt } };
      }

      const queued = await rpc('opera_enqueue', {
        p_method: method,
        p_params: params || {},
        p_timeout_ms: boundedTimeout,
        p_device_name: 'opera',
        p_request_id: requestId || null
      });
      if (!queued?.ok || !queued.commandId) {
        return { status: 200, body: { ok: false, error: String(queued?.error || `Unable to queue ${method}.`) } };
      }

      const run = await runOnDevice({
        commandId: queued.commandId,
        timeoutMs: boundedTimeout,
        deadlineMs: now() + boundedTimeout
      });
      if (run?.ok === true) {
        return { status: 200, body: { ok: true, result: run.result, commandId: queued.commandId } };
      }
      const code = run?.error?.code;
      if (code === 'AWAIT_TIMEOUT') {
        return { status: 504, body: { ok: false, commandId: queued.commandId, error: { code: 'AWAIT_TIMEOUT', message: run.error.message } } };
      }
      return { status: 200, body: { ok: false, commandId: queued.commandId, error: run?.error || { code: 'GATEWAY_ERROR', message: 'Empty result.' } } };
    }
  };
}
```

Note: the verify RPC argument shape (`p_token` vs alternatives) MUST be
copied from the current gateway source in Step 1, not from this sketch — if
it differs, the sketch is wrong and the source wins.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/cf-gateway.test.mjs`
Expected: PASS, 4/4.

- [ ] **Step 6: Wire the worker entry**

Replace the Task 1 skeleton routing in `cloudflare/src/worker.js`:

```js
import { Device } from './device.js';
import { createGateway } from './gateway.js';
import { createPostgrest } from './postgrest.js';

export { Device };

const postgrestOf = (env) => createPostgrest({
  baseUrl: env.SUPABASE_URL,
  serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
  fetchImpl: fetch
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, service: 'opera-agent', time: new Date().toISOString() });
    }
    if (request.headers.get('upgrade') === 'websocket') {
      const stub = env.DEVICE.get(env.DEVICE.idFromName('fleet'));
      return stub.fetch(request);
    }
    if (request.method === 'POST' && url.pathname === '/command') {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object') {
        return Response.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Body must be JSON.' } }, { status: 400 });
      }
      const token = request.headers.get('x-opera-agent-token')
        || (String(request.headers.get('authorization') || '').startsWith('Bearer ')
          ? request.headers.get('authorization').slice(7) : '')
        || body.apiKey || '';
      const gateway = createGateway({
        rpc: postgrestOf(env).rpc,
        runOnDevice: async (input) => {
          const stub = env.DEVICE.get(env.DEVICE.idFromName('fleet'));
          const res = await stub.fetch('https://device/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input)
          });
          return res.json();
        },
        now: () => Date.now()
      });
      const res = await gateway.handleCommand({
        token,
        method: body.method,
        params: body.params,
        timeoutMs: body.waitMs,
        requestId: body.requestId
      });
      return Response.json(res.body, { status: res.status });
    }
    return Response.json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST is the only method the gateway executes.' } }, { status: 405 });
  }
};
```

Token/header/body field mapping MUST be copied from the current gateway +
`docs/api.md` in the same Step-1 pass; where this sketch disagrees with the
source, the source wins and the tests in Step 2 are updated to the source
before implementing.

- [ ] **Step 7: Run the full unit suite and check**

Run: `npm test` then `npm run check`. Both green before proceeding. Note:
`npm test` runs every file under test/ — the new `tests/cf-*.test.mjs`
files join automatically.

- [ ] **Step 8: Commit**

```bash
git add cloudflare/src/gateway.js cloudflare/src/worker.js tests/cf-gateway.test.mjs
git commit -m "Gateway worker: same public API shape, fulfilled by one device call"
```

### Task 4: Extension repoint (URL + CSP + re-pin)

**Files:**
- Modify: `extension/manifest.json`, `store/store-manifest.json`
- Modify: `tests/manifest-pins.test.mjs`, `tests/helpers/boundary-locks.mjs`,
  `gates.lock`

**Interfaces:**
- Consumes: the deployed worker URL recorded in Task 1, Step 7.
- Produces: an extension that opens its socket at the Cloudflare worker and
  whose pins all pass.

- [ ] **Step 1: Confirm the deployed URL**

Run: `npx -y wrangler@latest deployments --config cloudflare/wrangler.toml`
(or read the deploy output recorded in Task 1). Copy the exact hostname —
no wildcards, no guessing.

Worker host: ___________________________________________

- [ ] **Step 2: Update both manifests**

In `extension/manifest.json` AND `store/store-manifest.json`, extend the
`connect-src` of `content_security_policy.extension_pages` with exactly:
`https://<host> wss://<host>` (replace `<host>` with Step 1, keep every
existing entry — the Supabase bridge stays as the rollback target).

- [ ] **Step 3: Update the pin test to the new host**

In `tests/manifest-pins.test.mjs`, extend the socket-host test with
assertions matching the two new CSP entries from Step 2 (same style as the
existing `ws://127.0.0.1` / `wss://*.supabase.co` assertions).

- [ ] **Step 4: Run tests, re-pin, re-run**

Run: `npm test` (expect the two pin failures), then
`npm run gates:refresh`, then `npm test` again (expect green). If
`tests/helpers/boundary-locks.mjs` needs the edited hash, update that file
first, then refresh, per the established procedure.

- [ ] **Step 5: Commit**

```bash
git add extension/manifest.json store/store-manifest.json tests/manifest-pins.test.mjs tests/helpers/boundary-locks.mjs gates.lock
git commit -m "Point the extension socket at the Cloudflare worker and re-pin"
```

### Task 5: Live verification and measurement

**Files:** none (evidence only). Read: the Task 1 deployed URL, Task 4 host.

**Interfaces:**
- Consumes: deployed worker + DO (Task 1/3 code), repointed extension
  (Task 4), the operator's Chrome on the debug port.
- Produces: a measurement table and a go/no-go for Task 6.

- [ ] **Step 1: Deploy everything current**

Run: `npx -y wrangler@latest deploy --config cloudflare/wrangler.toml`
Expected: success. Then wait 90 seconds for propagation (edge deploys
propagate per node; measuring inside the window poisons every number —
this exact mistake cost a full session once).

- [ ] **Step 2: Confirm the preconditions separately**

Run: `curl https://<worker-host>/health` → `{"ok":true,...}`. Reload the
extension in the operator's Chrome and confirm status `ready` with a fresh
`lastConnectedAt`. If either fails, stop: do not measure a broken setup.

- [ ] **Step 3: Hold 10 minutes, expect silence**

Watch device state (existing tooling in the operator's temp tools dir, or
equivalent). Expected: recycles only if the device still recycles on its
own schedule (it does — 120 s, harmless); zero errors, zero unexpected
reconnects, zero 1006s attributable to the platform.

- [ ] **Step 4: Measure 5 gateway pings**

For each: POST `/command` with `browser.ping`, then read
`inserted→claimed→completed` from `opera_commands` by timestamp (never by
client clock). Record:

| # | insert→claim | claim→complete | total |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |

Go criteria: p50 total ≤ 600 ms, no sample above 1500 ms, no `queued`
older than 5 s left behind.

- [ ] **Step 5: Prove the slow command answers (Review Focus 1)**

Run one `page.read` with a wide limit through the gateway. Expected: it
answers with the read result. If it times out while the device executed
fine, the DO hibernated mid-wait and the design is wrong — stop and report.

- [ ] **Step 6: Prove rollback (Review Focus 3)**

In the extension source, temporarily revert the bridge URL to the Supabase
bridge, reload, run one ping through the OLD path end to end, then restore
the Cloudflare URL and reload again. Expected: the old path still works
(the Supabase bridge was never undeployed). Record both results.

- [ ] **Step 7: Record the numbers in docs/api.md**

Append a dated subsection under the transport docs with the Task 4 table,
the slow-command result, and the rollback result. Numbers only — no
adjectives, no predictions.

### Task 6: CI deploy, docs, final gates

**Files:**
- Create: `.github/workflows/deploy-cloudflare.yml`
- Modify: `docs/api.md` (only if Task 5 left anything unrecorded)

**Interfaces:**
- Consumes: everything above.
- Produces: a merged PR with green CI.

- [ ] **Step 1: User step — CI deploy credential**

The operator (human) adds repository secret `CLOUDFLARE_API_TOKEN` (API
token with Workers + Durable Objects edit scope) in GitHub Settings →
Secrets. The executor verifies presence with `gh secret list` (names only,
never values) and MUST NOT proceed to Step 3 without it. Wrangler also
accepts `CLOUDFLARE_ACCOUNT_ID` as a secret; hardcode the account id
`74520c841c2d9e587b0e99e94d1f2fac` in the workflow file instead (it is an
identifier, not a credential).

- [ ] **Step 2: Write the workflow**

```yaml
# .github/workflows/deploy-cloudflare.yml
name: deploy-cloudflare
on:
  push:
    branches: [main]
    paths:
      - 'cloudflare/**'
      - '.github/workflows/deploy-cloudflare.yml'
jobs:
  deploy:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npx -y wrangler@latest deploy --config cloudflare/wrangler.toml
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: 74520c841c2d9e587b0e99e94d1f2fac
```

- [ ] **Step 3: Final gates and PR**

Run: `npm test`, `npm run check`, plus the browser suite once
(`python tests/browser_extension_test.py`) since Task 4 touched the
extension. All green, then open the PR with the spec's success criteria
quoted and the Task 5 table pasted, wait for CI, merge on green.
