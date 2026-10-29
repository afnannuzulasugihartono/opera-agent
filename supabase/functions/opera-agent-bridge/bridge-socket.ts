// @last-edited: 2026-10-13 UTC+7.
// @title: bridge-socket — one persistent socket per device: commands are pushed, completions ride back on it.
// @state: 8 locks; upgrade, handshake, push-on-insert, and completions riding back the same socket.
// @dependencies: ./index.ts helpers via injection.

// WHY THIS FILE EXISTS

// The device used to learn about work by asking.
// It POSTed /pull, which blocked inside Postgres on opera_claim_next_wait, then POSTed /complete, which the model waited on.
// Two full network round trips per action, and measured on this machine that was 734 ms for a burst whose actual browser work was 238 ms. Sixty-eight percent of the time was transport.

// A game does not ask what changed.
// It holds a socket and is told.
// So the device holds one socket, the bridge pushes a command the moment it is enqueued, and the completion travels back over the same socket.
// Nothing on the hot path polls.

// WHY the socket carries the same auth as the HTTP actions.
// A device that could open a socket must not be more trusted than one that can only poll, so the handshake verifies the same token hash and the same device name the pull path already verifies, and a socket that fails the handshake is closed unread.

// WHY the handshake timer is answered by arrival and the verify carries its own budget.
// The timer used to guard state.ready, but verification awaits an RPC plus a direct database connect that allows ten seconds on its own, so a cold isolate answered valid devices with "Handshake timeout", closed them with 4002, and then kept verifying into the closed socket on every reconnect.
// Arrival answers the first question; thirty seconds bounds the second, still far under the platform wall clock.

const HANDSHAKE_TIMEOUT_MS = 8000;
const VERIFY_TIMEOUT_MS = 30000;

// WHY the cap is a megabyte.
// Results up to MAX_RESULT_BYTES (512 KiB, owned by extension/lib/serialize.js) are legal product output, and a completion carries one.
// A transport cap below that refuses legal results — observed live as "Frame too large" killing a page.read the product explicitly allows, which stranded the command as claimed forever with no recovery.
// Stated here rather than imported because the edge bundle cannot reach outside its own directory; a test asserts the relation still holds.

export const MAX_FRAME_BYTES = 1024 * 1024;

// WHY the decompressed cap is separate from the frame cap.
// A 40-byte gzip bomb expands to gigabytes, so bounding the wire bytes bounds nothing.
// Eight megabytes clears the largest legal completion sixteen times over and still fits comfortably in an isolate's memory next to everything else it holds.

export const MAX_DECOMPRESSED_BYTES = 8 * 1024 * 1024;

const GZIP_FRAME_VERSION = 1;

// WHY the pump carries a no-op catch the moment it starts.
// On garbage input the reader rejects, and if the writer already threw first nothing awaits the pump anymore — leaving that rejection unhandled, which outlives the test and fails the file.
// The catch marks it handled; the await below still surfaces whatever the pump decided whenever it is reached.

async function gunzipCapped(
  bytes,
  maxBytes
) {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  const pump = (async () => {
    for (;;) {
      const {
        done,
        value
      } = await reader.read();
      if (done) return true;
      total += value.length;
      if (total > maxBytes) return false;
      chunks.push(value);
    }
  })();
  pump.catch(() => false);
  await writer.write(bytes);
  await writer.close();
  if (!await pump) return null;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(out);
}

async function bytesOf(raw) {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (typeof Blob !== 'undefined' && raw instanceof Blob) {
    if (raw.size > MAX_FRAME_BYTES + 1) return null;
    return new Uint8Array(await raw.arrayBuffer());
  }
  return null;
}

export async function parseDeviceFrame(
  raw,
  maxBytes = MAX_FRAME_BYTES,
  maxDecompressed = MAX_DECOMPRESSED_BYTES
) {
  if (typeof raw === 'string') {
    if (raw.length > maxBytes) return {
      ok: false,
      error: 'Frame too large.'
    };
    return parseTextFrame(raw);
  }

  const bytes = await bytesOf(raw);
  if (!bytes) return {
    ok: false,
    error: 'Frame must be text or binary.'
  };
  if (bytes.length > maxBytes + 1) return {
    ok: false,
    error: 'Frame too large.'
  };
  if (bytes.length < 2 || bytes[0] !== GZIP_FRAME_VERSION) {
    return {
      ok: false,
      error: 'Unknown binary frame.'
    };
  }

  let text;
  try {
    text = await gunzipCapped(bytes.slice(1), maxDecompressed);
  } catch {
    return {
      ok: false,
      error: 'Frame is not valid gzip.'
    };
  }
  if (text === null) return {
    ok: false,
    error: 'Frame too large.'
  };
  return parseTextFrame(text);
}

function parseTextFrame(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: 'Frame must be JSON.'
    };
  }
  if (!message || typeof message.type !== 'string') return {
    ok: false,
    error: 'Frame needs a type.'
  };
  return {
    ok: true,
    message
  };
}
export const KEEPALIVE_MS = 20000;

// WHY a keepalive exists, and why it is not polling.
// An MV3 service worker with a silent WebSocket is an idle service worker, and Chrome ends idle workers after thirty seconds.
// Observed against the deployed bridge: the device connected, reported ready, and was closed with "signal is aborted without reason" about every thirty seconds after.
// Nothing was refused; the worker simply stopped existing, taking its socket with it.

// A frame on a timer asks nothing and waits for nothing, which is the whole difference from the /pull loop this transport replaced.
// It exists because an arriving message is what resets the worker timer, and because a peer that has gone away should be noticed rather than written to forever.

// WHY twenty seconds.
// The worker dies at thirty, so the interval has to be comfortably inside it; twenty leaves a full missed frame of slack before a slow or delayed delivery is enough to lose the device.

export function frameForKeepalive(serverTime) {
  return JSON.stringify({
    type: "ping",
    serverTime
  });
}

// WHY an unanswered ping closes the socket rather than being retried.
// A socket that looks open and is not is worse than one that is closed: the device sits connected, every health signal reads fine, and no command ever arrives.
// That is not hypothetical.
// Observed live against this bridge, a device socket held for twenty minutes across an edge instance being replaced, still receiving pings, with a change subscription that had died with the old instance.

// WHY one tick of slack.
// Closing on the first missing answer would drop healthy sockets whenever a reply is merely late, which trades a rare silent hang for a routine reconnect.
// Waiting one tick means a peer has to miss a full interval before it is declared gone.

export function keepaliveDecision(counts) {
  if (counts.pings === 0) return "wait";
  if (counts.pings > counts.pongs) return "close";
  return "wait";
}

// Dependencies are injected so the protocol is testable without a socket, a database, or a browser, and so the channel opens only after auth: a socket that has not proven its token never receives another device's command.

export function isUpgradeRequest(req) {
  const upgrade = req.headers.get("upgrade");
  return Boolean(upgrade && upgrade.toLowerCase() === "websocket");
}

// WHY the token travels in the first frame rather than a header.
// A service worker cannot set arbitrary headers on a WebSocket handshake, and the alternative, a query parameter, puts a credential into every access log on the path.

export function handshakePayload(message) {
  if (!message || typeof message !== "object") return null;
  const token = typeof message.token === "string" ? message.token.trim() : "";
  const deviceName = typeof message.deviceName === "string" ? message.deviceName.trim() : "";
  if (!token || !deviceName) return null;
  return {
    token,
    deviceName
  };
}

export function frameForCommand(
  command,
  serverTime
) {
  return JSON.stringify({
    type: "command",
    command: {
      id: command.id,
      method: command.method,
      params: command.params ?? {},
      timeoutMs: command.timeoutMs ?? 30000
    },
    serverTime
  });
}

// WHY the runtime is told to wait.
// After the upgrade response is returned, the HTTP request is considered complete, and with no unresolved waitUntil work the isolate looks idle and is retired early — documented as EarlyDrop, observed here as every device socket dying with code 1006 at a consistent seventy-some seconds.
// Keeping one promise pending until the socket closes is what tells the supervisor this worker is still doing its job.

// WHY the guard.
// This module is imported directly by unit tests, where there is no EdgeRuntime at all.
// A bare reference would throw on import and take down the whole suite for a symbol that only exists on the platform.

// WHY the protocol idle timeout is disabled.
// Deno closes a socket whose peer misses a protocol-level pong, and not every client answers those: observed live, a healthy probe was closed with "No response from ping frame".
// Liveness here is decided one layer up, where an unanswered application ping closes the socket with 4003 — a verdict with a reason, rather than a transport guess.

export function serveDeviceSocket(
  req,
  {
    verifyDevice,
    complete,
    subscribe,
    log,
    handshakeTimeoutMs = HANDSHAKE_TIMEOUT_MS,
    verifyTimeoutMs = VERIFY_TIMEOUT_MS
  }
) {
  const upgrade = isUpgradeRequest(req);
  if (!upgrade) return {
    upgraded: false,
    response: null
  };

  const {
    socket,
    response
  } = Deno.upgradeWebSocket(req, { idleTimeout: 0 });

  const state = {
    ready: false,
    identity: null
  };
  const counts = {
    pings: 0,
    pongs: 0
  };
  let unsubscribe = null;

  let resolveClosed = null;
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
    const closed = new Promise((resolve) => {
      resolveClosed = resolve;
    });
    EdgeRuntime.waitUntil(closed);
  }
  let handshakeTimer = null;
  let keepaliveTimer = null;

  const disarmHandshake = () => {
    if (handshakeTimer) clearTimeout(handshakeTimer);
    handshakeTimer = null;
  };

  const timeOutHandshake = () => {
    if (!state.ready) {
      socket.send(JSON.stringify({
        type: "error",
        error: "Handshake timeout."
      }));
      socket.close(4002, "handshake timeout");
    }
  };

  const teardown = () => {
    disarmHandshake();
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    keepaliveTimer = null;
    if (typeof unsubscribe === "function") {
      try {
        unsubscribe();
      } catch {}
      unsubscribe = null;
    }
    if (resolveClosed) {
      const done = resolveClosed;
      resolveClosed = null;
      done();
    }
  };

  const sendCommand = (command) => {
    if (!state.ready || socket.readyState !== WebSocket.OPEN) return;
    socket.send(frameForCommand(command, new Date().toISOString()));
  };

  const dispatch = async (message) => {
    if (message.type === "pong") {
      counts.pongs += 1;
      return;
    }

    if (message.type === "hello") {
      disarmHandshake();
      const identity = handshakePayload(message);
      if (!identity) {
        socket.send(JSON.stringify({
          type: "error",
          error: "Handshake needs token and deviceName."
        }));
        socket.close(4001, "unauthorized");
        return;
      }
      handshakeTimer = setTimeout(timeOutHandshake, verifyTimeoutMs);
      const verified = await verifyDevice(identity);
      if (!verified?.ok) {
        disarmHandshake();
        socket.send(JSON.stringify({
          type: "error",
          error: "Unauthorized device."
        }));
        socket.close(4001, "unauthorized");
        return;
      }
      disarmHandshake();
      state.ready = true;
      state.identity = identity;
      socket.send(JSON.stringify({
        type: "ready",
        serverTime: new Date().toISOString()
      }));
      log?.info?.("bridge socket ready", identity.deviceName);

      unsubscribe = subscribe(identity, sendCommand);

      keepaliveTimer = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (keepaliveDecision(counts) === "close") {
          log?.warn?.("device stopped answering keepalives", identity.deviceName);
          teardown();
          socket.close(4003, "keepalive unanswered");
          return;
        }
        counts.pings += 1;
        try {
          socket.send(frameForKeepalive(new Date().toISOString()));
        } catch {
          teardown();
          return;
        }
      }, KEEPALIVE_MS);

      return;
    }

    if (message.type === "complete") {
      if (!state.ready) {
        socket.send(JSON.stringify({
          type: "error",
          error: "Handshake first."
        }));
        return;
      }
      const result = await complete({
        ...state.identity,
        ...message
      });
      socket.send(JSON.stringify({
        type: "ack",
        commandId: message.commandId ?? null,
        result
      }));
    }
  };

  socket.onopen = () => {
    handshakeTimer = setTimeout(timeOutHandshake, handshakeTimeoutMs);
  };

  socket.onmessage = async (event) => {
    const parsed = await parseDeviceFrame(event.data);
    if (!parsed.ok) {
      socket.send(JSON.stringify({
        type: "error",
        error: parsed.error
      }));
      return;
    }
    try {
      await dispatch(parsed.message);
    } catch (error) {
      log?.error?.("bridge socket dispatch failed", String(error?.message || error));
      socket.send(JSON.stringify({
        type: "error",
        error: "Dispatch failed."
      }));
    }
  };

  socket.onclose = () => {
    teardown();
  };
  socket.onerror = () => {
    teardown();
  };

  return {
    upgraded: true,
    response,
    socket
  };
}
