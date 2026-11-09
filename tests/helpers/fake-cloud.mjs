// @last-edited: 2026-11-09 UTC+7.
// @title: fake-cloud — the cloud the loopback bridge asks about the plan, answered in-process.
// @state: a granted pilot session, a spent day, and a dead socket, each named by the question the bridge asks.
// @dependencies: none.

// WHY THIS FILE EXISTS

// The loopback bridge asks the cloud exactly twice a session: once when the session opens, once when it closes.
// The local suite proves the bridge's side of that conversation with answers that arrive in the same process, so no suite ever reaches the network.
// One helper answers every question the bridge asks, and records the close reports, so a test asserts what was reported rather than what was hoped for.

import http from 'node:http';

export function pilotSession(overrides = {}) {
  return {
    ok: true,
    plan: 'plan.pilot',
    status: 'active',
    dailyQuota: 200,
    usedToday: 0,
    sessionAllowance: 50,
    ...overrides
  };
}

export function fakeCloud({ open = pilotSession(), reports = [] } = {}) {
  return {
    reports,
    async sessionOpen(identity) {
      reports.push({ phase: 'open', ...identity });
      if (open instanceof Error) throw open;
      return open;
    },
    async sessionReport({ commands, ...identity }) {
      reports.push({ phase: 'report', commands, ...identity });
      return { ok: true };
    }
  };
}

// WHY AN HTTP FAKE AND NOT ONLY AN IN-PROCESS ONE.
// The driver builds its bridge inside local/bridge.js, which has no argument to receive a cloud.
// Pointing OPERA_CLOUD_URL at a loopback HTTP server exercises the exact call the production meter makes, so the driver path is proven without a test-only hook in production code.

export async function startFakeCloud({ open = pilotSession() } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { parsed = null; }
      if (req.method !== 'POST' || !parsed) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Body must be JSON.' }));
        return;
      }
      if (parsed.action === 'session_open') {
        requests.push(parsed);
        if (open instanceof Error) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: open.message }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(open));
        return;
      }
      if (parsed.action === 'session_report') {
        requests.push(parsed);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unknown action.' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
