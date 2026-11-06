// @last-edited: 2026-11-06 UTC+7.
// @title: hosted-mcp-check — what the hosted MCP surface answers a client that has no token.
// @state: the discovery document, the 401 and the challenge, written to proof/hosted-mcp.json.
// @dependencies: node:fs, node:path, node:url.

// WHY THIS SCRIPT EXISTS.
// The hosted server is the surface a reader is told to point a client at, and the claim that it asks for OAuth has to be checkable by somebody without an account.
// So this asks the server the two questions a client asks before it holds a token, and writes down what came back.
// It records no credential, and it writes nothing when the network is unreachable, because a record that says unreachable is not evidence either way.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.OPERA_AGENT_MCP_BASE_URL || 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-mcp';
const TIMEOUT_MS = 15000;

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

export async function checkHostedMcp({ base = BASE } = {}) {
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
  return {
    url: base,
    checkedAt: new Date().toISOString(),
    discovery: {
      status: discovery.status,
      resource: discovery.body?.resource ?? null,
      authorization_servers: discovery.body?.authorization_servers ?? [],
      bearer_methods_supported: discovery.body?.bearer_methods_supported ?? [],
      scopes_supported: discovery.body?.scopes_supported ?? []
    },
    initialize: {
      status: initialize.status,
      wwwAuthenticate: initialize.wwwAuthenticate,
      body: initialize.body
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const record = await checkHostedMcp();
    fs.mkdirSync(path.join(root, 'proof'), { recursive: true });
    fs.writeFileSync(path.join(root, 'proof', 'hosted-mcp.json'), `${JSON.stringify(record, null, 2)}\n`);
    console.log(`hosted mcp: discovery ${record.discovery.status}, initialize ${record.initialize.status}`);
  } catch (error) {
    console.error(`hosted mcp: the server could not be reached, so nothing was recorded: ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
