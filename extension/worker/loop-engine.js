// @last-edited: 2026-10-09 UTC+7.
// @title: loop-engine — the sense-act and state loop sessions.
// @state: owns loopSessions, loopResults, stateSessions, stateResults, STATE_READERS and LOOP_MAX_ACTIVE; background and action-focus read them through this export.
// @dependencies: action-focus, tab-content, log, loop, keyboard, debugger-session.

import { log } from '../lib/log.js';
import {
  LOOP_SYNTHETIC_DEAD_TICKS,
  LOOP_TRACK_MIN_RUN,
  centroidTrack,
  downscaleHash,
  frontOfChanged,
  matchTemplate,
  pixelDiff,
  recordTick,
} from '../lib/loop.js';
import { resolveKeyInput } from '../lib/keyboard.js';
import { releaseDebuggerSession } from '../lib/debugger-session.js';
import { contentCall } from './tab-content.js';
import { withInputFocusEmulation } from './action-focus.js';

export const LOOP_MAX_ACTIVE = 4;
const LOOP_POLICY_RECHECK_TICKS = 20;

const LOOP_SUSPEND_FLOOR_MS = 15000;
export const loopSessions = new Map();
export const loopResults = new Map();

export function loopSummary(session, running, stopReason = null) {
  return {
    ok: true,
    loopId: session.loopId,
    tabId: session.tabId,
    running,
    ...(stopReason ? { stopReason } : {}),
    tick: session.state.tick,
    firedTotal: session.state.firedTotal,
    mode: session.mode,
    trusted: session.trusted,
    ...(session.trustedAtTick != null ? { trustedAtTick: session.trustedAtTick } : {}),
    ...(session.lastError ? { lastError: session.lastError } : {}),
    ...(session.snapshotInfo ? { snapshot: session.snapshotInfo } : {}),
    trace: session.state.trace
  };
}

export async function finishLoop(loopId, stopReason) {
  const session = loopSessions.get(loopId);
  if (!session) return loopResults.get(loopId) || null;
  if (session.timer) clearTimeout(session.timer);
  session.timer = null;
  const summary = loopSummary(session, false, stopReason);
  loopSessions.delete(loopId);
  loopResults.set(loopId, summary);
  while (loopResults.size > 20) loopResults.delete(loopResults.keys().next().value);
  await releaseDebuggerSession(session.debuggerSession, log);
  return summary;
}

export function loopSessionOnTab(tabId) {
  for (const session of loopSessions.values()) {
    if (session.tabId === tabId) return session;
  }
  for (const session of stateSessions.values()) {
    if (session.tabId === tabId) return session;
  }
  return null;
}

export const STATE_READERS = Object.freeze(['trex']);
export const stateSessions = new Map();
export const stateResults = new Map();

export function stateSummary(session, running, stopReason = null) {
  return {
    ok: true,
    loopId: session.loopId,
    tabId: session.tabId,
    reader: session.reader,
    running,
    ...(stopReason ? { stopReason } : {}),
    ticks: session.ticks,
    jumps: session.jumps,
    events: session.events.slice(-50)
  };
}

export function finishStateLoop(loopId, stopReason) {
  const session = stateSessions.get(loopId);
  if (!session) return stateResults.get(loopId) || null;
  const summary = stateSummary(session, false, stopReason);
  stateSessions.delete(loopId);
  stateResults.set(loopId, summary);
  while (stateResults.size > 20) stateResults.delete(stateResults.keys().next().value);
  chrome.scripting.executeScript({
    target: { tabId: session.tabId },
    world: 'MAIN',
    func: () => globalThis.OperaAgentStateBridge?.stop('supervisor-stop')
  }).catch((error) => log.debug('STATE_BRIDGE_STOP_FAILED', error?.message || String(error)));
  return summary;
}

export function handleStateEvent(tabId, type, detail = {}) {
  for (const session of stateSessions.values()) {
    if (session.tabId !== tabId) continue;
    session.events.push({ at: Date.now(), type, detail });
    if (session.events.length > 200) session.events.splice(0, session.events.length - 200);
    if (Number.isFinite(Number(detail.ticks))) session.ticks = Number(detail.ticks);
    if (Number.isFinite(Number(detail.jumps))) session.jumps = Number(detail.jumps);
    if (type === 'game-over') finishStateLoop(session.loopId, 'game-over');
    return { ok: true, loopId: session.loopId };
  }
  return { ok: true, loopId: null };
}

export async function loopDecodeTemplate(template) {
  const raw = atob(String(template));
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
  const out = { data: pixels.data, width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return out;
}

async function loopSnapshot(tabId, clip) {
  const request = { format: 'jpeg', quality: 40, fromSurface: true };
  if (clip) {
    request.clip = {
      x: clip.x,
      y: clip.y,
      width: Math.max(1, clip.width),
      height: Math.max(1, clip.height),
      scale: 1
    };
  }
  const response = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', request);
  const raw = atob(String(response?.data || ''));
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  const fullWidth = clip ? clip.width : bitmap.width;

  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  bitmap.close?.();
  return { data: pixels.data, width, height, cssWidth: fullWidth, clipX: clip ? clip.x : 0, clipY: clip ? clip.y : 0 };
}

function loopCropRegion(snapshot, region, scale) {
  const x = Math.max(0, Math.floor((region.x - snapshot.clipX) * scale));
  const y = Math.max(0, Math.floor((region.y - snapshot.clipY) * scale));
  const width = Math.max(1, Math.min(snapshot.width - x, Math.ceil(region.width * scale)));
  const height = Math.max(1, Math.min(snapshot.height - y, Math.ceil(region.height * scale)));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const from = ((y + row) * snapshot.width + (x + col)) * 4;
      const to = (row * width + col) * 4;
      out[to] = snapshot.data[from];
      out[to + 1] = snapshot.data[from + 1];
      out[to + 2] = snapshot.data[from + 2];
      out[to + 3] = snapshot.data[from + 3];
    }
  }
  return { data: out, width, height };
}

async function loopSyntheticKey(tabId, key) {
  await contentCall(tabId, 'page.key', { key });
}

async function loopTrustedKey(tabId, key) {
  const request = resolveKeyInput({ key });
  if (request.kind === 'text') {
    for (const chunk of request.chunks) {
      await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: chunk });
    }
    return;
  }
  const spec = {
    key: request.key,
    code: request.code,
    windowsVirtualKeyCode: request.windowsVirtualKeyCode,
    nativeVirtualKeyCode: request.nativeVirtualKeyCode
  };
  const modifiers = request.modifiers ? { modifiers: request.modifiers } : {};
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', ...modifiers, ...spec });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', ...modifiers, ...spec });
}

async function loopTrustedPointer(tabId, action) {
  await withInputFocusEmulation({ tabId }, 'background', async () => {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: action.x, y: action.y });
    if (action.pointerAction !== 'click') return;
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: action.x, y: action.y, button: 'left', clickCount: 1 });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: action.x, y: action.y, button: 'left', clickCount: 1 });
  });
}

async function loopActKey(session, key) {
  if (!session.trusted) {
    try {
      await loopSyntheticKey(session.tabId, key);
      return;
    } catch (error) {
      log.debug('LOOP_SYNTHETIC_KEY_FAILED', error?.message || String(error));
    }
  }
  await loopTrustedKey(session.tabId, key);
}

async function loopAct(session, action) {
  if (action.action === 'key') {
    await loopActKey(session, action.key);
    return;
  }
  await loopTrustedPointer(session.tabId, action);
}

async function loopSense(session, now) {
  const program = session.program;
  const pixelSensors = program.sensors.filter((s) => s.kind !== 'timer');
  let snapshot = null;
  let captureMs = 0;
  if (pixelSensors.length > 0) {

    const union = { x: Infinity, y: Infinity, right: 0, bottom: 0 };
    for (const sensor of pixelSensors) {
      union.x = Math.min(union.x, sensor.region.x);
      union.y = Math.min(union.y, sensor.region.y);
      union.right = Math.max(union.right, sensor.region.x + sensor.region.width);
      union.bottom = Math.max(union.bottom, sensor.region.y + sensor.region.height);
    }
    const clip = {
      x: Math.max(0, Math.floor(union.x)),
      y: Math.max(0, Math.floor(union.y)),
      width: Math.max(1, Math.ceil(union.right - union.x)),
      height: Math.max(1, Math.ceil(union.bottom - union.y))
    };
    const capStart = performance.now();
    snapshot = await loopSnapshot(session.tabId, clip);
    captureMs = performance.now() - capStart;
    session.scale = snapshot.width / snapshot.cssWidth;
    session.snapshotInfo = { width: snapshot.width, height: snapshot.height, cssWidth: snapshot.cssWidth };
  }
  const active = new Map();
  const values = {};
  for (const sensor of program.sensors) {
    if (sensor.kind === 'timer') {
      const last = session.timers.get(sensor.id) || 0;
      if (now - last >= sensor.everyMs) {
        session.timers.set(sensor.id, now);
        active.set(sensor.id, { fired: true });
      }
      continue;
    }
    const crop = loopCropRegion(snapshot, sensor.region, session.scale);
    if (sensor.kind === 'regionHash') {
      const hash = downscaleHash(crop.data, crop.width, crop.height);
      const before = session.frames.get(sensor.id);
      session.frames.set(sensor.id, hash);
      values[sensor.id] = hash ? hash.slice(0, 8) : null;
      if (before != null && before !== hash) active.set(sensor.id, { fired: true });
      continue;
    }
    if (sensor.kind === 'pixelDiff') {
      const before = session.frames.get(sensor.id);
      session.frames.set(sensor.id, crop);
      if (before && before.width === crop.width && before.height === crop.height) {
        const drift = pixelDiff(before.data, crop.data, 16);
        values[sensor.id] = drift;
        if (drift != null && drift > sensor.threshold) active.set(sensor.id, { fired: true, drift });
      }
      continue;
    }
    if (sensor.kind === 'track') {
      const before = session.frames.get(sensor.id);
      session.frames.set(sensor.id, crop);
      if (before && before.width === crop.width && before.height === crop.height) {
        const seen = frontOfChanged(before.data, crop.data, crop.width, crop.height, 16, LOOP_TRACK_MIN_RUN);
        const prev = session.track.get(sensor.id) || null;
        if (seen != null) {
          const tti = prev ? centroidTrack(prev.x, seen, now - prev.t, sensor.pad, sensor.leadMs) : null;
          session.track.set(sensor.id, { x: seen, t: now });
          values[sensor.id] = tti;
          if (tti != null) active.set(sensor.id, { fired: true, tti });
        } else {
          session.track.set(sensor.id, null);
        }
      }
      continue;
    }
    if (sensor.kind === 'stillness') {
      const before = session.frames.get(sensor.id);
      session.frames.set(sensor.id, crop);
      let quiet = 0;
      if (before && before.width === crop.width && before.height === crop.height) {
        const drift = pixelDiff(before.data, crop.data, 16);
        quiet = (drift != null && drift <= sensor.threshold) ? (session.quiet.get(sensor.id) || 0) + 1 : 0;
      }
      session.quiet.set(sensor.id, quiet);
      values[sensor.id] = quiet;
      if (quiet >= sensor.stillTicks) active.set(sensor.id, { fired: true, quiet });
      continue;
    }
    const template = session.templates.get(sensor.id);
    if (!template) continue;
    const match = matchTemplate(crop.data, crop.width, crop.height, template.data, template.width, template.height, 2);
    if (match) values[sensor.id] = match.score;
    if (match && match.score >= sensor.threshold) active.set(sensor.id, { fired: true, score: match.score, x: match.x, y: match.y });
  }
  return { active, values, captureMs, frameHash: snapshot ? downscaleHash(snapshot.data, snapshot.width, snapshot.height) : null };
}

export function loopTickLater(session) {
  session.timer = setTimeout(() => {
    session.timer = null;

    loopTick(session.loopId).catch((error) => { log.warn('LOOP_TICK_UNCAUGHT', error?.message || String(error)); });
  }, session.program.tickMs);
}

async function loopTick(loopId) {
  const session = loopSessions.get(loopId);
  if (!session) return;
  const now = Date.now();
  if (session.lastTickAt && now - session.lastTickAt > Math.max(5 * session.program.tickMs, LOOP_SUSPEND_FLOOR_MS)) {
    await finishLoop(loopId, 'suspended');
    return;
  }
  session.lastTickAt = now;
  const workStarted = performance.now();
  try {
    if (!session.debuggerSession.attached) {
      await finishLoop(loopId, 'debugger-detached');
      return;
    }
    const tab = await chrome.tabs.get(session.tabId).catch(() => null);
    if (!tab) {
      await finishLoop(loopId, 'tab-closed');
      return;
    }
    if (session.state.tick % LOOP_POLICY_RECHECK_TICKS === 0) {
      const policy = await contentCall(session.tabId, 'page.capture_policy', {});
      if (!policy.allowed) {
        await finishLoop(loopId, 'sensitive-surface');
        return;
      }
    }
    const { active, values, captureMs, frameHash } = await loopSense(session, now);
    const senseMs = performance.now() - workStarted - captureMs;
    let fired = 0;
    for (const rule of session.program.rules) {
      if (!active.has(rule.when.sensor)) continue;
      await loopAct(session, rule.do);
      fired += 1;
    }
    const actMs = performance.now() - workStarted - captureMs - senseMs;
    if (!session.trusted && fired > 0 && frameHash != null) {
      if (session.lastFrameHash != null && session.lastFrameHash === frameHash) {
        session.deadStreak += 1;
      } else {
        session.deadStreak = 0;
      }
      session.lastFrameHash = frameHash;
      if (session.deadStreak >= LOOP_SYNTHETIC_DEAD_TICKS) {
        session.trusted = true;
        session.trustedAtTick = session.state.tick + 1;
        session.deadStreak = 0;
      }
    }
    const workMs = performance.now() - workStarted;
    const result = recordTick(session.state, { workMs, fired, active: [...active.keys()], values, timing: { captureMs, senseMs, actMs } });
    session.mode = result.mode;
    if (result.overrun) {
      await finishLoop(loopId, 'tick-overrun');
      return;
    }
    if (session.state.tick >= session.program.maxTicks) {
      await finishLoop(loopId, 'max-ticks');
      return;
    }
    if (now - session.startedAt >= session.program.maxDurationMs) {
      await finishLoop(loopId, 'max-duration');
      return;
    }
    if (session.program.stopWhen.some((entry) => active.has(entry.sensor))) {
      await finishLoop(loopId, 'stop-condition');
      return;
    }
    loopTickLater(session);
  } catch (error) {
    log.warn('LOOP_TICK_FAILED', error?.message || String(error));
    session.lastError = String(error?.message || error).slice(0, 300);
    session.tickErrors += 1;
    if (session.tickErrors >= 3) {
      await finishLoop(loopId, 'tick-error');
      return;
    }
    loopTickLater(session);
  }
}
