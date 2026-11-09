// @last-edited: 2026-11-09 UTC+7.
// @title: oauth — a browser login for the hosted server, with the token kept beside it.
// @state: the authorise URL, the loopback callback, the code exchange, the refresh, and where the token file lives.
// @dependencies: node:crypto, node:fs, node:http, node:os, node:path, node:child_process, node:url.

// WHY THIS FILE EXISTS

// The hosted MCP asks for an OAuth token before it answers anything.
// A machine that has a browser signs in through it once and is remembered; a machine without one sets OPERA_AGENT_MCP_TOKEN instead.
// One flow, one file; both doors open the same URL, and neither one needs a secret.

// WHY A LOOPBACK CALLBACK.
// The OAuth client this package uses is public and its only accepted redirect is OpenCode's own loopback address, so the callback is served on the same loopback port, for as long as the login takes, and then the port is free again.

// WHY PKCE.
// The flow crosses a browser and a code on a redirect; nothing that leaves the machine is usable anywhere else, because the verifier never left the CLI.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const PROJECT_REF = 'nenmkmtvjremqphfqnfw';
export const HOSTED_MCP_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/opera-agent-mcp`;
export const AUTHZ_ENDPOINT = `https://${PROJECT_REF}.supabase.co/auth/v1/oauth/authorize`;
export const TOKEN_ENDPOINT = `https://${PROJECT_REF}.supabase.co/auth/v1/oauth/token`;
export const CLIENT_ID = 'bbc5eb76-f385-435b-8b13-8e339b45e633';
export const REDIRECT_PORT = 19876;
export const REDIRECT_PATH = '/mcp/oauth/callback';
export const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}${REDIRECT_PATH}`;
export const SCOPE = 'openid email offline_access';

const CALLBACK_TIMEOUT_MS = 180000;
const SKEW_MS = 60000;

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

export function configDir(env = process.env) {
  if (env.OPERA_AGENT_MCP_CONFIG_HOME) return String(env.OPERA_AGENT_MCP_CONFIG_HOME);
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'opera-agent-mcp');
  }
  return path.join(home, '.config', 'opera-agent-mcp');
}

export function tokenPath(env = process.env) {
  return path.join(configDir(env), 'token.json');
}

export function readStoredToken(env = process.env) {
  try {
    const raw = fs.readFileSync(tokenPath(env), 'utf8');
    const token = JSON.parse(raw);
    return typeof token?.access_token === 'string' && token.access_token ? token : null;
  } catch {
    return null;
  }
}

function writeStoredToken(token, env = process.env) {
  const dir = configDir(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = tokenPath(env);
  fs.writeFileSync(file, `${JSON.stringify(token, null, 2)}\n`, { mode: 0o600 });
  return file;
}

export function authorizeUrl(verifier, state) {
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });
  return `${AUTHZ_ENDPOINT}?${query.toString()}`;
}

function personalBrowserCommand(url) {
  if (process.platform === 'win32') return { command: 'cmd', args: ['/d', '/s', '/c', 'start', '', url] };
  if (process.platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

export function openBrowser(url, runner = spawn) {
  const { command, args } = personalBrowserCommand(url);
  const child = runner(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  if (typeof child.unref === 'function') child.unref();
  return child;
}

function waitForCode({ url, state, open }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    const done = (error, value) => {
      server.close();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => done(new Error('no sign-in completed within three minutes')), CALLBACK_TIMEOUT_MS);
    server.on('request', (req, res) => {
      const asked = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (asked.pathname !== REDIRECT_PATH) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found\n');
        return;
      }
      const code = asked.searchParams.get('code');
      const got = asked.searchParams.get('state');
      if (!code || got !== state) {
        clearTimeout(timer);
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<h1>Sign-in did not match the request.</h1>');
        done(new Error('the sign-in response did not match the request'));
        return;
      }
      clearTimeout(timer);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<h1>Opera Agent is signed in.</h1><p>You can close this window.</p>');
      done(null, code);
    });
    server.on('error', (error) => {
      clearTimeout(timer);
      done(new Error(`the sign-in callback could not listen on ${REDIRECT_PORT}: ${error.message}`));
    });
    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      const opened = open(url);
      if (opened instanceof Promise) opened.catch(() => {});
    });
  });
}

export async function exchangeCode({ code, verifier, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier
  });
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error_description || payload?.error || `the sign-in exchange failed (${response.status})`);
  return persistentToken(payload);
}

export async function refreshAccessToken(refreshToken, fetchImpl = fetch) {
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refreshToken });
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error_description || payload?.error || `the refresh failed (${response.status})`);
  return persistentToken(payload, refreshToken);
}

function persistentToken(payload, previousRefresh = null) {
  const access = String(payload?.access_token ?? '');
  if (!access) throw new Error('the server answered without an access token');
  const expiresIn = Number(payload?.expires_in) > 0 ? Number(payload.expires_in) : 3600;
  return {
    access_token: access,
    refresh_token: payload?.refresh_token ? String(payload.refresh_token) : previousRefresh,
    token_type: String(payload?.token_type ?? 'bearer'),
    scope: String(payload?.scope ?? SCOPE),
    expires_at: Date.now() + expiresIn * 1000
  };
}

export async function accessToken({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  if (String(env.OPERA_AGENT_MCP_TOKEN ?? '').trim()) return String(env.OPERA_AGENT_MCP_TOKEN).trim();
  const stored = readStoredToken(env);
  if (!stored) return null;
  if (Number(stored.expires_at) > now() + SKEW_MS) return stored.access_token;
  if (!stored.refresh_token) return null;
  const refreshed = await refreshAccessToken(stored.refresh_token, fetchImpl).catch(() => null);
  if (!refreshed) return null;
  writeStoredToken(refreshed, env);
  return refreshed.access_token;
}

// The login is the part a person watches: one URL, one click, one file.

export async function login({ env = process.env, fetchImpl = fetch, open = openBrowser, write = writeStoredToken } = {}) {
  const verifier = b64url(crypto.randomBytes(32));
  const state = b64url(crypto.randomBytes(16));
  const url = authorizeUrl(verifier, state);
  const code = await waitForCode({ url, state, open });
  const token = await exchangeCode({ code, verifier, fetchImpl });
  const file = write(token, env);
  return { ok: true, file, scope: token.scope, expiresAt: token.expires_at };
}

export function loginInstructions(env = process.env) {
  return [
    'No Opera Agent token yet. Sign in once with a browser:',
    '  opera-agent-mcp auth',
    '',
    'which opens this URL and stores the token beside this install:',
    `  ${AUTHZ_ENDPOINT}?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=${encodeURIComponent(SCOPE)}`,
    '',
    'On a machine without a browser, set OPERA_AGENT_MCP_TOKEN instead.'
  ].join('\n');
}
