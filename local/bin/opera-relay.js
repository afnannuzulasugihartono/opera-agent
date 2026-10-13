// @last-edited: 2026-10-12 UTC+7.
// @title: opera-relay entry point — fronts the remote Opera Agent edge function over stdio.
// @dependencies: ./relay.js.

// The relay holds no credential. Authorization stays the remote one: the bearer token
// and device headers arrive from the client process and are forwarded verbatim, so a
// token that is revoked upstream stops working here at the same moment it stops there.

import { startStdioRelay } from '../relay.js';

const url = process.env.OPERA_AGENT_MCP_URL
  || 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-mcp';

startStdioRelay({
  url,
  forwardHeaders: {
    authorization: process.env.OPERA_AGENT_MCP_TOKEN ? `Bearer ${process.env.OPERA_AGENT_MCP_TOKEN}` : undefined,
    'x-opera-device': process.env.OPERA_AGENT_DEVICE || 'opera',
    'x-opera-provider': 'opencode'
  },
  log: process.env.OPERA_RELAY_LOG ? (line) => process.stderr.write(`relay ${line}\n`) : () => {}
});