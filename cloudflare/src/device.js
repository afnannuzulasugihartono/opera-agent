// @title: device — fleet Durable Object shell; Cloudflare APIs in, logic callbacks out.
// @state: thin by design; every decision lives in ./device-logic.js and is unit-tested there.
// @dependencies: ./device-logic.js, ./postgrest.js.

import { createDevice } from './device-logic.js';
import { createPostgrest } from './postgrest.js';

export class Device {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Set();
    const rpc = createPostgrest({
      baseUrl: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
      fetchImpl: fetch
    });
    this.logic = createDevice({
      verify: async (identity) => {
        const tokenHash = await sha256Hex(identity.token.toLowerCase());
        const authed = await rpc.rpc('opera_auth_device', {
          p_device_name: identity.deviceName,
          p_token_hash: tokenHash
        });
        if (!authed) return { ok: false };
        this.deviceName = identity.deviceName;
        this.tokenHash = tokenHash;
        return { ok: true };
      },
      claim: async () => {
        const claimed = await rpc.rpc('opera_claim_next_wait', {
          p_device_name: this.deviceName || 'opera',
          p_token_hash: this.tokenHash || '',
          p_extension_version: '',
          p_protocol_version: 1,
          p_capabilities: [],
          p_wait_ms: 0
        });
        return claimed?.command ?? null;
      },
      complete: async (commandId, outcome) => {
        await rpc.rpc('opera_complete_command', {
          p_device_name: this.deviceName,
          p_token_hash: this.tokenHash,
          p_command_id: commandId,
          p_ok: outcome.ok === true,
          p_result: outcome.ok ? outcome.result : null,
          p_error: outcome.ok ? null : outcome.error
        });
      },
      send: (text) => {
        for (const ws of this.sockets) {
          try {
            if (ws.readyState === 1) ws.send(text);
          } catch { }
        }
      },
      close: (code, reason) => {
        for (const ws of this.sockets) {
          try { ws.close(code, reason); } catch { }
        }
        this.sockets.clear();
      },
      setAlarm: (atMs) => this.state.storage.setAlarm(atMs),
      now: () => Date.now()
    });
    this.deviceName = null;
    this.tokenHash = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/run') {
      const body = await request.json();
      const result = await this.logic.runCommand({
        commandId: body.commandId,
        timeoutMs: body.timeoutMs,
        deadlineMs: body.deadlineMs
      });
      return Response.json(result);
    }
    if (request.headers.get('upgrade') !== 'websocket') {
      return Response.json({ ok: false, error: 'Expected a websocket upgrade.' }, { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    this.sockets.add(server);
    this.logic.onOpen();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    await this.logic.onMessage(typeof message === 'string' ? message : String(message));
  }

  async webSocketClose() {
    await this.logic.onClose(1006, '');
  }

  async webSocketError() {
    await this.logic.onClose(1006, '');
  }

  async alarm() {
    try {
      await this.logic.onAlarm();
    } catch {
      this.state.storage.setAlarm(Date.now() + 20000);
    }
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
