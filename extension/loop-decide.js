// @last-edited: 2026-10-08 UTC+7.
// @title: loop-decide — frame-rate decision math, shared as a classic script.
// @state: pure t-rex decide; the MAIN-world bridge and the Node suite share it.
// @dependencies: none.

(() => {
  'use strict';
  if (globalThis.__operaAgentLoopDecideV1) return;
  globalThis.__operaAgentLoopDecideV1 = true;

  function decideTrex(state, params) {
    const run = { action: 'run', tti: null, obstacle: null };
    if (!state || typeof state !== 'object' || !params || typeof params !== 'object') return run;
    const speed = Number(state.speed);
    const leadMs = Number(params.leadMs);
    if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(leadMs) || leadMs <= 0) return run;
    const dinoFront = Number(state.dinoX) + Number(state.dinoW);
    const dinoH = Number(state.dinoH);
    const canvasH = Number(state.canvasH);
    if (!Number.isFinite(dinoFront) || !Number.isFinite(dinoH) || !Number.isFinite(canvasH)) return run;
    const upcoming = (Array.isArray(state.obstacles) ? state.obstacles : [])
      .filter((o) => o && Number(o.x) + Number(o.w) >= dinoFront)
      .sort((a, b) => (Number(a.x) + Number(a.w) / 2) - (Number(b.x) + Number(b.w) / 2));
    const obstacle = upcoming[0];
    if (!obstacle) return run;

    const center = Number(obstacle.x) + Number(obstacle.w) / 2;
    const tti = (center - dinoFront) / speed * 1000;
    if (!Number.isFinite(tti) || tti > leadMs) return { action: 'run', tti: Number.isFinite(tti) ? tti : null, obstacle };
    const yFromBottom = canvasH - Number(obstacle.y) - Number(obstacle.h);
    if (yFromBottom > dinoH) return { action: 'run', tti, obstacle };
    if (String(obstacle.kind).indexOf('PTERODACTYL') >= 0) return { action: 'duck', tti, obstacle };
    if (Number(obstacle.y) > canvasH / 2) return { action: 'jump', tti, obstacle };
    return { action: 'duck', tti, obstacle };
  }

  globalThis.OperaAgentLoopDecide = Object.freeze({ decideTrex });
})();
