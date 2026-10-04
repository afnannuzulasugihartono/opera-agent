// Last edited: 2026-10-04 17:52. Title: mcp-connection-diagnostics — Read-only diagnostics, not a host reconnect manager. Never reads stored OAuth Now: ops scripts read SUPABASE_PROJECT_REF / MCP base URL from env.

import { pathToFileURL } from 'node:url';

const BASE = process.env.OPERA_AGENT_MCP_BASE_URL || 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-mcp';
const MAX_BYTES = 64 * 1024;

// Read-only diagnostics, not a host reconnect manager. Never reads stored OAuth
// credentials or prints bearer tokens, user/page data, or raw remote errors.
export async function diagnoseMcpConnection({ fetchImpl = fetch, now = Date.now, bearer = '' } = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || typeof bearer !== 'string' || /[\r\n]/.test(bearer)) {
    throw new Error('INVALID_DIAGNOSTIC_CONFIGURATION');
  }
  const events = [];
  let protocolVersion = null;
  async function request(probe, path, message) {
    const started = now();
    const signal = AbortSignal.timeout(10000);
    try {
      const response = await fetchImpl(BASE + path, {
        method: message ? 'POST' : 'GET', redirect: 'error', signal,
        headers: { Accept: 'application/json, text/event-stream',
          ...(message ? { 'Content-Type': 'application/json' } : {}),
          ...(message && protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}),
          ...(message && bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
        ...(message ? { body: JSON.stringify(message) } : {})
      });
      let bytes = 0;
      let text = '';
      const decoder = new TextDecoder();
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('RESPONSE_TOO_LARGE'); }
            text += decoder.decode(value, { stream: true });
          }
        } finally { reader.releaseLock(); }
      }
      if (signal.aborted) throw new Error('REQUEST_TIMEOUT');
      const data = text ? JSON.parse(text + decoder.decode()) : null;
      events.push({ probe, timestamp: new Date(started).toISOString(), status: response.status, latencyMs: now() - started });
      return { status: response.status, data };
    } catch {
      events.push({ probe, timestamp: new Date(started).toISOString(), reason: 'REQUEST_FAILED', latencyMs: now() - started });
      return { status: 0, data: null };
    }
  }
  const rpc = (id, method, params = {}) => ({ jsonrpc: '2.0', id, method, params });
  const health = await request('SERVER_HEALTH', '/health');
  if (health.status !== 200 || health.data?.ok !== true) return { status: 'SERVER_UNREACHABLE_OR_UNHEALTHY', events };
  if (!bearer) return { status: 'AUTHENTICATED_DISCOVERY_UNTESTED', mcpServer: 'reachable', toolRegistry: 'unknown', events };
  const initialized = await request('MCP_INITIALIZE', '', rpc(1, 'initialize', {
    protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'opera-agent-readonly-diagnostics', version: '1.0.0' }
  }));
  if (initialized.status !== 200 || initialized.data?.id !== 1 || !initialized.data?.result?.protocolVersion) {
    return { status: [401, 403].includes(initialized.status) ? 'AUTHENTICATION_FAILED' : 'INITIALIZATION_FAILED', events };
  }
  protocolVersion = initialized.data.result.protocolVersion;
  const notification = await request('MCP_INITIALIZED', '', { jsonrpc: '2.0', method: 'notifications/initialized' });
  if (notification.status !== 202 && notification.status !== 200) return { status: 'INITIALIZED_NOTIFICATION_FAILED', events };
  const listed = await request('TOOLS_DISCOVERY', '', rpc(2, 'tools/list'));
  const tools = listed.data?.id === 2 ? listed.data?.result?.tools : null;
  if (listed.status !== 200 || !Array.isArray(tools) || !tools.some(tool => tool?.name === 'browser_status')) {
    return { status: 'TOOLS_DISCOVERY_FAILED', events };
  }
  const ping = await request('BROWSER_STATUS', '', rpc(3, 'tools/call', { name: 'browser_status', arguments: {} }));
  const result = ping.data?.id === 3 ? ping.data?.result : null;
  const content = result?.structuredContent;
  return {
    status: ping.status === 200 && result && !result.isError && content?.paired === true ? 'DIRECT_BROWSER_STATUS_PASS' : 'BROWSER_STATUS_UNCONFIRMED',
    mcpServer: 'reachable', serverToolRegistry: 'browser_status_discovered',
    hostToolRegistry: 'not_observed', toolCount: tools.length,
    ...(typeof content?.paired === 'boolean' ? { paired: content.paired } : {}), events
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    console.error('NO_DIAGNOSTIC_ARGUMENTS_ALLOWED'); process.exitCode = 1;
  } else {
    const report = await diagnoseMcpConnection({ bearer: process.env.OPERA_AGENT_DIAGNOSTIC_BEARER || '' });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'DIRECT_BROWSER_STATUS_PASS') process.exitCode = 1;
  }
}
