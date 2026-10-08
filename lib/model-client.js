// @last-edited: 2026-10-08 UTC+7.
// @title: model-client — re-export so the Node suite and the extension share one compiler.
// @state: the implementation lives in the extension, where the device will run it; this file only points at it.
// @dependencies: extension/lib/model-client.

export * from '../extension/lib/model-client.js';
