// @title: gateway — POST /command with the exact public shape, fulfilled by one device call.
// @state: covered by tests/cf-gateway.test.mjs; shapes copied verbatim from the Supabase gateway.
// @dependencies: none (rpc, authUser, deviceForUser, setProvider, runOnDevice are injected).

const DEVICE_NAME = 'opera';
const METHOD_RE = /^[a-z][a-z0-9_.]{1,48}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const WAIT_MIN = 500;
const WAIT_MAX = 32000;
const OFFLINE_AFTER_MS = 90000;

export const MAX_BODY_BYTES = 256 * 1024;

export async function readBoundedBody(req, maxBytes) {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { }
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(out);
}

export function extractToken(headers, body) {
  const header = headers.get('x-opera-agent-token') || headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (header) return header.trim();
  if (body && typeof body.apiKey === 'string' && body.apiKey.trim()) return body.apiKey.trim();
  return null;
}

export function normalizeInput(body) {
  const method = typeof body?.method === 'string' ? body.method.trim() : '';
  if (!METHOD_RE.test(method)) {
    return { ok: false, status: 400, body: { ok: false, error: { code: 'INVALID_METHOD', message: 'Missing/invalid method.' } } };
  }
  const params = (body.params && typeof body.params === 'object') ? body.params : {};
  const timeoutMs = Math.max(WAIT_MIN, Math.min(WAIT_MAX, Number(body.waitMs) || 12000));
  const requestId = typeof body.requestId === 'string' && ID_RE.test(body.requestId) ? body.requestId : null;
  return { ok: true, input: { method, params, timeoutMs, requestId } };
}

export function providerFromUA(ua) {
  return /chatgpt|openai/i.test(String(ua || '')) ? 'chatgpt' : '';
}

export function clientIdFromJwt(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof payload.client_id === 'string' ? payload.client_id : '';
  } catch {
    return '';
  }
}

export function openApiSpec(basePath) {
  return {
    openapi: '3.0.0',
    info: {
      title: 'Opera Agent Gateway',
      description: 'One-hop browser control for any AI platform. Authenticate with body.apiKey (GPT Actions) or the x-opera-agent-token header.',
      version: '1.0.1'
    },
    servers: [{ url: basePath }],
    paths: {
      '/command': {
        post: {
          operationId: 'runBrowserCommand',
          summary: 'Run one browser action and wait for its result',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['method'],
                  properties: {
                    method: { type: 'string' },
                    params: { type: 'object' },
                    waitMs: { type: 'integer' },
                    requestId: { type: 'string' },
                    apiKey: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: 'Command result.' },
            401: { description: 'Unauthorized.' },
            504: { description: 'Device timeout.' }
          }
        }
      }
    }
  };
}

export function createGateway({ rpc, authUser, deviceForUser, setProvider, runOnDevice, now = () => Date.now() }) {
  return {
    async handleCommand({ headers, rawBody, userAgent }) {
      let body = null;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return { status: 400, body: { ok: false, error: { code: 'INVALID_JSON', message: 'Body must be JSON.' } } };
      }
      const token = extractToken(headers, body);
      if (!token) {
        return { status: 401, body: { ok: false, error: { code: 'UNAUTHORIZED', message: 'Missing token (x-opera-agent-token header or body.apiKey).' } } };
      }
      const parsed = normalizeInput(body);
      if (!parsed.ok) return { status: parsed.status, body: parsed.body };
      const { method, params, timeoutMs, requestId } = parsed.input;

      let auth = await rpc('opera_verify_device', { p_device_name: DEVICE_NAME, p_token_hash: await sha256Hex(token.toLowerCase()) });
      let deviceName = DEVICE_NAME;
      let tokenClientId = '';
      if (!auth?.ok) {
        const userId = await authUser(token);
        if (userId) {
          tokenClientId = clientIdFromJwt(token);
          const device = await deviceForUser(userId);
          if (device?.device_name) {
            deviceName = device.device_name;
            auth = { ok: true, last_seen_at: device.last_seen_at ?? null };
          }
        }
      }
      if (!auth?.ok) {
        return { status: 401, body: { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token for device.' } } };
      }

      const lastSeenAt = typeof auth.last_seen_at === 'string' ? auth.last_seen_at : null;
      if (!lastSeenAt || Date.parse(lastSeenAt) < now() - OFFLINE_AFTER_MS) {
        return { status: 200, body: { ok: false, error: 'Device is offline.', lastSeenAt } };
      }

      const queued = await rpc('opera_enqueue', {
        p_method: method,
        p_params: params,
        p_timeout_ms: timeoutMs,
        p_device_name: deviceName,
        p_request_id: requestId
      });
      if (!queued?.ok || !queued.commandId) {
        return { status: 200, body: { ok: false, error: String(queued?.error || `Unable to queue ${method}.`) } };
      }

      try {
        let provider = providerFromUA(userAgent);
        if (!provider && /^[0-9a-f-]{36}$/i.test(tokenClientId)) {
          const name = await rpc('opera_client_name', { p_client_id: tokenClientId });
          if (typeof name === 'string' && name) provider = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 32);
        }
        if (provider) await setProvider(String(queued.commandId), provider);
      } catch { }

      let run;
      try {
        run = await runOnDevice({ commandId: queued.commandId, timeoutMs, deadlineMs: now() + timeoutMs });
      } catch (error) {
        return { status: 502, body: { ok: false, commandId: queued.commandId, outcome: 'unknown', error: { code: 'GATEWAY_ERROR', message: 'Unable to retrieve the command result. The action may still have succeeded; verify page state before repeating it.' } } };
      }
      if (run && run.ok === false && typeof run.error === 'string' && run.error.includes('not paired')) {
        return { status: 401, body: { ok: false, error: { code: 'DEVICE_NOT_PAIRED', message: 'Device is not paired.' } } };
      }
      if (run && run.ok === false && run.error && typeof run.error === 'object' && run.error.code === 'AWAIT_TIMEOUT') {
        return {
          status: 504,
          body: { ok: false, commandId: queued.commandId, error: { code: 'AWAIT_TIMEOUT', message: 'The device did not report back before waitMs. The action may still have succeeded — verify page state before repeating it.' } }
        };
      }
      if (run?.ok === true) {
        return { status: 200, body: { ok: true, result: run.result, commandId: queued.commandId } };
      }
      return { status: 200, body: { ok: false, commandId: queued.commandId, error: run?.error || { code: 'GATEWAY_ERROR', message: 'Empty result.' } } };
    }
  };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
