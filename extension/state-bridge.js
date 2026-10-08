// @last-edited: 2026-10-08 UTC+7.
// @title: state-bridge — MAIN-world game-state reader and frame loop.
// @state: registered readers only; no remote code, no network, no eval.
// @dependencies: loop-decide.js (loaded first into the same MAIN world).

(() => {
  'use strict';
  if (globalThis.__operaAgentStateBridgeV1) return;
  globalThis.__operaAgentStateBridgeV1 = true;

  // A registered state reader is a reviewed, bundled script — the opposite of
  // remote eval. Each reader names exactly which page fields it touches; the
  // allowlist lives here, in one auditable place, and nowhere else.

  function readTrex() {
    const Runner = globalThis.Runner;
    const instance = Runner && (Runner.instance_ || (typeof Runner.getInstance === 'function' ? Runner.getInstance() : null));
    if (!instance || !instance.horizon || !Array.isArray(instance.horizon.obstacles)) {
      return { ok: false, error: 'UNSUPPORTED' };
    }
    const tRex = instance.tRex || {};
    const config = tRex.config || {};
    const dimensions = instance.dimensions || {};
    const canvasH = dimensions.HEIGHT || dimensions.height || 150;
    const obstacles = instance.horizon.obstacles.map((o) => ({
      x: Number(o.xPos),
      y: Number(o.yPos),
      w: Number(o.width),
      h: Number((o.typeConfig && o.typeConfig.height) || o.height) || 40
    })).filter((o) => Number.isFinite(o.x) && Number.isFinite(o.y));
    const crashed = !!(instance.crashed || tRex.crashed);
    return {
      ok: true,
      speed: Number(instance.currentSpeed) || 0,
      dinoX: Number(tRex.xPos) || 0,
      dinoW: Number(config.WIDTH || config.width) || 40,
      dinoH: Number(config.HEIGHT || config.height) || 50,
      canvasH,
      ducking: !!tRex.ducking,
      airborne: !!tRex.jumping,
      crashed,
      obstacles
    };
  }

  const READERS = Object.freeze({ trex: readTrex });

  function post(type, detail) {
    globalThis.postMessage({ source: 'opera-agent-state', type, ...detail }, '*');
  }

  function dispatchKey(type, key, code, keyCode) {
    const target = document.activeElement || document.body || document.documentElement;
    target.dispatchEvent(new KeyboardEvent(type, { key, code, keyCode, bubbles: true, cancelable: true }));
  }

  const SPACE = { key: ' ', code: 'Space', keyCode: 32 };
  const DOWN = { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 };

  function act(action, latch) {
    if (action === 'jump') {
      if (latch.ducking) {
        dispatchKey('keyup', DOWN.key, DOWN.code, DOWN.keyCode);
        latch.ducking = false;
        post('duck-end', {});
      }
      dispatchKey('keydown', SPACE.key, SPACE.code, SPACE.keyCode);
      dispatchKey('keyup', SPACE.key, SPACE.code, SPACE.keyCode);
      post('jump', {});
      return 'jump';
    }
    if (action === 'duck') {
      if (!latch.ducking) {
        dispatchKey('keydown', DOWN.key, DOWN.code, DOWN.keyCode);
        latch.ducking = true;
        post('duck-start', {});
      }
      return 'duck-hold';
    }
    if (latch.ducking) {
      dispatchKey('keyup', DOWN.key, DOWN.code, DOWN.keyCode);
      latch.ducking = false;
      post('duck-end', {});
    }
    return 'run';
  }

  let session = null;

  function step() {
    if (!session || !session.running) return;
    const decide = globalThis.OperaAgentLoopDecide;
    if (!decide) {
      stop('decide-missing');
      return;
    }
    let reading;
    try {
      reading = session.reader();
    } catch (error) {
      stop('reader-error');
      return;
    }
    if (!reading.ok) {
      stop('unsupported');
      return;
    }
    if (reading.crashed && !session.reportedCrash) {
      session.reportedCrash = true;
      post('game-over', { ticks: session.ticks, jumps: session.jumps });
      stop('game-over');
      return;
    }
    const decision = decide.decideTrex(reading, session.params);
    const acted = act(decision.action, session.latch);
    session.ticks += 1;
    if (acted === 'jump') session.jumps += 1;
    if (session.ticks % 60 === 0) {
      post('heartbeat', { ticks: session.ticks, jumps: session.jumps, speed: reading.speed });
    }
    session.raf = globalThis.requestAnimationFrame(step);
  }

  function start(readerName, params) {
    stop('replaced');
    const reader = READERS[readerName];
    if (!reader) return { ok: false, error: 'Unknown reader.' };
    const validated = params && typeof params === 'object' ? params : {};
    const leadMs = Number(validated.leadMs);
    session = {
      running: true,
      reader,
      params: { leadMs: Number.isFinite(leadMs) && leadMs > 0 ? leadMs : 500 },
      latch: { ducking: false },
      ticks: 0,
      jumps: 0,
      reportedCrash: false,
      raf: 0,
      startedAt: Date.now()
    };
    post('started', { reader: readerName });
    session.raf = globalThis.requestAnimationFrame(step);
    return { ok: true, reader: readerName };
  }

  function stop(reason) {
    if (session && session.raf) {
      try { globalThis.cancelAnimationFrame(session.raf); } catch (error) {}
    }
    if (session && session.running) post('stopped', { reason: reason || 'stop', ticks: session.ticks, jumps: session.jumps });
    session = null;
    return { ok: true };
  }

  function status() {
    if (!session) return { ok: true, running: false };
    return { ok: true, running: session.running, ticks: session.ticks, jumps: session.jumps };
  }

  globalThis.OperaAgentStateBridge = Object.freeze({
    readers: Object.keys(READERS),
    start,
    stop,
    status
  });
})();
