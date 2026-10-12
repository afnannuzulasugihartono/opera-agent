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
