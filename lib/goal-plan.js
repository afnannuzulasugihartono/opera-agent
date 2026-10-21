// @last-edited: 2026-10-05 01:20 UTC+7.
// @title: goal-plan — re-export so the Node suite and the extension share one gate.
// @state: the implementation lives in the extension, where the device will run it; this file only points at it.
// @dependencies: extension/lib/goal-plan.

// WHY the implementation lives under extension/: an MV3 service worker cannot load a module from outside its own directory, so the gate the device will run has to be in the extension.
// This re-export is how the Node suite reaches the same file rather than keeping a second copy that could drift from the one that guards the action.

export * from '../extension/lib/goal-plan.js';