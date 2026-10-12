// @title: worker — edge entry: routes command calls and device sockets.
// @state: thin shell; every decision lives in ./gateway.js and is unit-tested there.
// @dependencies: ./device.js, ./gateway.js, ./postgrest.js, ../../supabase/functions/_shared/cors.js.

import { Device } from './device.js';
import { MAX_BODY_BYTES, createGateway, openApiSpec, readBoundedBody } from './gateway.js';
import { createPostgrest } from './postgrest.js';
import { CORS_DEFAULT_ORIGINS, resolveAllowedOrigin } from '../../supabase/functions/_shared/cors.js';

export { Device };

const CORS_BASE_HEADERS = {
  'Access-Control-Allow-Headers': 'content-type, x-opera-agent-token, authorization',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Cache-Control': 'no-store'
};

function corsHeaders(req) {
  const origin = resolveAllowedOrigin(req, CORS_DEFAULT_ORIGINS);
  return origin === null
    ? { ...CORS_BASE_HEADERS }
    : { ...CORS_BASE_HEADERS, 'Access-Control-Allow-Origin': origin };
}

function json(req, data, status = 200) {
  return Response.json(data, {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' }
  });
}

const postgrestOf = (env) => createPostgrest({
  baseUrl: env.SUPABASE_URL,
  serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
  fetchImpl: fetch
});

const fleetOf = (env) => env.DEVICE.get(env.DEVICE.idFromName('fleet'));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (request.method === 'GET') {
      if (url.pathname.endsWith('/openapi.json')) {
        return json(request, openApiSpec(`https://${url.host}`), 200);
      }
      if (url.pathname.endsWith('/health')) {
        return json(request, { ok: true, service: 'opera-agent-gateway', version: '1.0.1', time: new Date().toISOString() });
      }
    }
    if (request.headers.get('upgrade') === 'websocket') {
      return fleetOf(env).fetch(request);
    }
    if (request.method !== 'POST') {
      return json(request, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST /command only.' } }, 405);
    }
    const length = Number(request.headers.get('content-length') || 0);
    if (length > MAX_BODY_BYTES) {
      return json(request, { ok: false, error: { code: 'TOO_LARGE', message: 'Request too large.' } }, 413);
    }
    try {
      if (!url.pathname.endsWith('/command')) {
        return json(request, { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown path.' } }, 404);
      }
      const rawBody = await readBoundedBody(request, MAX_BODY_BYTES);
      if (rawBody === null) {
        return json(request, { ok: false, error: { code: 'TOO_LARGE', message: 'Request too large.' } }, 413);
      }
      const gateway = createGateway({
        rpc: postgrestOf(env).rpc,
        authUser: async (token) => {
          const res = await fetch(`${String(env.SUPABASE_URL).replace(/\/+$/, '')}/auth/v1/user`, {
            headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
          });
          if (!res.ok) return null;
          const user = await res.json().catch(() => null);
          return user?.id || null;
        },
        deviceForUser: async (userId) => {
          const res = await fetch(
            `${String(env.SUPABASE_URL).replace(/\/+$/, '')}/rest/v1/opera_devices?select=device_name,last_seen_at&user_id=eq.${encodeURIComponent(userId)}&status=neq.disabled&order=created_at&limit=1`,
            { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
          );
          if (!res.ok) return null;
          const rows = await res.json().catch(() => null);
          return Array.isArray(rows) ? rows[0] || null : null;
        },
        setProvider: async (commandId, provider) => {
          await fetch(
            `${String(env.SUPABASE_URL).replace(/\/+$/, '')}/rest/v1/opera_commands?id=eq.${encodeURIComponent(commandId)}`,
            {
              method: 'PATCH',
              headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ provider })
            }
          );
        },
        runOnDevice: async (input) => {
          const res = await fleetOf(env).fetch('https://device/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input)
          });
          return res.json();
        },
        now: () => Date.now()
      });
      const res = await gateway.handleCommand({
        headers: request.headers,
        rawBody,
        userAgent: request.headers.get('user-agent') || ''
      });
      return json(request, res.body, res.status);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(request, { ok: false, error: { code: 'GATEWAY_ERROR', message: message.slice(0, 300) } }, 502);
    }
  }
};
