// @title: socket-protocol — the frames a device and a bridge exchange over one persistent socket.
// @state: 8 locks; handshake, command frame, completion frame, and the frames that must be refused.
// @dependencies: none.

// WHY THIS FILE EXISTS
//
// The device used to ask the bridge whether work existed, then ask again to report
// the result. Two round trips per action. A game holds a socket and is told, so
// these frames are that replacement: the same information, carried in one direction
// each, with no question asked.
//
// WHY the protocol lives apart from the socket. A WebSocket cannot be built in a
// unit test, so anything decided inside a socket callback is a thing nothing can
// check. Every decision here is a function over a string, which means a malformed
// frame, a missing handshake, or a completion for an unknown command is refused
// rather than trusted.

const FRAME_MAX_BYTES = 64 * 1024;

export const DEVICE_PROTOCOL_VERSION = 2;

export function handshakeFrame(token, deviceName) {
  return JSON.stringify({ type: 'hello', token, deviceName, protocolVersion: DEVICE_PROTOCOL_VERSION });
}

export function completionFrame(commandId, ok, result, error) {
  return JSON.stringify({
    type: 'complete',
    commandId,
    ok: ok === true,
    ...(ok === true ? { result: result ?? {} } : { error: error ?? { code: 'EXECUTION_ERROR', message: 'Command failed.' } })
  });
}

export function parseFrame(raw, maxBytes = FRAME_MAX_BYTES) {
  if (typeof raw !== 'string') return { ok: false, error: 'Frame must be text.' };
  if (raw.length > maxBytes) return { ok: false, error: 'Frame too large.' };

  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Frame must be JSON.' };
  }

  if (!message || typeof message.type !== 'string') return { ok: false, error: 'Frame needs a type.' };
  return { ok: true, message };
}

export function pongFrame() {
  return JSON.stringify({ type: 'pong' });
}

export function isRunnableCommand(message) {
  if (!message || message.type !== 'command') return false;
  const command = message.command;
  if (!command || typeof command !== 'object') return false;
  if (typeof command.id !== 'string' || command.id.length === 0) return false;
  if (typeof command.method !== 'string' || command.method.length === 0) return false;
  return true;
}

export function normalizeCommand(message) {
  return {
    id: message.command.id,
    method: message.command.method,
    params: message.command.params ?? {},
    timeoutMs: Number(message.command.timeoutMs) > 0 ? Number(message.command.timeoutMs) : 30000
  };
}

// WHY a ready frame is tracked rather than inferred from socket state. An open
// socket says the TCP connection is up; it says nothing about whether the bridge
// accepted this device. Work arriving before the handshake is answered would run
// against an unproven identity, so the flag is the only thing that unlocks it.

export function isReady(message) {
  return Boolean(message && message.type === 'ready');
}

export function isFatalClose(code) {
  return code === 4001 || code === 4002;
}