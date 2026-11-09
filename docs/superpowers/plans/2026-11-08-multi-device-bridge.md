# Multi-Device Loopback Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the loopback bridge carry several browsers at once, so a second browser is not rejected and a proof run can drive its own Chrome beside the everyday one.

**Architecture:** The bridge keeps one socket per device instead of one socket total, namespaces each device's CDP target ids numerically, and routes every command to the device that owns the target. The device identity becomes per browser, so the pairing no longer collides when two browsers present the same device name.

**Tech Stack:** Node 20+ ESM, Chrome DevTools Protocol over a loopback WebSocket, `node:test`, Supabase edge functions for the cloud bridge and the pairing.

**Specs:** `docs/superpowers/specs/2026-11-08-installable-mcp-design.md` (the local road is the bridge) and `docs/superpowers/specs/2026-11-08-plans-and-tiers-design.md` (the quota is metered in the loopback bridge).

**Why now:** with the extension in two browsers, one of them is rejected by the pairing and the two extensions fight over the single device slot the bridge allows.

## Global Constraints

- The bridge is the only road for a local drive; the debugging port stays gone.
- Target ids stay numeric: the driver calls `Number(targetId)`, so a namespaced id must still parse as a number.
- Every command reaches the device that owns its target; a command with no target goes to the first device that is ready.
- The device identity is per browser, so two browsers never present the same name to the pairing.
- The cloud bridge and the pairing keep their current shapes; the identity change is additive.
- Headers on every touched file; comments above declarations, one line, no `// WHY` blocks.
- Gates: `npm test`, `npm run check`, `py tests/browser_extension_test.py`; re-pins only through `npm run gates:refresh`.

## Review Focus

- Two browsers on one machine: both extensions stay connected, and each bridge target names the browser it belongs to.
- A command for a target of the second browser: it must reach the second device, never the first.
- A target id that is parsed as a number: the namespaced id must still be one, and must still resolve.
- A device that disconnects mid-command: only its own in-flight commands may fail.
- A browser that presents the same device name twice: the pairing must tell them apart instead of rejecting one.

---

### Task 1: The bridge carries several devices

**Files:**
- Modify: `local/bridge-ws.js`
- Test: `tests/local-bridge.test.mjs` (extend)

**Interfaces:**
- Produces: `devices` becomes a map of `deviceId -> {id, socket, handshaken, connectedAt, lastHeardAt, targets}`; `attach()` no longer closes the previous socket; `/health` reports `linked`, `devices` and the device ids.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

A test opens two fake device sockets against one bridge server and asserts both stay connected, that `/health` names both, and that neither connection evicted the other.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/local-bridge.test.mjs`
Expected: FAIL — the second connection closes the first.

- [ ] **Step 3: Implement**

Replace the single `socket` with a map of devices; give every handler its own device (`next.on('text')` writes back to that device's socket, not to a shared one); let `attach()` keep the previous socket; report the devices in `/health`.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/local-bridge.test.mjs` and `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add local/bridge-ws.js tests/local-bridge.test.mjs
git commit -m "Let the loopback bridge carry every browser that connects to it"
```

---

### Task 2: Targets are namespaced, and commands find their device

**Files:**
- Modify: `local/bridge-ws.js`, `local/bridge.js`, `local/driver.js`
- Test: `tests/local-bridge.test.mjs` (extend), `tests/local-transport-target.test.mjs` (extend)

**Interfaces:**
- Produces: `listBridgeTargets()` returns the targets of every device, each id namespaced numerically (`deviceSlot * 1000 + targetId`, with the slot counted from one); `command()` routes a command carrying a target id to that device and a command without one to the first ready device.
- Consumes: Task 1's device map.

- [ ] **Step 1: Write the failing test**

Two devices each report a target id `1`; the bridge must hand out two different numeric ids, and a command naming the second one must reach the second socket.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/local-bridge.test.mjs`
Expected: FAIL — the bridge answers with one target and routes everything to one device.

- [ ] **Step 3: Implement**

The bridge asks every ready device for its targets, remembers which device owns which id, and hands out `slot * 1000 + id`; the driver keeps parsing the id as a number and the bridge strips the slot before it reaches the device.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/local-bridge.test.mjs tests/local-transport-target.test.mjs` and `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add local tests
git commit -m "Name every device's targets apart, and send each command to the browser that owns it"
```

---

### Task 3: The device identity is per browser

**Files:**
- Modify: `extension/worker/bridge-link.js`, `extension/lib/protocol.js`, `supabase/functions/opera-agent-bridge/bridge-socket.ts`, `supabase/functions/opera-agent-bridge/index.ts`
- Test: `tests/bridge-socket.test.mjs` (extend), `tests/local-bridge.test.mjs` (extend)

**Interfaces:**
- Produces: the extension presents a device id that is unique per browser (a value it generates and keeps), so the pairing and the cloud bridge tell two browsers apart.
- Consumes: the handshake frame the bridge already reads.

- [ ] **Step 1: Write the failing test**

Two devices with the same name and different ids are both accepted and both listed; a device that presents an id another device already holds is refused.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bridge-socket.test.mjs`
Expected: FAIL — the bridge still matches on the name alone.

- [ ] **Step 3: Implement**

The extension generates a per-browser id once and sends it with the handshake; the bridge and the pairing accept it alongside the name; the cloud bridge keeps both.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/bridge-socket.test.mjs` and `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension supabase tests
git commit -m "Tell two browsers apart, so the second one is a device and not a rejection"
```

---

### Task 4: The proof drives its own browser beside the everyday one

**Files:**
- Modify: `scripts/proof-run.mjs`, `scripts/extension-run.mjs`, `scripts/latency-benchmark.mjs`
- Test: `tests/proof-run.test.mjs`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: the proof launches a Chrome with the extension, joins the bridge as a second device, and drives its own tab while the everyday browser stays connected.

- [ ] **Step 1: Write the failing test**

The proof's own mode must leave the everyday browser's device connected and still read its own portal tab.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-timeout=300000 tests/proof-run.test.mjs`
Expected: FAIL — the proof times out, because its Chrome joins the everyday browser's bridge.

- [ ] **Step 3: Implement**

The proof waits for its own device on the bridge, selects the target that belongs to it, and closes only its own browser when the run ends.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test --test-timeout=300000 tests/proof-run.test.mjs` and `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts tests
git commit -m "Let the proof drive its own browser beside the everyday one"
```

---

## Self-Review

- **Spec coverage:** the metered local road (Tasks 1-2), the per-device quota door (Task 1), the rejected second browser (Task 3), and the proof that proves the shipped extension (Task 4).
- **Type consistency:** the device map is the same shape everywhere; a target id is numeric in the driver and in the bridge; the device id is a string on the wire.
- **Review Focus:** two browsers (Task 1), routing (Task 2), numeric ids (Task 2), one device leaving (Task 1), and the same name twice (Task 3).