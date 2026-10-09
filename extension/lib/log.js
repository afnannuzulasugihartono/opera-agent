// @last-edited: 2026-10-09 UTC+7.
// @title: log — one shared logger handle for every module in the worker graph.
// @state: re-exports the global agent-log.js publishes; chrome-free, so it belongs in lib/ beside its own source.
// @dependencies: agent-log.js.

import './agent-log.js';

export const log = globalThis.OperaAgentLog || {};
if (typeof log.warn !== 'function') throw new Error('Agent log runtime is unavailable.');
