// @last-edited: 2026-10-07 UTC+7.
// @title: loop — Local sense-act loop program schema.
// @state: validator and tick-band classifier only; no executor yet.
// @dependencies: none.

// The loop program is data, never code: sensors name allowlisted pixel
// observations, rules bind them to allowlisted input actions. Validation
// mirrors validateBurst in protocol.js, but this module stays
// dependency-free so a future classic content-script executor can inline
// it without pulling the module graph.

export const LOOP_TICK_MS_MIN = 50;
export const LOOP_TICK_MS_MAX = 500;
export const LOOP_TICK_MS_DEFAULT = 100;
export const LOOP_MAX_TICKS = 3600;
export const LOOP_MAX_DURATION_MS = 120000;
export const LOOP_MAX_RULES = 32;
export const LOOP_MAX_SENSORS = 8;
export const LOOP_TEMPLATE_MAX_BYTES = 32768;
export const LOOP_TIMER_MIN_MS = 50;
export const LOOP_TIMER_MAX_MS = 60000;

// Synthetic input that never visibly acts for this many firing ticks in a
// row is treated as ignored by the page: the loop flips to the trusted path
// mid-run and records the tick it flipped on.

export const LOOP_SYNTHETIC_DEAD_TICKS = 3;

// FPS-style bands, locked in plan: green runs full rate, yellow degrades,
// orange sheds to cheap sensors, red counts toward the overrun guard.

export const LOOP_TICK_BANDS = Object.freeze({ green: 60, yellow: 150, orange: 250 });

export const LOOP_SENSOR_KINDS = Object.freeze(['regionHash', 'pixelDiff', 'templateMatch', 'timer', 'stillness', 'track']);
export const LOOP_ACTIONS = Object.freeze(['key', 'pointer']);
export const LOOP_STILL_TICKS_DEFAULT = 10;
export const LOOP_STILL_TICKS_MIN = 2;
export const LOOP_STILL_TICKS_MAX = 600;
export const LOOP_POINTER_ACTIONS = Object.freeze(['click', 'move']);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clampTick(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return LOOP_TICK_MS_DEFAULT;
  return Math.min(LOOP_TICK_MS_MAX, Math.max(LOOP_TICK_MS_MIN, n));
}

function validRegion(region) {
  if (!isPlainObject(region)) return false;
  for (const key of ['x', 'y']) if (!Number.isFinite(Number(region[key])) || Number(region[key]) < 0) return false;
  for (const key of ['width', 'height']) if (!Number.isFinite(Number(region[key])) || Number(region[key]) <= 0) return false;
  return true;
}

function validThreshold(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

function validateSensor(sensor) {
  if (!isPlainObject(sensor)) return 'Each sensor must be an object.';
  if (typeof sensor.id !== 'string' || sensor.id.length < 1 || sensor.id.length > 80) return 'Sensor id must be 1-80 characters.';
  if (!LOOP_SENSOR_KINDS.includes(sensor.kind)) return 'Sensor kind is not allowlisted.';
  const allowedKeys = sensor.kind === 'regionHash'
    ? ['id', 'kind', 'region']
    : sensor.kind === 'pixelDiff'
      ? ['id', 'kind', 'region', 'threshold']
      : sensor.kind === 'templateMatch'
        ? ['id', 'kind', 'template', 'region', 'threshold']
        : sensor.kind === 'stillness'
          ? ['id', 'kind', 'region', 'threshold', 'stillTicks']
          : sensor.kind === 'track'
            ? ['id', 'kind', 'region', 'threshold', 'leadMs', 'pad']
            : ['id', 'kind', 'everyMs'];
  const unexpectedKey = Object.keys(sensor).find((key) => !allowedKeys.includes(key));
  if (unexpectedKey) return `Sensor ${sensor.kind} does not allow ${unexpectedKey}.`;
  if (sensor.kind !== 'timer' && !validRegion(sensor.region)) return `Sensor ${sensor.kind} requires a valid region.`;
  if (sensor.kind !== 'regionHash' && sensor.kind !== 'timer' && !validThreshold(sensor.threshold)) {
    return `Sensor ${sensor.kind} requires a threshold from 0 to 1.`;
  }
  if (sensor.kind === 'track') {
    const leadMs = sensor.leadMs === undefined ? 500 : Number(sensor.leadMs);
    if (!Number.isFinite(leadMs) || leadMs < 50 || leadMs > 5000) return 'Sensor track requires leadMs from 50 to 5000.';
    const pad = sensor.pad === undefined ? 0 : Number(sensor.pad);
    if (!Number.isFinite(pad) || pad < 0 || pad > 2000) return 'Sensor track requires pad from 0 to 2000.';
  }
  if (sensor.kind === 'templateMatch') {
    if (typeof sensor.template !== 'string' || sensor.template.length < 1 || sensor.template.length > LOOP_TEMPLATE_MAX_BYTES) {
      return `Sensor templateMatch requires a template of 1-${LOOP_TEMPLATE_MAX_BYTES} characters.`;
    }
  }
  if (sensor.kind === 'timer') {
    const everyMs = Number(sensor.everyMs);
    if (!Number.isFinite(everyMs) || everyMs < LOOP_TIMER_MIN_MS || everyMs > LOOP_TIMER_MAX_MS) {
      return `Sensor timer requires everyMs from ${LOOP_TIMER_MIN_MS} to ${LOOP_TIMER_MAX_MS}.`;
    }
  }
  if (sensor.kind === 'stillness' && sensor.stillTicks !== undefined) {
    if (!Number.isInteger(sensor.stillTicks) || sensor.stillTicks < LOOP_STILL_TICKS_MIN || sensor.stillTicks > LOOP_STILL_TICKS_MAX) {
      return `Sensor stillness requires stillTicks from ${LOOP_STILL_TICKS_MIN} to ${LOOP_STILL_TICKS_MAX}.`;
    }
  }
  return null;
}

function validateAction(action) {
  if (!isPlainObject(action)) return 'Each rule action must be an object.';
  if (!LOOP_ACTIONS.includes(action.action)) return 'Rule action is not allowlisted.';
  if (action.action === 'key') {
    if (typeof action.key !== 'string' || action.key.length < 1 || action.key.length > 50) return 'Key action requires a key of 1-50 characters.';
    const unexpectedKey = Object.keys(action).find((key) => !['action', 'key'].includes(key));
    if (unexpectedKey) return `Key action does not allow ${unexpectedKey}.`;
    return null;
  }
  if (!LOOP_POINTER_ACTIONS.includes(action.pointerAction)) return 'Pointer action must be click or move.';
  for (const key of ['x', 'y']) if (!Number.isFinite(Number(action[key]))) return `Invalid pointer ${key}.`;
  const unexpectedKey = Object.keys(action).find((key) => !['action', 'pointerAction', 'x', 'y'].includes(key));
  if (unexpectedKey) return `Pointer action does not allow ${unexpectedKey}.`;
  return null;
}

export function classifyTickBand(workMs) {
  const n = Number(workMs);
  if (!Number.isFinite(n) || n <= LOOP_TICK_BANDS.green) return 'green';
  if (n <= LOOP_TICK_BANDS.yellow) return 'yellow';
  if (n <= LOOP_TICK_BANDS.orange) return 'orange';
  return 'red';
}

export function validateLoopProgram(program) {
  if (!isPlainObject(program)) return { ok: false, error: 'Loop program must be an object.' };
  const unexpectedParam = Object.keys(program).find((key) => !['tickMs', 'maxTicks', 'maxDurationMs', 'sensors', 'rules', 'stopWhen', 'trusted'].includes(key));
  if (unexpectedParam) return { ok: false, error: `Loop program does not allow ${unexpectedParam}.` };
  if (program.trusted !== undefined && typeof program.trusted !== 'boolean') {
    return { ok: false, error: 'Loop trusted must be a boolean.' };
  }
  if (!Array.isArray(program.sensors) || program.sensors.length < 1 || program.sensors.length > LOOP_MAX_SENSORS) {
    return { ok: false, error: `Loop program requires 1-${LOOP_MAX_SENSORS} sensors.` };
  }
  if (!Array.isArray(program.rules) || program.rules.length < 1 || program.rules.length > LOOP_MAX_RULES) {
    return { ok: false, error: `Loop program requires 1-${LOOP_MAX_RULES} rules.` };
  }
  const ids = new Set();
  for (const sensor of program.sensors) {
    const error = validateSensor(sensor);
    if (error) return { ok: false, error };
    if (ids.has(sensor.id)) return { ok: false, error: `Duplicate sensor id ${sensor.id}.` };
    ids.add(sensor.id);
  }
  for (let index = 0; index < program.rules.length; index += 1) {
    const rule = program.rules[index];
    if (!isPlainObject(rule) || !isPlainObject(rule.when)) return { ok: false, error: `Invalid loop rule ${index}: when must be an object.` };
    if (!ids.has(rule.when.sensor)) return { ok: false, error: `Invalid loop rule ${index}: unknown sensor.` };
    const actionError = validateAction(rule.do);
    if (actionError) return { ok: false, error: `Invalid loop rule ${index}: ${actionError}` };
  }
  if (program.stopWhen !== undefined) {
    if (!Array.isArray(program.stopWhen)) return { ok: false, error: 'Loop stopWhen must be an array.' };
    for (const entry of program.stopWhen) {
      if (!isPlainObject(entry) || !ids.has(entry.sensor)) return { ok: false, error: 'Loop stopWhen must reference declared sensors.' };
    }
  }
  // Budgets fail closed: an explicit out-of-range maxTicks or maxDurationMs is
  // rejected, never silently clamped to the max. Only an absent budget (or
  // null, which JSON callers use for absent) falls back to the max allowance.
  if (program.maxTicks !== undefined && program.maxTicks !== null) {
    const maxTicks = Number(program.maxTicks);
    if (!Number.isInteger(maxTicks) || maxTicks < 1 || maxTicks > LOOP_MAX_TICKS) {
      return { ok: false, error: `Loop maxTicks must be an integer from 1 to ${LOOP_MAX_TICKS}.` };
    }
  }
  if (program.maxDurationMs !== undefined && program.maxDurationMs !== null) {
    const maxDurationMs = Number(program.maxDurationMs);
    if (!Number.isFinite(maxDurationMs) || maxDurationMs < 50 || maxDurationMs > LOOP_MAX_DURATION_MS) {
      return { ok: false, error: `Loop maxDurationMs must be from 50 to ${LOOP_MAX_DURATION_MS}.` };
    }
  }
  return {
    ok: true,
    program: {
      tickMs: program.tickMs === undefined ? LOOP_TICK_MS_DEFAULT : clampTick(program.tickMs),
      maxTicks: program.maxTicks === undefined || program.maxTicks === null ? LOOP_MAX_TICKS : Number(program.maxTicks),
      maxDurationMs: program.maxDurationMs === undefined || program.maxDurationMs === null ? LOOP_MAX_DURATION_MS : Number(program.maxDurationMs),
      sensors: program.sensors.map((sensor) => {
        if (sensor.kind === 'stillness' && sensor.stillTicks === undefined) {
          return { ...sensor, stillTicks: LOOP_STILL_TICKS_DEFAULT };
        }
        if (sensor.kind === 'track') {
          return {
            ...sensor,
            leadMs: sensor.leadMs === undefined ? 500 : Number(sensor.leadMs),
            pad: sensor.pad === undefined ? 0 : Number(sensor.pad)
          };
        }
        return sensor;
      }),
      rules: program.rules,
      stopWhen: program.stopWhen || [],
      trusted: program.trusted === true
    }
  };
}

// Tick state: the executor brain without any DOM. Bands feed the degrade
// ladder (full → degraded → shed) and consecutive reds trip the overrun
// guard; green ticks flush the window back to full.

export const LOOP_TRACE_LIMIT = 500;
export const LOOP_BAND_WINDOW = 20;
export const LOOP_OVERRUN_REDS = 5;

export function startLoopState() {
  return { tick: 0, firedTotal: 0, trace: [], bands: [] };
}

function recentBands(state) {
  return state.bands.slice(-LOOP_BAND_WINDOW);
}

export function loopMode(state) {
  const bands = recentBands(state);
  if (bands.includes('orange') || bands.includes('red')) return 'shed';
  if (bands.includes('yellow')) return 'degraded';
  return 'full';
}

export function loopOverrun(state) {
  const tail = state.bands.slice(-LOOP_OVERRUN_REDS);
  return tail.length >= LOOP_OVERRUN_REDS && tail.every((band) => band === 'red');
}

export function recordTick(state, reading = {}) {
  const band = classifyTickBand(reading.workMs);
  const fired = Number.isFinite(Number(reading.fired)) && Number(reading.fired) > 0 ? Math.floor(Number(reading.fired)) : 0;

  // Active sensor ids ride the trace so inputs (rules bound to them) can be
  // matched against outputs (unbound sense-only sensors) after the run.
  // Compact per-sensor values ride along for the same reason: a sensor that
  // never fires is indistinguishable from a blind one without its numbers.
  const active = Array.isArray(reading.active) ? reading.active.filter((id) => typeof id === 'string').slice(0, 8) : [];
  const values = {};
  if (reading.values && typeof reading.values === 'object') {
    for (const [key, value] of Object.entries(reading.values).slice(0, 8)) {
      if (typeof key === 'string' && (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean')) {
        values[key] = typeof value === 'number' ? Math.round(value * 1000) / 1000 : String(value).slice(0, 32);
      }
    }
  }
  state.tick += 1;
  state.firedTotal += fired;
  state.bands.push(band);
  if (state.bands.length > LOOP_BAND_WINDOW) state.bands.splice(0, state.bands.length - LOOP_BAND_WINDOW);
  state.trace.push({ tick: state.tick, band, fired, sensors: active, values });

  // Phase timings ride along when the caller measured them: capture, sense,
  // and act have different owners (CDP, pixel math, input), so a slow tick
  // is only diagnosable when the total is split.
  if (reading.timing && typeof reading.timing === 'object') {
    const timing = {};
    for (const [key, value] of Object.entries(reading.timing).slice(0, 8)) {
      if (typeof value === 'number' && Number.isFinite(value)) timing[key] = Math.round(value * 10) / 10;
    }
    state.trace[state.trace.length - 1].timing = timing;
  }
  if (state.trace.length > LOOP_TRACE_LIMIT) state.trace.splice(0, state.trace.length - LOOP_TRACE_LIMIT);
  return { band, mode: loopMode(state), overrun: loopOverrun(state) };
}

// Pixel sensors: pure RGBA math over caller-supplied buffers. The executor
// reads pixels via canvas in-page; these functions decide what the pixels
// mean, so they run identically in Node tests and in the content script.

function luminanceAt(data, i) {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

function validRgba(data, width, height) {
  return data && typeof data.length === 'number' && Number.isInteger(width) && Number.isInteger(height)
    && width > 0 && height > 0 && data.length === width * height * 4;
}

export function downscaleHash(data, width, height, size = 8) {
  if (!validRgba(data, width, height) || !Number.isInteger(size) || size < 2 || size > 32) return null;
  const cells = [];
  for (let cy = 0; cy < size; cy += 1) {
    for (let cx = 0; cx < size; cx += 1) {
      const x0 = Math.floor((cx * width) / size);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / size));
      const y0 = Math.floor((cy * height) / size);
      const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / size));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          sum += luminanceAt(data, (y * width + x) * 4);
          count += 1;
        }
      }
      cells.push(Math.round(sum / count));
    }
  }
  return cells.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function pixelDiff(a, b, perPixel = 16) {
  if (!a || !b || a.length !== b.length || a.length % 4 !== 0 || a.length === 0) return null;
  const threshold = Number(perPixel);
  if (!Number.isFinite(threshold) || threshold < 0) return null;
  let changed = 0;
  const pixels = a.length / 4;
  for (let p = 0; p < pixels; p += 1) {
    const i = p * 4;
    const drift = Math.max(
      Math.abs(a[i] - b[i]),
      Math.abs(a[i + 1] - b[i + 1]),
      Math.abs(a[i + 2] - b[i + 2])
    );
    if (drift > threshold) changed += 1;
  }
  return changed / pixels;
}

export function matchTemplate(region, regionWidth, regionHeight, template, templateWidth, templateHeight, stride = 1) {  if (!validRgba(region, regionWidth, regionHeight) || !validRgba(template, templateWidth, templateHeight)) return null;
  if (templateWidth > regionWidth || templateHeight > regionHeight) return null;
  const step = Number.isInteger(stride) && stride >= 1 ? stride : 1;
  let best = null;
  for (let y = 0; y <= regionHeight - templateHeight; y += step) {
    for (let x = 0; x <= regionWidth - templateWidth; x += step) {
      let sum = 0;
      for (let ty = 0; ty < templateHeight; ty += 1) {
        for (let tx = 0; tx < templateWidth; tx += 1) {
          const ri = ((y + ty) * regionWidth + (x + tx)) * 4;
          const ti = (ty * templateWidth + tx) * 4;
          sum += Math.abs(region[ri] - template[ti]) + Math.abs(region[ri + 1] - template[ti + 1]) + Math.abs(region[ri + 2] - template[ti + 2]);
        }
      }
      const score = 1 - sum / (templateWidth * templateHeight * 3 * 255);
      if (!best || score > best.score) best = { score, x, y };
    }
  }
  return best;
}

// Changed-mass centroid: where the motion is, not just whether any exists.
// Uniform scrolling (ground dots) centres every frame, so its velocity reads
// ~0 and stays quiet; an entering obstacle shifts the centroid hard.

export const LOOP_TRACK_MIN_RUN = 12;

// Rightmost solid front: the x of the rightmost column holding a vertical
// run of changed pixels. Speckle (ground dots, JPEG shimmer) never forms a
// run, so it cannot pin the front; a cactus column always does. This is what
// lets a track sensor ignore texture and time the threat itself.

export function frontOfChanged(a, b, width, height, perPixel = 16, minRun = LOOP_TRACK_MIN_RUN) {
  if (!a || !b || a.length !== b.length || a.length !== width * height * 4 || a.length === 0) return null;
  const threshold = Number(perPixel);
  const run = Number(minRun);
  if (!Number.isFinite(threshold) || threshold < 0 || !Number.isInteger(run) || run < 1) return null;
  for (let x = width - 1; x >= 0; x -= 1) {
    let streak = 0;
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * 4;
      const drift = Math.max(
        Math.abs(a[i] - b[i]),
        Math.abs(a[i + 1] - b[i + 1]),
        Math.abs(a[i + 2] - b[i + 2])
      );
      if (drift > threshold) {
        streak += 1;
        if (streak >= run) return x;
      } else {
        streak = 0;
      }
    }
  }
  return null;
}

// Time-to-impact from two front sightings. Positions run in crop pixels with
// x growing rightward, so an approaching obstacle has a falling x. Returns
// impact milliseconds, or null when there is nothing to time.

export function centroidTrack(prevX, currX, dtMs, padPx, leadMs) {
  if (prevX == null || currX == null) return null;
  const dt = Number(dtMs);
  const pad = Number(padPx);
  const lead = Number(leadMs);
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(pad) || !Number.isFinite(lead)) return null;
  const velocity = (Number(prevX) - Number(currX)) / dt;
  if (!(velocity > 0)) return null;
  const tti = (Number(currX) - pad) / velocity;
  if (tti <= 0) return 0;
  return tti <= lead ? tti : null;
}
