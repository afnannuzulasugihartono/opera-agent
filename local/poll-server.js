// @last-edited: 2026-10-13 UTC+7.
// @title: poll-server — the local end of the extension bridge, in stock HTTP.
// @state: one held poll, a command queue, replies settled by id, stock node:http.
// @dependencies: node:http (stock), nothing else.

// WHY THIS FILE EXISTS
//
// The first version of this bridge spoke RFC6455 over loopback, written by hand
// because stock Node has a WebSocket client and no server. It was a real
// WebSocket in every observable way and it still did not work, and the reason
// is worth writing down so nobody builds it again: this Chrome takes an inbound
// frame on a ws:// loopback socket and never hands it to an extension service
// worker. Proven three ways. The worker's own counters read messages 0 after
// hundreds of frames sent. The same frame written by this same server reached a
// real WebSocket client every time, so the encoding was sound. And the identical
// mechanism in the same worker does deliver inbound frames when the peer is a
// wss:// relay — which is why commands from the cloud arrive and localhost
// commands never do.
//
// WHY HTTP instead. A fetch whose response arrives is an event, and Chrome
// dispatches events to a service worker by starting it if it is not running.
// That is the whole reason this is a long poll and not a socket: the poll is
// both the wake-up call and the delivery channel, with no second mechanism to
// keep honest. On loopback the whole exchange is two HTTP requests, which is a
// millisecond of work each.
//
// WHY the poll is held rather than returned empty. An empty poll would turn
// every command into a round trip of polling, and the whole point of the bridge
// is that a command costs one request, not two. The hold is capped so a quiet
// worker still refreshes the link the local side measures liveness from.
//
// WHY the queue drains the moment something is queued. A poll that is already
// hanging gets its command in the same tick the command arrives, so the worker
// never learns about an empty queue and waits another round trip to find out
// there was work waiting all along.
//
// WHY nothing is authenticated. This is the trust boundary a CDP debugging port
// already had, and the manifest scopes outbound requests to this machine.

import { createServer } from 'node:http';

// One sentence for a dead link, written once: three call sites throw it, and a
// driver, a test and a person all read the same words.

export const LINK_ERROR = 'bridge: extension is not connected (start the local driver, then reload the extension)';

export const POLL_HOLD_MS = 20000;
export const POLL_STALE_MS = 45000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    const onData = (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        req.off('data', onData);
        req.destroy();
        reject(new Error('reply body is absurd'));
      }
    };
    req.on('data', onData);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function createPollBridge({ port = 9451, host = '127.0.0.1', log = () => {} } = {}) {
  const queued = [];
  const held = [];
  const waiting = new Map();
  let lastPollAt = 0;
  let polls = 0;

  const answer = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(payload === undefined ? '' : JSON.stringify(payload));
  };

  const drain = () => {
    while (queued.length && held.length) {
      const waiter = held.shift();
      const command = queued.shift();
      clearTimeout(waiter.timer);
      if (waiter.res.destroyed) {
        queued.unshift(command);
        continue;
      }
      answer(waiter.res, 200, command);
      log(`poll -> ${command.tabs ? 'tabs.' + command.tabs.op : command.method ?? command.bridge}`);
    }
  };

  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }

    if (req.url === '/poll') {
      lastPollAt = Date.now();
      polls += 1;
      if (queued.length) {
        const command = queued.shift();
        answer(res, 200, command);
        return;
      }
      const waiter = { res, timer: null };
      waiter.timer = setTimeout(() => {
        const at = held.indexOf(waiter);
        if (at >= 0) held.splice(at, 1);
        if (!res.destroyed) answer(res, 204);
      }, POLL_HOLD_MS);
      if (waiter.timer.unref) waiter.timer.unref();
      held.push(waiter);
      return;
    }

    if (req.url === '/reply') {
      readBody(req).then((body) => {
        let message;
        try {
          message = JSON.parse(body);
        } catch {
          answer(res, 400, { error: 'reply is not JSON' });
          return;
        }
        const entry = waiting.get(String(message?.id));
        if (entry) {
          waiting.delete(String(message.id));
          entry(message);
        }
        answer(res, 200, { ok: true });
      }, (error) => answer(res, 400, { error: String(error?.message || error) }));
      return;
    }

    res.writeHead(404).end();
  });

  const live = (now = Date.now()) => now - lastPollAt < POLL_STALE_MS;

  return {
    polledAt() {
      return lastPollAt;
    },
    polls() {
      return polls;
    },
    linked(now = Date.now()) {
      return live(now);
    },
    enqueue(command) {
      queued.push(command);
      drain();
    },
    settleWhen(id, deliver) {
      waiting.set(String(id), deliver);
    },
    forget(id) {
      waiting.delete(String(id));
      const at = queued.findIndex((command) => String(command?.id) === String(id));
      if (at >= 0) queued.splice(at, 1);
    },
    async waitForLink({ timeoutMs = 10000, intervalMs = 50 } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (live()) return true;
        if (Date.now() >= deadline) return false;
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    },
    async waitForFreshPoll({ after, timeoutMs = 3000, intervalMs = 25 } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (polls > after) return true;
        if (Date.now() >= deadline) return false;
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    },
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve({ port: server.address().port, host }));
      });
    },
    address() {
      return server.address();
    },
    async close() {
      for (const [, deliver] of waiting) deliver({ error: { message: 'bridge closed' } });
      waiting.clear();
      queued.length = 0;
      for (const waiter of held) {
        clearTimeout(waiter.timer);
        if (!waiter.res.destroyed) waiter.res.end();
      }
      held.length = 0;
      await new Promise((resolve) => server.close(() => resolve()));
    }
  };
}