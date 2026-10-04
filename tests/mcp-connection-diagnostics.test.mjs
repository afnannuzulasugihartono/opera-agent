// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: mcp-connection-diagnostics.test — connection-diagnostics.test — Test.
// @state: investigate persistent MCP availability without runtime changes.
// @dependencies: strict, node:test, mcp-connection-diagnostics.

import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnoseMcpConnection } from '../scripts/mcp-connection-diagnostics.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

test('connection diagnostics without bearer does not pretend authenticated discovery passed', async () => {
  let calls = 0;
  const report = await diagnoseMcpConnection({ fetchImpl: async () => { calls++; return json({ ok: true }); } });
  assert.equal(calls, 1);
  assert.equal(report.status, 'AUTHENTICATED_DISCOVERY_UNTESTED');
});

test('connection diagnostics discovers tools independently of browser and host availability', async () => {
  const methods = [];
  const bearer = 'synthetic-diagnostic-secret';
  const report = await diagnoseMcpConnection({ bearer, fetchImpl: async (url, init) => {
    if (url.endsWith('/health')) return json({ ok: true });
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer ' + bearer);
    const message = JSON.parse(init.body); methods.push(message.method);
    if (message.method === 'initialize') return json({ id: 1, result: { protocolVersion: '2025-03-26' } });
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (message.method === 'tools/list') return json({ id: 2, result: { tools: [{ name: 'browser_status' }] } });
    return json({ id: 3, result: { structuredContent: { paired: true, privatePage: 'never-print' } } });
  } });
  assert.equal(report.status, 'DIRECT_BROWSER_STATUS_PASS');
  assert.equal(report.hostToolRegistry, 'not_observed');
  assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
  assert.equal(JSON.stringify(report).includes(bearer), false);
  assert.equal(JSON.stringify(report).includes('never-print'), false);
});

test('connection diagnostics redacts network errors and bounds remote response bytes', async () => {
  const report = await diagnoseMcpConnection({ fetchImpl: async () => { throw new Error('secret-remote-error'); } });
  assert.equal(report.status, 'SERVER_UNREACHABLE_OR_UNHEALTHY');
  assert.equal(JSON.stringify(report).includes('secret-remote-error'), false);
  const large = await diagnoseMcpConnection({ fetchImpl: async () => json({ value: 'x'.repeat(70000) }) });
  assert.equal(large.events[0].reason, 'REQUEST_FAILED');
});
