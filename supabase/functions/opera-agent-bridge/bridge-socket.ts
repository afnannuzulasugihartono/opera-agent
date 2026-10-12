// @last-edited: 2026-10-11 UTC+7.
// @title: bridge-socket — one persistent socket per device: commands are pushed, completions ride back on it.
// @state: 8 locks; upgrade, handshake, push-on-insert, and completions riding back the same socket.
// @dependencies: ./index.ts helpers via injection.
//
// WHY THIS FILE EXISTS
//
// The device used to learn about work by asking. It POSTed /pull, which blocked
// inside Postgres on opera_claim_next_wait, then POSTed /complete, which the model
// waited on. Two full network round trips per action, and measured on this machine
// that was 734 ms for a burst whose actual browser work was 238 ms. Sixty-eight
// percent of the time was transport.
//
// A game does not ask what changed. It holds a socket and is told. So the device
// holds one socket, the bridge pushes a command the moment it is enqueued, and the
// completion travels back over the same socket. Nothing on the hot path polls.
//
// WHY the socket carries the same auth as the HTTP actions. A device that could
// open a socket must not be more trusted than one that can only poll, so the
// handshake verifies the same token hash and the same device name the pull path
// already verifies, and a socket that fails the handshake is closed unread.

const HANDSHAKE_TIMEOUT_MS = 8000;
const MAX_FRAME_BYTES = 64 * 1024;
export const KEEPALIVE_MS = 20000;

// WHY a keepalive exists, and why it is not polling. An MV3 service worker with a
// silent WebSocket is an idle service worker, and Chrome ends idle workers after
// thirty seconds. Observed against the deployed bridge: the device connected,
// reported ready, and was closed with "signal is aborted without reason" about
// every thirty seconds after. Nothing was refused; the worker simply stopped
// existing, taking its socket with it.
//
// A frame on a timer asks nothing and waits for nothing, which is the whole
// difference from the /pull loop this transport replaced. It exists because an
// arriving message is what resets the worker timer, and because a peer that has
// gone away should be noticed rather than written to forever.
//
// WHY twenty seconds. The worker dies at thirty, so the interval has to be
// comfortably inside it; twenty leaves a full missed frame of slack before a slow
// or delayed delivery is enough to lose the device.

export function frameForKeepalive(serverTime) {
  return JSON.stringify({ type: "ping", serverTime });
}

// WHY an unanswered ping closes the socket rather than being retried. A socket
// that looks open and is not is worse than one that is closed: the device sits
// connected, every health signal reads fine, and no command ever arrives. That is
// not hypothetical. Observed live against this bridge, a device socket held for
// twenty minutes across an edge instance being replaced, still receiving pings,
// with a change subscription that had died with the old instance.
//
// WHY one tick of slack. Closing on the first missing answer would drop healthy
// sockets whenever a reply is merely late, which trades a rare silent hang for a
// routine reconnect. Waiting one tick means a peer has to miss a full interval
// before it is declared gone.

export function keepaliveDecision(counts) {
  if (counts.pings === 0) return "wait";
  if (counts.pings > counts.pongs) return "close";
  return "wait";
}

// Dependencies are injected so the protocol is testable without a socket, a
// database, or a browser, and so the channel opens only after auth: a socket that
// has not proven its token never receives another device's command.

export function isUpgradeRequest(req) {
  const upgrade = req.headers.get("upgrade");
  return Boolean(upgrade && upgrade.toLowerCase() === "websocket");
}

// WHY the token travels in the first frame rather than a header. A service worker
// cannot set arbitrary headers on a WebSocket handshake, and the alternative, a
// query parameter, puts a credential into every access log on the path.

export function handshakePayload(message) {
  if (!message || typeof message !== "object") return null;
  const token = typeof message.token === "string" ? message.token.trim() : "";
  const deviceName = typeof message.deviceName === "string" ? message.deviceName.trim() : "";
  if (!token || !deviceName) return null;
  return { token, deviceName };
}

export function frameForCommand(command, serverTime) {
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

export function parseDeviceFrame(raw, maxBytes = MAX_FRAME_BYTES) {
  if (typeof raw !== "string") return { ok: false, error: "Frame must be text." };
  if (raw.length > maxBytes) return { ok: false, error: "Frame too large." };
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Frame must be JSON." };
  }
  if (!message || typeof message.type !== "string") return { ok: false, error: "Frame needs a type." };
  return { ok: true, message };
}

export function serveDeviceSocket(req, { verifyDevice, claim, complete, subscribe, log }) {
  const upgrade = isUpgradeRequest(req);
  if (!upgrade) return { upgraded: false, response: null };

  const { socket, response } = Deno.upgradeWebSocket(req);

  const state = { ready: false, identity: null, queueing: false };
  const counts = { pings: 0, pongs: 0 };
  let unsubscribe = null;
  let handshakeTimer = null;
  let keepaliveTimer = null;

  const teardown = () => {
    if (handshakeTimer) clearTimeout(handshakeTimer);
    handshakeTimer = null;
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    keepaliveTimer = null;
    if (typeof unsubscribe === "function") {
      try { unsubscribe(); } catch { }
      unsubscribe = null;
    }
  };

  const dispatch = async (message) => {
    if (message.type === "pong") {
      counts.pongs += 1;
      return;
    }

    if (message.type === "hello") {
      const identity = handshakePayload(message);
      if (!identity) {
        socket.send(JSON.stringify({ type: "error", error: "Handshake needs token and deviceName." }));
        socket.close(4001, "unauthorized");
        return;
      }
      const verified = await verifyDevice(identity);
      if (!verified?.ok) {
        socket.send(JSON.stringify({ type: "error", error: "Unauthorized device." }));
        socket.close(4001, "unauthorized");
        return;
      }
      state.ready = true;
      state.identity = identity;
      socket.send(JSON.stringify({ type: "ready", serverTime: new Date().toISOString() }));
      log?.info?.("bridge socket ready", identity.deviceName);

      unsubscribe = subscribe(identity, (command) => {
        if (!state.ready || socket.readyState !== WebSocket.OPEN) return;
        socket.send(frameForCommand(command, new Date().toISOString()));
      });

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
        }
      }, KEEPALIVE_MS);

      return;
    }

    if (message.type === "complete") {
      if (!state.ready) {
        socket.send(JSON.stringify({ type: "error", error: "Handshake first." }));
        return;
      }
      const result = await complete({ ...state.identity, ...message });
      socket.send(JSON.stringify({ type: "ack", commandId: message.commandId ?? null, result }));
    }
  };

  socket.onopen = () => {
    handshakeTimer = setTimeout(() => {
      if (!state.ready) {
        socket.send(JSON.stringify({ type: "error", error: "Handshake timeout." }));
        socket.close(4002, "handshake timeout");
      }
    }, HANDSHAKE_TIMEOUT_MS);
  };

  socket.onmessage = async (event) => {
    const parsed = parseDeviceFrame(event.data);
    if (!parsed.ok) {
      socket.send(JSON.stringify({ type: "error", error: parsed.error }));
      return;
    }
    try {
      await dispatch(parsed.message);
    } catch (error) {
      log?.error?.("bridge socket dispatch failed", String(error?.message || error));
      socket.send(JSON.stringify({ type: "error", error: "Dispatch failed." }));
    }
  };

  socket.onclose = () => {
    teardown();
  };
  socket.onerror = () => {
    teardown();
  };

  return { upgraded: true, response, socket };
}