// @last-edited: 2026-11-06 UTC+7.
// @title: hosted-mcp-check — what the hosted MCP surface answers a client that has no token, and whether the pinned OAuth client is still accepted.
// @state: the discovery document, the 401 and the challenge, the authorize probe for the pinned client, written to proof/hosted-mcp.json with token-shaped strings redacted.
// @dependencies: node:crypto, node:fs, node:path, node:url.

// WHY THIS SCRIPT EXISTS.
// The hosted server is the surface a reader is told to point a client at, and the claim that it asks for OAuth has to be checkable by somebody without an account.
// So this asks the server the two questions a client asks before it holds a token, and writes down what came back.
// The guide also pins one OAuth client id and one redirect, and a register call proves nothing about that pair, so the probe asks the authorization server about the pair itself.
// It writes nothing when the network is unreachable, because a record that says unreachable is not evidence either way.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPABASE_PROJECT_REF = 'nenmkmtvjremqphfqnfw';
export const HOSTED_MCP_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/opera-agent-mcp`;
const AUTH_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co/auth/v1`;
export const OAUTH_CLIENT_ID = 'bbc5eb76-f385-435b-8b13-8e339b45e633';
export const OAUTH_REDIRECT_URI = 'http://127.0.0.1:19876/mcp/oauth/callback';

const BASE = process.env.OPERA_AGENT_MCP_BASE_URL || HOSTED_MCP_URL;
const TIMEOUT_MS = 15000;

// WHY TOKEN-SHAPED STRINGS ARE REDACTED BEFORE THEY ARE KEPT.
// The one credential this script must never write is one that arrives inside an answer, and an error body is an answer.
// A JWT, a Supabase secret key and any run of forty-four opaque characters are all replaced, so a server that ever echoes a token into an error still leaves the tree clean.

const REDACTED = '[redacted]';

const TOKEN_SHAPED = [
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bsb_?[A-Za-z0-9_-]{20,}/g,
  /\b[A-Za-z0-9_-]{44,}\b/g
];

export function scrubbed(value) {
  let text = String(value);
  for (const pattern of TOKEN_SHAPED) text = text.replace(pattern, REDACTED);
  return text;
}

// WHY ONLY TWO FIELDS OF AN ERROR ARE KEPT.
// A 401 body has an error and an explanation, and everything else a server might add is a field this tree did not promise to record.
// Keeping two named fields is a smaller surface than trusting a body shape nobody checked.

function errorBody(body) {
  if (!body || typeof body !== 'object') return null;
  const kept = {};
  for (const key of ['error', 'error_description']) {
    if (typeof body[key] === 'string') kept[key] = scrubbed(body[key]);
  }
  return Object.keys(kept).length ? kept : null;
}

async function ask(base, suffix, init) {
  const response = await fetch(`${base}${suffix}`, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 500);
  }
  return {
    status: response.status,
    wwwAuthenticate: response.headers.get('www-authenticate') ?? '',
    body
  };
}

// WHY THE INITIALIZE IS SENT WITHOUT A TOKEN.
// A client that holds no token must be told where to get one, and the challenge is the answer.
// A request that carried a token would prove nothing about the path a new client walks.

// WHY THE AUTHORIZE PROBE CARRIES NO CREDENTIAL AND KEEPS NO REQUEST ID.
// Asking the authorization server whether it accepts the pinned pair is enough to keep the guide honest, and a consent request id buys another answer later and belongs to nobody who reads the record.
// The query is dropped, so the record holds the redirect target and not the one-time handle inside it.

async function askAuthorize(discovered, override) {
  const shape = { clientId: OAUTH_CLIENT_ID, redirectUri: OAUTH_REDIRECT_URI, status: null, consentPath: null };
  const authority = override ?? discovered ?? AUTH_URL;

  // WHY THE URL IS BUILT INSIDE THE TRY.
  // The authority arrives from a discovery document the server wrote, and a discovery document can hold anything.
  // A malformed entry must fail the probe and leave the rest of the record standing, not take the whole run down with it.

  let url;
  try {
    url = new URL(`${authority || AUTH_URL}/oauth/authorize`);
    url.search = new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
      response_type: 'code',
      code_challenge: crypto.randomBytes(32).toString('base64url'),
      code_challenge_method: 'S256',
      state: 'hosted-mcp-check',
      scope: 'openid email'
    }).toString();
  } catch (error) {
    return { ...shape, error: scrubbed(error?.message ?? String(error)) };
  }
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const location = response.headers.get('location') ?? '';
    let consentPath = null;
    if (location) {
      try { consentPath = new URL(location).pathname; } catch { consentPath = null; }
    }
    return { ...shape, status: response.status, consentPath };
  } catch (error) {
    return { ...shape, error: scrubbed(error?.message ?? String(error)) };
  }
}

export async function checkHostedMcp({ base = BASE, authority = null } = {}) {
  const discovery = await ask(base, '/.well-known/oauth-protected-resource', {
    method: 'GET',
    headers: { accept: 'application/json' }
  });
  const initialize = await ask(base, '', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'opera-agent-hosted-check', version: '1.0.0' }
      }
    })
  });
  const authorityFromDiscovery = Array.isArray(discovery.body?.authorization_servers) && typeof discovery.body.authorization_servers[0] === 'string'
    ? discovery.body.authorization_servers[0]
    : null;
  const authorize = await askAuthorize(authorityFromDiscovery, authority);
  return {
    url: base,
    checkedAt: new Date().toISOString(),
    discovery: {
      status: discovery.status,
      resource: typeof discovery.body?.resource === 'string' ? scrubbed(discovery.body.resource) : null,
      authorization_servers: (discovery.body?.authorization_servers ?? []).filter((entry) => typeof entry === 'string').map(scrubbed),
      bearer_methods_supported: (discovery.body?.bearer_methods_supported ?? []).filter((entry) => typeof entry === 'string').map(scrubbed),
      scopes_supported: (discovery.body?.scopes_supported ?? []).filter((entry) => typeof entry === 'string').map(scrubbed)
    },
    initialize: {
      status: initialize.status,
      wwwAuthenticate: scrubbed(initialize.wwwAuthenticate),
      body: errorBody(initialize.body)
    },
    authorize
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const record = await checkHostedMcp();
    fs.mkdirSync(path.join(root, 'proof'), { recursive: true });
    fs.writeFileSync(path.join(root, 'proof', 'hosted-mcp.json'), `${JSON.stringify(record, null, 2)}\n`);
    console.log(`hosted mcp: discovery ${record.discovery.status}, initialize ${record.initialize.status}, authorize ${record.authorize.status}`);
  } catch (error) {
    console.error(`hosted mcp: the server could not be reached, so nothing was recorded: ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
