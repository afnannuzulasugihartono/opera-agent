// @last-edited: 2026-11-09 UTC+7.
// @title: cloud — the same tools, the hosted server, and a bearer token.
// @state: stdio in, HTTP out; the token from the environment or the login file; nothing renamed on the way through.
// @dependencies: node:readline, ./oauth.js.

// WHY THIS FILE EXISTS

// Every local tool speaks to the browser it can reach.
// The same tools, through the same names, through the hosted server, drive the browser paired to the account instead.
// Nothing about the call changes except where it lands, which is why the proxy has no opinions: a request goes in, the answer comes back, and neither side learns the other is there.

// WHY THE TOKEN IS READ AND NEVER PASSED ON.
// The hosted server trusts the account, not the client that relays it, so the token is the account's credential on this machine and nothing more.

// WHY PROTOCOL DETAILS ARE FORWARDED UNTOUCHED.
// Tool outputs are a contract with callers; a proxy that renamed or reshaped a field would be a second protocol to keep in sync, and every clause in it would be a place the two could drift apart.

// WHY THE DEVICE HEADER IS SENT.
// A tab id lives inside one browser, so the hosted relay has to answer every call of one session on the same browser or the agent holds a tab id that exists on neither.
// The paired device file already names the browser this machine drives, so the pin is sent from there; without it the relay is free to pick a different browser per call, which is the failure the pin exists to prevent.

import readline from 'node:readline';

import { HOSTED_MCP_URL, accessToken, loginInstructions } from './oauth.js';
import { readDevice } from './wallet-client.js';

const PROVIDER = process.env.OPERA_AGENT_MCP_PROVIDER || 'opera-agent-mcp';

export function hostedBase(env = process.env) {
  return String(env.OPERA_AGENT_MCP_BASE_URL || HOSTED_MCP_URL).trim();
}

export function pinnedDeviceName(env = process.env, { home = null } = {}) {
  const named = String(env.OPERA_AGENT_MCP_DEVICE_NAME || '').trim();
  if (named) return named;
  try {
    return String(readDevice({ home })?.deviceName || '').trim();
  } catch {
    return '';
  }
}

async function postMcp(base, token, payload, fetchImpl = fetch, deviceName = '') {
  const response = await fetchImpl(base, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      'authorization': `Bearer ${token}`,
      'x-opera-provider': PROVIDER,
      'x-region': 'ap-southeast-1',
      ...(deviceName ? { 'x-opera-device': deviceName } : {})
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000)
  });
  const type = String(response.headers.get('content-type') || '');
  const text = await response.text();
  if (response.status === 401) {
    const challenge = response.headers.get('www-authenticate') || '';
    const body = safeJson(text);
    const error = new Error(body?.error_description || body?.error || 'the hosted server asked for a token');
    error.status = 401;
    error.challenge = challenge;
    throw error;
  }
  if (type.includes('text/event-stream')) return lastSseJson(text);
  const parsed = safeJson(text);
  if (parsed) return parsed;
  throw new Error(`the hosted server answered ${response.status} with an unreadable body`);
}

const safeJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

function lastSseJson(text) {
  const events = [];
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const parsed = safeJson(trimmed.slice(5).trim());
    if (parsed) events.push(parsed);
  }
  return events.at(-1) ?? null;
}

export async function serveCloud({ env = process.env, input = process.stdin, output = process.stdout, stderr = process.stderr, fetchImpl = fetch } = {}) {
  const token = await accessToken({ env, fetchImpl }).catch(() => null);
  if (!token) {
    stderr.write(`${loginInstructions(env)}\n`);
    return 3;
  }
  const base = hostedBase(env);
  const deviceName = pinnedDeviceName(env);
  stderr.write(`opera-agent-mcp cloud: ${base}\n`);
  if (deviceName) stderr.write(`opera-agent-mcp cloud: driving the paired device "${deviceName}"\n`);

  const lines = readline.createInterface({ input, terminal: false });
  lines.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      stderr.write('a line that was not JSON went to the log, not the server\n');
      return;
    }
    if (!message || typeof message !== 'object') return;
    const id = message.id;
    const isRequest = id !== undefined && id !== null;
    void (async () => {
      try {
        const answer = await postMcp(base, token, message, fetchImpl, deviceName);
        if (isRequest) output.write(`${JSON.stringify(answer ?? { jsonrpc: '2.0', id, result: null })}\n`);
      } catch (error) {
        const status = Number(error?.status) || 0;
        if (isRequest) {
          output.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: { code: status === 401 ? -32001 : -32603, message: String(error?.message || error).slice(0, 300) }
          })}\n`);
          return;
        }
        stderr.write(`the hosted server rejected a notification: ${String(error?.message || error).slice(0, 200)}\n`);
      }
    })();
  });
  return await new Promise((resolve) => lines.on('close', () => resolve(0)));
}
