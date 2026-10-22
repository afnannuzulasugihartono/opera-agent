// @last-edited: 2026-10-22 UTC+7.
// @title: burst — dependent steps on one tab, with one page look at the end.
// @state: the action vocabulary, a checked step list, and a stop-on-failure runner.
// @dependencies: none.

// WHY THIS FILE EXISTS

// The local surface sends one action per call, and every call pays the same fixed cost: the protocol turn, the settle, and the page read that rides back with the answer.
// A menu walk is three or four dependent moves, so the cost is paid three or four times for a page that has not been looked at since the first move.
// The cloud burst already proved the shape on the other side of the wire; this is the same shape without the wire.

// WHY IT IS NOT THE CLOUD BURST.
// The cloud burst can switch tabs and carry a reference to a row created by an earlier action.
// This one stays on the tab the tool was given, because a local drive that silently moves to another tab is how a batch lands in the wrong document.
// It still carries a handle from an earlier resolve, which is the part that removes the stale-coordinate problem.

export const BURST_MAX_STEPS = 8;
export const BURST_MAX_TIMEOUT_MS = 12000;
export const BURST_ACTIONS = Object.freeze([
  'click',
  'click_row',
  'hover',
  'press_key',
  'type',
  'append',
  'scroll',
  'stream_keys',
  'resolve',
  'wait'
]);

// A read-only burst must not bring a window forward.
// The person may be reading something else, and a resolve or a wait has no reason to take the machine's attention.

export const BURST_INPUT_ACTIONS = Object.freeze([
  'click',
  'click_row',
  'hover',
  'press_key',
  'type',
  'append',
  'scroll',
  'stream_keys'
]);

const STEP_KEYS = Object.freeze({
  click: ['action', 'x', 'y', 'handle', 'refFromStep'],
  click_row: ['action', 'role', 'name'],
  hover: ['action', 'x', 'y', 'refFromStep'],
  press_key: ['action', 'key', 'modifiers'],
  type: ['action', 'text'],
  append: ['action', 'text'],
  scroll: ['action', 'y', 'end', 'text', 'selector'],
  stream_keys: ['action', 'events'],
  resolve: ['action', 'role', 'name'],
  wait: ['action', 'text', 'role', 'name', 'absent', 'timeoutMs', 'intervalMs']
});

const MODIFIERS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function onlyKeys(value, allowed, where) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${where} has unknown key "${key}"`);
  }
}

function textOf(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
  return value;
}

function modifiersOf(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('modifiers must be an array');
  for (const modifier of value) {
    if (!MODIFIERS.has(modifier)) throw new Error(`unknown modifier "${modifier}"`);
  }
  return value;
}

function pointOf(step, where) {
  if (step.x === undefined && step.y === undefined) return null;
  if (step.x === undefined || step.y === undefined) throw new Error(`${where} needs both x and y`);
  const x = Number(step.x);
  const y = Number(step.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${where} needs finite x and y`);
  return { x, y };
}

function refOf(step, index, where) {
  if (step.refFromStep === undefined) return null;
  const ref = Number(step.refFromStep);
  if (!Number.isInteger(ref) || ref < 0 || ref >= index) {
    throw new Error(`${where}: refFromStep must point at an earlier step`);
  }
  return ref;
}

function targetOf(step, index, where, { handle = false } = {}) {
  const point = pointOf(step, where);
  const ref = refOf(step, index, where);
  const named = step.handle === undefined ? null : textOf(step.handle, `${where} handle`);
  const modes = Number(point !== null) + Number(ref !== null) + Number(named !== null);
  if (modes !== 1) {
    throw new Error(`${where} needs exactly one of ${handle ? 'x/y, handle, or refFromStep' : 'x/y or refFromStep'}`);
  }
  if (named !== null && !handle) throw new Error(`${where} does not take a handle`);
  return { point, ref, handle: named };
}

function streamEvents(events, where) {
  if (!Array.isArray(events) || events.length < 1 || events.length > 100) {
    throw new Error(`${where} needs 1-100 events`);
  }
  return events.map((event, index) => {
    const at = `${where} event ${index}`;
    if (!isObject(event)) throw new Error(`${at} must be an object`);
    onlyKeys(event, ['key', 'modifiers', 'text', 'gapMs'], at);
    if (event.key === undefined && event.text === undefined) throw new Error(`${at} needs key or text`);
    if (event.key !== undefined && event.text !== undefined) throw new Error(`${at} has both key and text`);
    if (event.key !== undefined) textOf(event.key, `${at} key`);
    if (event.text !== undefined && typeof event.text !== 'string') throw new Error(`${at} text must be a string`);
    if (event.modifiers !== undefined) modifiersOf(event.modifiers);
    if (event.gapMs !== undefined && !Number.isFinite(Number(event.gapMs))) throw new Error(`${at} gapMs must be finite`);
    return { ...event };
  });
}

function waitStep(step, where) {
  const hasText = step.text !== undefined;
  const hasRow = step.role !== undefined || step.name !== undefined;
  if (hasText === hasRow) throw new Error(`${where} needs text or role and name, not both`);

  const out = { action: 'wait' };
  if (hasText) {
    out.text = textOf(step.text, `${where} text`);
  } else {
    out.role = textOf(step.role, `${where} role`);
    out.name = textOf(step.name, `${where} name`);
  }
  if (step.absent !== undefined) {
    if (typeof step.absent !== 'boolean') throw new Error(`${where} absent must be true or false`);
    out.absent = step.absent;
  }
  for (const name of ['timeoutMs', 'intervalMs']) {
    if (step[name] === undefined) continue;
    const value = Number(step[name]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${where} ${name} must be a finite number`);
    out[name] = value;
  }
  return out;
}

function normalizeStep(step, index) {
  const where = `step ${index}`;
  if (!isObject(step)) throw new Error(`${where} must be an object`);
  const action = String(step.action ?? '');
  if (!BURST_ACTIONS.includes(action)) {
    throw new Error(`${where} action "${action}" is not one of ${BURST_ACTIONS.join(', ')}`);
  }
  onlyKeys(step, STEP_KEYS[action], where);

  if (action === 'click' || action === 'hover') {
    const target = targetOf(step, index, where, { handle: action === 'click' });
    return {
      action,
      ...(target.point ? { x: target.point.x, y: target.point.y } : {}),
      ...(target.handle ? { handle: target.handle } : {}),
      ...(target.ref !== null ? { refFromStep: target.ref } : {})
    };
  }
  if (action === 'click_row' || action === 'resolve') {
    return {
      action,
      role: textOf(step.role, `${where} role`),
      name: textOf(step.name, `${where} name`)
    };
  }
  if (action === 'press_key') {
    return { action, key: textOf(step.key, `${where} key`), modifiers: modifiersOf(step.modifiers) };
  }
  if (action === 'type' || action === 'append') {
    if (typeof step.text !== 'string') throw new Error(`${where} text must be a string`);
    return { action, text: step.text };
  }
  if (action === 'stream_keys') {
    return { action, events: streamEvents(step.events, where) };
  }
  if (action === 'wait') return waitStep(step, where);

  const out = { action };
  if (step.y !== undefined) {
    const y = Number(step.y);
    if (!Number.isFinite(y)) throw new Error(`${where} y must be finite`);
    out.y = y;
  }
  if (step.end !== undefined) {
    if (typeof step.end !== 'boolean') throw new Error(`${where} end must be true or false`);
    out.end = step.end;
  }
  if (step.text !== undefined) out.text = textOf(step.text, `${where} text`);
  if (step.selector !== undefined) out.selector = textOf(step.selector, `${where} selector`);
  if (out.y === undefined && out.end === undefined && out.text === undefined && out.selector === undefined) {
    throw new Error(`${where} scroll needs y, end, text, or selector`);
  }
  return out;
}

export function normalizeBurst(args) {
  if (!Array.isArray(args?.steps) || args.steps.length < 1 || args.steps.length > BURST_MAX_STEPS) {
    throw new Error(`browser_burst needs 1-${BURST_MAX_STEPS} steps`);
  }
  const asked = Number(args.timeoutMs ?? BURST_MAX_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(asked)
    ? Math.min(BURST_MAX_TIMEOUT_MS, Math.max(500, Math.round(asked)))
    : BURST_MAX_TIMEOUT_MS;
  return { steps: args.steps.map(normalizeStep), timeoutMs };
}

function refAt(step, results) {
  if (step.refFromStep === undefined) return null;
  const found = results[step.refFromStep];
  if (!found) throw new Error(`refFromStep ${step.refFromStep} has no completed step behind it`);
  return found.result;
}

async function runStep(driver, step, results, remaining) {
  if (step.action === 'click') {
    const ref = refAt(step, results);
    if (!ref) return driver.click(step.x, step.y, step.handle ?? null);
    if (!ref.handle) throw new Error('refFromStep did not hand back a handle; resolve the row first');
    return driver.click(null, null, ref.handle);
  }
  if (step.action === 'click_row') return driver.clickRow(step.role, step.name);
  if (step.action === 'hover') {
    const ref = refAt(step, results);
    if (!ref) return driver.hover(step.x, step.y);
    const row = ref.row ?? ref;
    const x = Number(row?.x);
    const y = Number(row?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('refFromStep did not hand back a point to hover');
    return driver.hover(x, y);
  }
  if (step.action === 'press_key') return driver.key(step.key, step.modifiers ?? []);
  if (step.action === 'type') return driver.type(step.text);
  if (step.action === 'append') return driver.append(step.text);
  if (step.action === 'stream_keys') return driver.keys(step.events);
  if (step.action === 'resolve') return driver.resolve(step.role, step.name);
  if (step.action === 'scroll') {
    const options = {};
    if (step.y !== undefined) options.y = step.y;
    if (step.end !== undefined) options.end = step.end;
    if (step.text !== undefined) options.text = step.text;
    if (step.selector !== undefined) options.selector = step.selector;
    return driver.scroll(options);
  }

  const absent = step.absent === true;
  const options = {
    timeoutMs: Math.max(0, remaining),
    ...(step.intervalMs === undefined ? {} : { intervalMs: step.intervalMs })
  };
  if (step.text !== undefined) {
    if (typeof driver.waitForText !== 'function') throw new Error('this driver cannot wait for text');
    const state = await driver.waitForText(step.text, { ...options, absent });
    const present = String(state?.text ?? '').includes(step.text);
    if (present === absent) {
      throw new Error(`wait for "${step.text}" to ${absent ? 'leave' : 'appear'} timed out`);
    }
    return {
      found: true,
      present,
      absent,
      url: state?.url ?? null,
      title: state?.title ?? null,
      textChars: String(state?.text ?? '').length
    };
  }

  if (typeof driver.waitForRow !== 'function') throw new Error('this driver cannot wait for a row');
  const waited = await driver.waitForRow({
    role: step.role,
    name: step.name,
    absent,
    ...options
  });
  if (waited?.found !== true) {
    throw new Error(`wait for ${step.role} "${step.name}" to ${absent ? 'leave' : 'appear'} timed out`);
  }
  return waited;
}

export async function runLocalBurst({ driver, steps, timeoutMs = BURST_MAX_TIMEOUT_MS, now = Date.now }) {
  const clock = typeof now === 'function' ? now : Date.now;
  const started = clock();
  const deadline = started + timeoutMs;
  const results = [];

  const failure = (index, step, error, timedOut = false) => ({
    ok: false,
    timedOut,
    completedSteps: results.length,
    failedAt: index,
    failedAction: step.action,
    error: { message: error instanceof Error ? error.message : String(error) },
    results,
    timingMs: Math.max(0, clock() - started)
  });

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const remaining = deadline - clock();
    if (remaining < 50) {
      return failure(index, step, new Error(`browser_burst ran out of its ${timeoutMs} ms budget before step ${index}`), true);
    }
    const stepStarted = clock();
    try {
      const result = await runStep(driver, step, results, remaining);
      results.push({ index, action: step.action, ok: true, timingMs: Math.max(0, clock() - stepStarted), result });
    } catch (error) {
      return failure(index, step, error);
    }
  }

  return { ok: true, completedSteps: results.length, results, timingMs: Math.max(0, clock() - started) };
}
