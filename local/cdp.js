// @last-edited: 2026-10-11 UTC+7.
// @title: cdp — a minimal Chrome DevTools Protocol client whose transport is injected.
// @state: correlates replies by id, rejects CDP errors, dispatches events, and refuses to send once closed.
// @dependencies: none.

// A CDP client is a request/response multiplexer over one socket.
// Chrome keys every reply on the id that was sent, so matching by id is the only correct rule: matching by arrival order breaks the moment two commands are in flight, which is exactly what driving a page does.

// The transport is injected rather than opened here.
// That is what makes this testable without a browser installed, which in turn means the concurrency rule is checked on every machine that runs the suite rather than only on one that happens to have Chrome.
// The real socket lives in transport.js.

// Nothing in this file knows about Opera Agent.
// It speaks CDP and nothing else, so it stays small enough to read in one sitting.

const CLOSED = 'CDP client is closed';

export function createCdpClient(transport) {
  const pending = new Map();
  const handlers = new Map();
  let nextId = 0;
  let closed = false;

  const dispatch = (raw) => {
    const message = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (message && message.id !== undefined && pending.has(message.id)) {
      const settle = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        const failure = new Error(message.error.message || 'CDP error');
        failure.code = message.error.code;
        failure.data = message.error.data;
        settle.reject(failure);
      } else {
        settle.resolve(message.result ?? {});
      }
      return;
    }
    if (message && message.method) {
      const listeners = handlers.get(message.method);
      if (listeners) for (const listener of listeners) listener(message.params ?? {}, message.sessionId);
    }
  };

  transport.onMessage(dispatch);

  const client = {
    send(method, params = {}, sessionId) {
      if (closed) return Promise.reject(new Error(CLOSED));
      nextId += 1;
      const id = nextId;
      const frame = sessionId ? { id, method, params, sessionId } : { id, method, params };
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        transport.send(JSON.stringify(frame));
      });
    },

    on(method, handler) {
      if (!handlers.has(method)) handlers.set(method, new Set());
      handlers.get(method).add(handler);
      return () => handlers.get(method)?.delete(handler);
    },

    close() {
      if (closed) return;
      closed = true;
      const failure = new Error(CLOSED);
      for (const settle of pending.values()) settle.reject(failure);
      pending.clear();
      handlers.clear();
      transport.close();
    },

    get closed() { return closed; }
  };

  return client;
}