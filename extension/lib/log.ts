// @last-edited: 2026-10-09 UTC+7.
// @title: log — one shared logger handle for every module in the worker graph.
// @state: re-exports the global agent-log.js publishes; chrome-free, so it belongs in lib/ beside its own source.
// @dependencies: agent-log.js.

import './agent-log.js';

// WHY THE GLOBAL IS READ THROUGH A CAST.
// agent-log.js publishes the shared writer onto globalThis before the worker imports another module; the protocol surface is the documented OPERA_AGENT_LOG contract, which this file does not re-declare.
// The cast names what the runtime actually carries and the agent-log contract owns the field list; nothing here is inferred.

export type AgentLogError = OperaAgentLogFault;

export type AgentLog = OperaAgentLog;

// The field list lives in extension/types/global.d.ts once; this file re-exports it and enforces presence before anything else reads it.

const runtime = globalThis.OperaAgentLog;
if (!runtime || typeof runtime.warn !== 'function') throw new Error('Agent log runtime is unavailable.');
export const log = runtime;
