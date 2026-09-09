const MAX_OPERATIONS = 100;
const MAX_DEPTH = 6;
const MAX_REPEAT = 20;
const MAX_ITEMS = 20;
const MAX_TOP_LEVEL_STEPS = 40;

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function getRef(ctx, path) {
  if (!path) return null;
  let cur = ctx;
  for (const part of String(path).split('.')) {
    if (cur == null || typeof cur !== 'object' || !(part in cur)) return null;
    cur = cur[part];
  }
  return cur;
}

export function resolveValue(value, ctx) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, ctx));
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, '$ref')) return getRef(ctx, value.$ref);
    if (Object.prototype.hasOwnProperty.call(value, '$concat')) {
      const parts = Array.isArray(value.$concat) ? value.$concat : [];
      return parts.map((part) => {
        const resolved = resolveValue(part, ctx);
        if (resolved == null) return '';
        return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
      }).join('');
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = resolveValue(item, ctx);
    return out;
  }
  return value;
}

function truthy(value) {
  if (value == null || value === false || value === 0 || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return false;
  return true;
}

export function evaluateCondition(condition, ctx) {
  const op = String(condition?.op || 'truthy');
  const left = resolveValue(condition?.left, ctx);
  const right = resolveValue(condition?.right, ctx);
  if (op === 'exists') return left !== null && left !== undefined;
  if (op === 'not_exists') return left === null || left === undefined;
  if (op === 'eq') return JSON.stringify(left) === JSON.stringify(right);
  if (op === 'ne') return JSON.stringify(left) !== JSON.stringify(right);
  if (op === 'contains') return String(left ?? '').includes(String(right ?? ''));
  if (op === 'falsey') return !truthy(left);
  return truthy(left);
}

function consumeBudget(state, deadline, depth) {
  if (depth > MAX_DEPTH) throw new Error('Local plan nesting limit exceeded.');
  if (Date.now() >= deadline) throw new Error('Local plan deadline exceeded.');
  state.operations += 1;
  if (state.operations > MAX_OPERATIONS) throw new Error('Local plan operation limit exceeded.');
}

async function runSteps(steps, ctx, state, options, depth = 0) {
  if (!Array.isArray(steps)) throw new Error('Local plan steps must be an array.');
  for (const step of steps) {
    consumeBudget(state, options.deadline, depth);
    const type = String(step?.type || 'command');
    const id = String(step?.id || `step_${state.operations}`);

    if (type === 'command') {
      const method = String(step?.method || '');
      if (!options.isMethodAllowed(method) || method === options.planMethod) {
        throw new Error(`Local plan method is not allowed: ${method || '<empty>'}`);
      }
      const params = resolveValue(step?.params || {}, ctx);
      try {
        ctx.steps[id] = await options.dispatch(method, params, options.deadline);
      } catch (error) {
        const failed = { ok: false, error: options.normalizeError(error) };
        ctx.steps[id] = failed;
        if (!step?.continueOnError) throw error;
      }
      continue;
    }

    if (type === 'set') {
      const name = String(step?.name || '');
      if (!name) throw new Error('Local plan set step requires name.');
      ctx.vars[name] = resolveValue(step?.value, ctx);
      continue;
    }

    if (type === 'wait') {
      const ms = clampNumber(step?.ms, 0, 5000, 100);
      if (ms) await options.sleep(Math.min(ms, Math.max(0, options.deadline - Date.now())));
      continue;
    }

    if (type === 'if') {
      const branch = evaluateCondition(step?.condition || {}, ctx) ? (step?.then || []) : (step?.else || []);
      await runSteps(branch, ctx, state, options, depth + 1);
      continue;
    }

    if (type === 'repeat') {
      const max = clampNumber(step?.maxIterations, 1, MAX_REPEAT, 5);
      let satisfied = false;
      for (let i = 0; i < max; i += 1) {
        await runSteps(step?.steps || [], ctx, state, options, depth + 1);
        if (evaluateCondition(step?.until || {}, ctx)) {
          satisfied = true;
          break;
        }
      }
      if (!satisfied && step?.failOnLimit !== false) {
        throw new Error('Local plan repeat limit reached before condition was satisfied.');
      }
      continue;
    }

    if (type === 'foreach') {
      const items = resolveValue(step?.items || [], ctx);
      if (!Array.isArray(items)) throw new Error('Local plan foreach items must resolve to an array.');
      const max = clampNumber(step?.maxItems, 1, MAX_ITEMS, 20);
      const itemVar = String(step?.itemVar || 'item');
      const collectVar = step?.collectVar ? String(step.collectVar) : null;
      const collected = [];
      for (let index = 0; index < Math.min(max, items.length); index += 1) {
        ctx.vars[itemVar] = items[index];
        ctx.vars.index = index;
        await runSteps(step?.steps || [], ctx, state, options, depth + 1);
        if (collectVar && Object.prototype.hasOwnProperty.call(step, 'collect')) {
          collected.push(resolveValue(step.collect, ctx));
        }
      }
      if (collectVar) ctx.vars[collectVar] = collected;
      continue;
    }

    if (type === 'fail') throw new Error(String(step?.message || 'Local plan failed.'));
    throw new Error(`Unsupported local plan step type: ${type}`);
  }
}

export async function executePlan(params, options) {
  const steps = params?.steps;
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('browser.plan requires a non-empty steps array.');
  if (steps.length > MAX_TOP_LEVEL_STEPS) throw new Error('browser.plan top-level step limit exceeded.');
  const ctx = { input: params?.input || {}, vars: {}, steps: {} };
  const state = { operations: 0 };
  const normalized = {
    ...options,
    deadline: Number(options.deadline),
    planMethod: options.planMethod || 'browser.plan',
    sleep: options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    normalizeError: options.normalizeError || ((error) => ({ code: 'EXECUTION_ERROR', message: String(error?.message || error) }))
  };
  if (!Number.isFinite(normalized.deadline)) throw new Error('Local plan deadline is required.');
  if (typeof normalized.dispatch !== 'function' || typeof normalized.isMethodAllowed !== 'function') {
    throw new Error('Local plan execution hooks are missing.');
  }
  await runSteps(steps, ctx, state, normalized, 0);
  const result = Object.prototype.hasOwnProperty.call(params || {}, 'output') ? resolveValue(params.output, ctx) : ctx;
  return { ok: true, operations: state.operations, result };
}

export const PLAN_LIMITS = Object.freeze({
  maxOperations: MAX_OPERATIONS,
  maxDepth: MAX_DEPTH,
  maxRepeat: MAX_REPEAT,
  maxItems: MAX_ITEMS,
  maxTopLevelSteps: MAX_TOP_LEVEL_STEPS
});
