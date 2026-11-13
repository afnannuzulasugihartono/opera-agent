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

// The result object a CDP method resolves with.
// Only the fields the local road reads are named; the rest of a method's answer is reachable through the index signature.

// A method result is the envelope CDP sends: the remote object for an evaluation, the bytes for a capture, the node for a describe.
// Only the fields the local road reads are named; every other answer is reachable through the index signature.

export interface CdpRemoteObject {
  value?: unknown;
  objectId?: string;
  description?: string;
  [key: string]: unknown;
}

export interface CdpResult {
  result?: CdpRemoteObject;
  data?: string;
  node?: { backendNodeId?: number; [key: string]: unknown };
  model?: { content?: number[]; border?: number[] };
  contentSize?: { width?: number; height?: number };
  bounds?: { windowState?: string; left?: number; top?: number; width?: number; height?: number };
  windowId?: number;
  backendNodeId?: number;
  [key: string]: unknown;
}

interface CdpMessage {
  id?: unknown;
  method?: string;
  params?: unknown;
  sessionId?: unknown;
  result?: unknown;
  error?: { message?: string; code?: unknown; data?: unknown };
}

export interface CdpTransport {
  send(frame: string): void;
  onMessage(handler: (frame: { id: unknown; result?: unknown; error?: { message: string } }) => void): void;
  close(): void;
}

export function createCdpClient(transport: CdpTransport) {
  const pending = new Map<number, { resolve: (value: CdpResult) => void; reject: (reason: unknown) => void }>();
  const handlers = new Map<string, Set<(params: unknown) => void>>();
  let nextId = 0;
  let closed = false;

  const dispatch = (raw: unknown) => {
    const message: CdpMessage = typeof raw === 'string' ? (JSON.parse(raw) as CdpMessage) : (raw as CdpMessage);
    const id = message && message.id !== undefined ? Number(message.id) : null;
    const settle = id === null ? undefined : pending.get(id);
    if (id !== null && settle) {
      pending.delete(id);
      if (message.error) {
        const failure = new Error(message.error.message || 'CDP error') as Error & { code?: unknown; data?: unknown };
        failure.code = message.error.code;
        failure.data = message.error.data;
        settle.reject(failure);
      } else {
        // CDP resolves every method with a result object; a method that sends none is answered with an empty one.
        const result = message.result;
        settle.resolve(typeof result === 'object' && result !== null ? (result as CdpResult) : {});
      }
      return;
    }
    if (message && message.method) {
      const method = String(message.method);
      const listeners = handlers.get(method);
      if (listeners) for (const listener of listeners) listener(message.params ?? {});
    }
  };

  transport.onMessage(dispatch);

  const client = {
    send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
      if (closed) return Promise.reject(new Error(CLOSED));
      nextId += 1;
      const id = nextId;
      const frame = sessionId ? { id, method, params, sessionId } : { id, method, params };
      return new Promise<CdpResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        transport.send(JSON.stringify(frame));
      });
    },

    on(method: string, handler: (params: unknown) => void) {
      const set = handlers.get(method) ?? new Set<(params: unknown) => void>();
      set.add(handler);
      handlers.set(method, set);
      return () => set.delete(handler);
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