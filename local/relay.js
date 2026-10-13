// @last-edited: 2026-10-12 UTC+7.
// @title: opera-relay — a local stdio MCP server that fronts the remote Opera Agent edge function.
// @state: connection reuse, event-scoped resolve, prewarm, and honest passthrough.
// @dependencies: none.
//
// WHY THIS EXISTS, MEASURED
//
// Against the deployed edge function, the same request over the same HTTPS endpoint
// costs about 2 s when the client resolves on the first event it receives, and about
// 10 s when the client waits for the stream to finish. That gap is not on the server:
// the edge function's own stage timings account for roughly 1 s of the 2 s, and a
// probe reading the response body directly returns in the same 2 s. A local MCP client
// written against the Streamable HTTP transport settles the difference.
//
// So this relay does three things and nothing else. It opens the HTTPS connection once
// and keeps it, so no call pays a TLS handshake or an edge cold start. It resolves a
// call the moment the response event carries the matching id, so no call waits for a
// connection close that arrives seconds later. And it warms the remote endpoint at
// startup, so the first tool call does not pay the isolate spin-up either.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not change the tool surface: tools/list is
// forwarded and returned exactly as the edge function described it, so a schema change
// upstream is a schema change here too rather than a stale copy. It does not retry
// anything, because a silent retry would hide a real failure behind a slow success. It
// does not cache results, because a stale browser tab is worse than a slow one. And it
// does not talk to Supabase with anything but the bearer token the client already
// supplies, so the authorization path is the remote one and this process holds no
// credential of its own.
//
// WHY REQUESTS RUN ONE AT A TIME. The edge function does not always echo the request
// id on a tools/call reply, so with two requests in flight there is no way to tell which
// stream belongs to which caller: the wrong one silently consumes the answer while the
// right one hangs until it times out. Queueing makes every reply unambiguous. It costs
// nothing here, because a browser drive is a sequence of dependent actions and there is
// never a second caller waiting behind.
//
// WHY a stale connection is touched rather than left. A kept-alive connection idle past
// the server's own timeout has been closed by the far end, and the next request placed
// on it fails instead of being served. One cheap call before that happens removes a
// whole class of retries, and it is skipped whenever a real call is already running.
//
// WHY the runtime's own fetch is used rather than a supplied dispatcher. undici already
// pools and keeps connections alive, which is the only reason this file beats a naive
// client; handing it a Node https.Agent replaces that with something it cannot drive.

// WHY resources and prompts are answered rather than ignored. A client that lists them
// on connect needs a reply even when there are none, because silence reads as a hang
// rather than as "this server has nothing". The empty list is also what the declared
// capabilities already promised by omitting both, so answering costs nothing here and
// prevents a class of startup stall in clients that ask before they call.
//
// WHY the protocol version is negotiated rather than imposed. A client states the
// protocol it speaks and the server answers with the same one when it can. Answering
// with a fixed version is tolerated by lenient clients and refused outright by strict
// ones, and this file is meant to run under whatever client the person already has.

const DEFAULT_URL = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-mcp';
const PROTOCOL_VERSION = '2024-11-05';
const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(['2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']);
const WARM_AFTER_IDLE_MS = 45000;

function headersFor(extra = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...extra
  };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null || value === '') delete headers[key];
  }
  return headers;
}

async function post(url, body, headers, fetchImpl) {
  return fetchImpl(url, {
    method: 'POST',
    headers: headersFor(headers),
    body: JSON.stringify(body)
  });
}

// Resolves as soon as the stream carries the reply for this id. The Streamable HTTP
// transport frames replies as "event: message" then "data: {...}", and the connection
// may stay open afterwards; waiting for that close is the several seconds this file
// removes. An unterminated body is treated as done, because a complete JSON-RPC object
// is the answer whether or not the server hung up.

async function readReply(response, id, timeoutMs, onlyRequestInFlight) {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder();
  const wanted = String(id);
  let buffered = '';
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (Date.now() > deadline) throw new Error(`Remote did not answer ${id} in ${timeoutMs} ms.`);

    const { done, value } = await reader.read();
    if (done) break;

    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';

    for (const line of lines) {
      const text = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
      if (!text.startsWith('{')) continue;
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        continue;
      }
      const answered = message.id === undefined ? onlyRequestInFlight() : String(message.id) === wanted;
      if (answered) {
        reader.cancel().catch(() => {});
        return message;
      }
    }
  }

  const tail = buffered.trim();
  if (tail.startsWith('{')) {
    try {
      return JSON.parse(tail);
    } catch {
      buffered = '';
    }
  }
  throw new Error(`Remote closed the stream before answering ${id}.`);
}

// WHY THE SOCKET IS TRIED FIRST AND THE HTTPS IS KEPT. Every HTTPS call pays for an
// isolate that has never run before, plus a data-API crossing for each database visit,
// and measured here that is roughly 1.8 s against work the browser answers in under a
// millisecond. A held socket pays the boot once and then skips the gateway on every
// call after it, which measured at 830 ms for the same work. But a socket can die, and
// a relay that only speaks socket would turn a dead connection into a dead product, so
// every call the socket cannot carry falls back to the HTTPS it already spoke. The
// fallback never retries a call the socket may have delivered: a timeout is reported,
// not repeated, because repeating a write the server already ran would run it twice.
//
// WHY THE SOCKET CARRIES ONLY CALLS. The tool list is fetched once per session over
// HTTPS, where one slow call costs nothing, so the socket authenticates and then
// carries tool calls and keepalive pings and nothing else. Multiplexing is left out for
// the same reason the HTTPS path serializes: the edge answers one message before reading
// the next, and a browser drive never has a second caller waiting behind.

const WS_RECONNECT_MS = [1000, 2000, 5000, 10000, 30000];
const WS_PING_IDLE_MS = 20000;
const WS_PONG_TIMEOUT_MS = 10000;

export function createSocketTransport({ url, token, device, provider, timeoutMs, log = () => {}, WebSocketImpl = globalThis.WebSocket } = {}) {
  const wsUrl = String(url).replace(/^http/, "ws");
  let socket = null;
  let ready = false;
  let failures = 0;
  let reconnectTimer = null;
  let pingTimer = null;
  let lastTraffic = 0;
  let nextId = 1;
  const pending = new Map();

  const failAll = (reason) => {
    for (const [, reject] of pending.values()) reject(new Error(reason));
    pending.clear();
  };

  const scheduleReconnect = () => {
    if (reconnectTimer || typeof WebSocketImpl === "undefined") return;
    const wait = WS_RECONNECT_MS[Math.min(failures, WS_RECONNECT_MS.length - 1)];
    failures += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, wait);
    if (reconnectTimer.unref) reconnectTimer.unref();
  };

  const armPing = () => {
    if (pingTimer) return;
    pingTimer = setInterval(() => {
      if (!ready || !socket) return;
      if (Date.now() - lastTraffic < WS_PING_IDLE_MS) return;
      const id = `ping-${Date.now()}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        markDown("socket ping timed out");
      }, WS_PONG_TIMEOUT_MS);
      pending.set(id, [(m) => { clearTimeout(timer); }, () => { clearTimeout(timer); }]);
      try {
        socket.send(JSON.stringify({ id, method: "ping", params: {} }));
      } catch {
        pending.delete(id);
        clearTimeout(timer);
      }
    }, 5000);
    if (pingTimer.unref) pingTimer.unref();
  };

  const markDown = (reason) => {
    ready = false;
    failAll(reason);
    try {
      socket?.close();
    } catch { }
    socket = null;
    scheduleReconnect();
  };

  async function connect() {
    if (typeof WebSocketImpl === "undefined") return false;
    if (socket) return ready;
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      let ws;
      try {
        ws = new WebSocketImpl(wsUrl);
      } catch {
        scheduleReconnect();
        done(false);
        return;
      }
      const openTimer = setTimeout(() => {
        try {
          ws.close();
        } catch { }
        scheduleReconnect();
        done(false);
      }, timeoutMs);
      ws.addEventListener("open", () => {
        const id = nextId++;
        const authTimer = setTimeout(() => {
          pending.delete(String(id));
          try {
            ws.close();
          } catch { }
          scheduleReconnect();
          done(false);
        }, timeoutMs);
        pending.set(String(id), [
          (m) => {
            clearTimeout(authTimer);
            clearTimeout(openTimer);
            if (m?.error) {
              try {
                ws.close();
              } catch { }
              scheduleReconnect();
              done(false);
              return;
            }
            socket = ws;
            ready = true;
            failures = 0;
            lastTraffic = Date.now();
            armPing();
            log(`socket open direct=${m?.result?.direct === true}`);
            done(true);
          },
          () => {
            clearTimeout(authTimer);
            clearTimeout(openTimer);
            done(false);
          }
        ]);
        try {
          ws.send(JSON.stringify({ id, method: "auth", params: { token, device, provider } }));
        } catch {
          pending.delete(String(id));
          clearTimeout(authTimer);
          clearTimeout(openTimer);
          scheduleReconnect();
          done(false);
        }
      });
      ws.addEventListener("message", (event) => {
        lastTraffic = Date.now();
        let m;
        try {
          m = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const entry = pending.get(String(m.id));
        if (entry) {
          pending.delete(String(m.id));
          entry[0](m);
        }
      });
      const onGone = () => {
        clearTimeout(openTimer);
        if (socket === ws) {
          markDown("socket closed");
        }
        done(false);
      };
      ws.addEventListener("close", onGone);
      ws.addEventListener("error", onGone);
    });
  }

  async function call(tool, args) {
    if (!ready || !socket) throw new Error("socket is not connected");
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(String(id));
        reject(new Error(`socket call ${tool} timed out`));
      }, timeoutMs);
      pending.set(String(id), [
        (m) => {
          clearTimeout(timer);
          if (m?.error) {
            reject(new Error(String(m.error.message ?? m.error.code ?? "socket call failed")));
            return;
          }
          resolve(m?.result ?? null);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      ]);
      try {
        socket.send(JSON.stringify({ id, method: "tools/call", params: { name: tool, args } }));
      } catch (error) {
        pending.delete(String(id));
        clearTimeout(timer);
        markDown("socket send failed");
        reject(error);
      }
    });
  }

  const close = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    reconnectTimer = null;
    pingTimer = null;
    ready = false;
    failAll("socket transport closed");
    try {
      socket?.close();
    } catch { }
    socket = null;
  };

  return {
    get ready() {
      return ready;
    },
    connect,
    call,
    close
  };
}

export function createRelay({ url = DEFAULT_URL, forwardHeaders = {}, timeoutMs = 45000, log = () => {}, fetchImpl = fetch, socketTransport = null } = {}) {
  const headers = { ...forwardHeaders };
  const inFlight = new Set();
  let lastUsed = Date.now();
  let warming = null;
  let tail = Promise.resolve();

  const token = String(headers.authorization ?? headers.Authorization ?? "").replace(/^Bearer /i, "");
  const device = String(headers["x-opera-device"] ?? "opera");
  const providerName = String(headers["x-opera-provider"] ?? "");
  const socket = socketTransport ?? (token
    ? createSocketTransport({ url, token, device, provider: providerName, timeoutMs, log })
    : null);

  async function callOverHttp(body) {
    const response = await post(url, body, headers, fetchImpl);
    return readReply(response, body.id, timeoutMs, () => inFlight.size === 1);
  }

  async function callOverSocket(body) {
    if (body.method !== "tools/call") throw new Error("only tools/call rides the socket");
    const { name, arguments: args } = body.params ?? {};
    const result = await socket.call(name, args ?? {});
    return { jsonrpc: "2.0", id: body.id, result };
  }

  async function call(body) {
    const run = tail.then(async () => {
      const started = Date.now();
      lastUsed = Date.now();
      inFlight.add(String(body.id));
      try {
        let message;
        if (socket && body.method === "tools/call") {
          if (!socket.ready) await socket.connect().catch(() => false);
          if (socket.ready) {
            try {
              message = await callOverSocket(body);
              log(`${body.method}/${body.params?.name} socket ${Date.now() - started} ms`);
              return message;
            } catch (error) {
              const neverCarried = String(error?.message ?? "").includes("not connected");
              if (!neverCarried) throw error;
            }
          }
        }
        message = await callOverHttp(body);
        log(`${body.method} ${Date.now() - started} ms`);
        return message;
      } finally {
        inFlight.delete(String(body.id));
      }
    });

    tail = run.then(() => {}, () => {});
    return run;
  }

  function keepWarm() {
    if (inFlight.size > 0) return null;
    const idleFor = Date.now() - lastUsed;
    if (idleFor < WARM_AFTER_IDLE_MS) return null;

    if (!warming) {
      warming = call({ jsonrpc: '2.0', id: 'warm', method: 'tools/call', params: { name: 'browser_status', arguments: {} } })
        .catch(() => null)
        .then((reply) => { warming = null; return reply; });
    }
    return warming;
  }

  async function handle(request) {
    if (request.method === 'initialize') {
      const asked = String(request.params?.protocolVersion ?? PROTOCOL_VERSION);
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'opera-relay', version: '1.0.0' }
        }
      };
    }

    if (request.method === 'notifications/initialized') return null;
    if (request.method === 'ping') return { jsonrpc: '2.0', id: request.id, result: {} };

    if (request.method === 'resources/list') {
      return { jsonrpc: '2.0', id: request.id, result: { resources: [] } };
    }
    if (request.method === 'resources/templates/list') {
      return { jsonrpc: '2.0', id: request.id, result: { resourceTemplates: [] } };
    }
    if (request.method === 'prompts/list') {
      return { jsonrpc: '2.0', id: request.id, result: { prompts: [] } };
    }

    if (request.method === 'tools/list' || request.method === 'tools/call') {
      const warm = keepWarm();
      if (warm) await warm;
      return call(request);
    }

    return null;
  }

  async function warm() {
    const started = Date.now();
    await call({ jsonrpc: '2.0', id: 'boot', method: 'tools/call', params: { name: 'browser_status', arguments: {} } })
      .catch(() => null);
    log(`warm ${Date.now() - started} ms`);
  }

  return { handle, warm };
}

export function startStdioRelay(options = {}) {
  const relay = createRelay(options);
  let buffer = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      let request;
      try {
        request = JSON.parse(text);
      } catch {
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
        continue;
      }
      void Promise.resolve(relay.handle(request))
        .catch((error) => ({ jsonrpc: '2.0', id: request.id ?? null, error: { code: -32603, message: error.message } }))
        .then((response) => {
          if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
        });
    }
  });

  void relay.warm();
  return relay;
}