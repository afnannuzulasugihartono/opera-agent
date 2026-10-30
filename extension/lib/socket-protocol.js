// @last-edited: 2026-10-21 UTC+7.
// @title: socket-protocol — the frames a device and a bridge exchange over one persistent socket.
// @state: the handshake, the command frame, the completion frame, and the frames that must be refused.
// @dependencies: none.

// WHY THIS FILE EXISTS

// The device used to ask the bridge whether work existed, then ask again to report the result.
// Two round trips per action.
// A game holds a socket and is told, so these frames are that replacement: the same information, carried in one direction each, with no question asked.

// WHY the protocol lives apart from the socket.
// A WebSocket cannot be built in a unit test, so anything decided inside a socket callback is a thing nothing can check.
// Every decision here is a function over a string, which means a malformed frame, a missing handshake, or a completion for an unknown command is refused rather than trusted.

// WHY the cap is a megabyte.
// Results up to MAX_RESULT_BYTES (512 KiB, owned by lib/serialize.js) are legal product output: boundedResult throws only above it, and page.read degrades gracefully instead.
// A transport cap below that refuses legal results — observed live as "Frame too large" killing a page.read the product explicitly allows.
// The cap exists to bound a single message against a misbehaving peer, not to second-guess the product bound, so it sits at twice the largest legal completion plus envelope headroom.

// WHY the relation is locked in a test instead of importing the constant.
// The bridge cannot import this file and this file must stay dependency-free, so both caps are stated twice and a test asserts they still cover the bound.

export const FRAME_MAX_BYTES = 1024 * 1024;

export const DEVICE_PROTOCOL_VERSION = 2;

/**
 * Build the `hello` frame a device sends first, carrying its token and the protocol version.
 * @param {string} token The device token.
 * @param {string} deviceName The human-readable device name.
 * @returns {string} The JSON frame.
 */

export function handshakeFrame(
  token,
  deviceName
) {
  return JSON.stringify({
    type: 'hello',
    token,
    deviceName,
    protocolVersion: DEVICE_PROTOCOL_VERSION
  });
}

/**
 * Build the `complete` frame reporting a command's outcome, with a default error when none is given.
 * @param {string} commandId The command this completes.
 * @param {boolean} ok Whether it succeeded.
 * @param {*} [result] The result, sent only when ok.
 * @param {*} [error] The error, sent only when not ok.
 * @returns {string} The JSON frame.
 */

export function completionFrame(
  commandId,
  ok,
  result,
  error
) {
  return JSON.stringify({
    type: 'complete',
    commandId,
    ok: ok === true,
    ...(ok === true ? { result: result ?? {} } : { error: error ?? {
      code: 'EXECUTION_ERROR',
      message: 'Command failed.'
    } })
  });
}

// WHY 2048 bytes.
// Below that the few hundred bytes gzip would save are not worth a second code path per message; above it page JSON shrinks five to fifty times, which on a slow link is the difference between a one-second completion and a two-second one.

// WHY the first byte is a version rather than a magic string.
// The bridge distinguishes text from binary by type already; the version only has to survive this format ever changing, and one byte does that.

export const GZIP_FRAME_VERSION = 1;
const GZIP_THRESHOLD_BYTES = 2048;

async function gzipBytes(text) {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks = [];
  const pump = (async () => {
    for (;;) {
      const {
        done,
        value
      } = await reader.read();
      if (done) return;
      chunks.push(value);
    }
  })();
  pump.catch(() => null);
  await writer.write(new TextEncoder().encode(text));
  await writer.close();
  await pump;
  const total = chunks.reduce((
    n,
    c
  ) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Encode a completion frame, gzipping it above the threshold into a version-tagged binary frame.
 * Falls back to plain text when CompressionStream is unavailable or gzip fails.
 * @param {string} commandId The command this completes.
 * @param {boolean} ok Whether it succeeded.
 * @param {*} [result] The result.
 * @param {*} [error] The error.
 * @returns {Promise<string|Uint8Array>} The frame, text or gzipped binary.
 */

export async function encodeCompletionFrame(
  commandId,
  ok,
  result,
  error
) {
  const text = completionFrame(commandId, ok, result, error);
  if (text.length <= GZIP_THRESHOLD_BYTES) return text;
  if (typeof CompressionStream === 'undefined') return text;
  try {
    const gzipped = await gzipBytes(text);
    const frame = new Uint8Array(gzipped.length + 1);
    frame[0] = GZIP_FRAME_VERSION;
    frame.set(gzipped, 1);
    return frame;
  } catch {
    return text;
  }
}

/**
 * Parse and size-check one inbound frame; anything malformed is refused, never trusted.
 * @param {string} raw The raw frame text.
 * @param {number} [maxBytes=FRAME_MAX_BYTES] The transport cap.
 * @returns {{ ok: true, message: object } | { ok: false, error: string }} The verdict.
 */

export function parseFrame(
  raw,
  maxBytes = FRAME_MAX_BYTES
) {
  if (typeof raw !== 'string') return {
    ok: false,
    error: 'Frame must be text.'
  };
  if (raw.length > maxBytes) return {
    ok: false,
    error: 'Frame too large.'
  };

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

/**
 * Build the `pong` frame answering a ping.
 * @returns {string} The JSON frame.
 */

export function pongFrame() {
  return JSON.stringify({ type: 'pong' });
}

/**
 * Whether a parsed frame is a command the device may run: type 'command' with a non-empty id and method.
 * @param {*} message The parsed frame.
 * @returns {boolean} True when the command is runnable.
 */

export function isRunnableCommand(message) {
  if (!message || message.type !== 'command') return false;
  const command = message.command;
  if (!command || typeof command !== 'object') return false;
  if (typeof command.id !== 'string' || command.id.length === 0) return false;
  if (typeof command.method !== 'string' || command.method.length === 0) return false;
  return true;
}

/**
 * Normalize a runnable command frame into the `{ id, method, params, timeoutMs }` shape, defaulting the timeout.
 * @param {{ command: { id: string, method: string, params?: object, timeoutMs?: number } }} message The command frame.
 * @returns {{ id: string, method: string, params: object, timeoutMs: number }} The normalized command.
 */

export function normalizeCommand(message) {
  return {
    id: message.command.id,
    method: message.command.method,
    params: message.command.params ?? {},
    timeoutMs: Number(message.command.timeoutMs) > 0 ? Number(message.command.timeoutMs) : 30000
  };
}

// WHY a ready frame is tracked rather than inferred from socket state.
// An open socket says the TCP connection is up; it says nothing about whether the bridge accepted this device.
// Work arriving before the handshake is answered would run against an unproven identity, so the flag is the only thing that unlocks it.

/**
 * Whether the bridge has answered the handshake; only a `ready` frame unlocks work, because an open socket says nothing about the device being accepted.
 * @param {*} message The parsed frame.
 * @returns {boolean} True when the device is ready.
 */

export function isReady(message) {
  return Boolean(message && message.type === 'ready');
}

// WHY only the refusal is fatal.
// A 4001 means the credentials are wrong, so retrying is hammering with no future.
// A 4002 means the handshake was slow — a cold isolate, a delayed hello — which a retry answers in half a second.
// Treating it as fatal wedged a live device for hours on one slow handshake while its heartbeat stayed green, so every command queued and none ran.

/**
 * Whether a close code is fatal: 4001 means wrong credentials and retrying is hammering; anything else (notably a slow 4002 handshake) is worth one retry.
 * @param {number} code The close code.
 * @returns {boolean} True when the device should stop.
 */

export function isFatalClose(code) {
  return code === 4001;
}
