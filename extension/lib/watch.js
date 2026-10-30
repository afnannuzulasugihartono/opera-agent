// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: watch — the local watch-rule engine that evaluates rules against page facts.
// @state: exports TRIGGER_KINDS, validateRule and evaluateRules; no DOM, no chrome — the caller supplies fact snapshots, once-mode rules retire after firing, every rule retires past deadline or maxEvents.
// @dependencies: none.

// Pure watch-rule policy engine â€” no DOM, no chrome; the caller supplies fact snapshots, so it stays deterministic and testable in Node.

// WHY local evaluation: the model compiles intent into rules ONCE and the device evaluates them against page facts, so reaction speed follows the page instead of the model round trip.

// Locked by tests/etw-watch-engine.test.mjs: already-true-at-arm fires immediately (an ad on screen when the watcher installs must be acted on, not swallowed); repeat rules re-fire on every match, throttled by debounce; selectorGone needs a real presence->absent transition; urlChange and navigation fire against a first-sight baseline; mediaTime fires on crossing atSeconds; once rules retire after their first fire, and every rule retires past its deadline or maxEvents budget.

export const TRIGGER_KINDS = new Set([
  'selectorPresence',
  'selectorGone',
  'textMatch',
  'urlChange',
  'adState',
  'mediaTime',
  'navigation'
]);

const ACTION_TYPES = new Set([
  'report',
  'click',
  'burst',
  'workflow',
  'confirm'
]);
const RULE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LIMITS = {
  selectorMax: 500,
  textMax: 500,
  deadlineMin: 1000,
  deadlineMax: 600000,
  debounceMin: 0,
  debounceMax: 60000,
  maxEventsMin: 1,
  maxEventsMax: 100,
  mediaAtMax: 86400,
  mediaWithinMax: 60
};

function fail(reason) {
  return {
    ok: false,
    reason
  };
}

/**
 * Validate a watch rule's shape and limits before it is armed.
 * @param {*} rule The rule object.
 * @returns {{ ok: true } | { ok: false, reason: string }} The verdict.
 */

export function validateRule(rule) {
  if (!rule || typeof rule !== 'object') return fail('Rule must be an object.');
  if (typeof rule.ruleId !== 'string' || !RULE_ID_RE.test(rule.ruleId)) {
    return fail('ruleId must be 1-64 chars of [A-Za-z0-9_-].');
  }
  const t = rule.trigger;
  if (!t || typeof t !== 'object' || !TRIGGER_KINDS.has(t.kind)) {
    return fail(`trigger.kind must be one of: ${[...TRIGGER_KINDS].join(', ')}.`);
  }
  if (t.kind === 'selectorPresence' || t.kind === 'selectorGone') {
    if (typeof t.selector !== 'string' || !t.selector.trim() || t.selector.length > LIMITS.selectorMax) {
      return fail('selector triggers need a non-empty selector (<= 500 chars).');
    }
  }
  if (t.kind === 'textMatch') {
    if (typeof t.text !== 'string' || !t.text.trim() || t.text.length > LIMITS.textMax) {
      return fail('textMatch needs non-empty text (<= 500 chars).');
    }
    if (t.mode !== undefined && ![
      'contains',
      'exact'
    ].includes(t.mode)) {
      return fail('textMatch.mode must be "contains" or "exact" (regex is intentionally not supported).');
    }
  }
  if (t.kind === 'adState' && t.state !== undefined && ![
    'on',
    'off',
    'any'
  ].includes(t.state)) {
    return fail('adState.state must be "on", "off" or "any".');
  }
  if (t.kind === 'mediaTime') {
    const at = Number(t.atSeconds);
    if (!Number.isFinite(at) || at < 0 || at > LIMITS.mediaAtMax) {
      return fail(`mediaTime.atSeconds must be 0..${LIMITS.mediaAtMax}.`);
    }
    if (t.withinSeconds !== undefined) {
      const w = Number(t.withinSeconds);
      if (!Number.isFinite(w) || w < 0 || w > LIMITS.mediaWithinMax) {
        return fail(`mediaTime.withinSeconds must be 0..${LIMITS.mediaWithinMax}.`);
      }
    }
  }
  const a = rule.action;
  if (!a || typeof a !== 'object' || !ACTION_TYPES.has(a.type)) {
    return fail(`action.type must be one of: ${[...ACTION_TYPES].join(', ')}.`);
  }
  if ((a.type === 'click') && !(t.kind === 'selectorPresence' || t.kind === 'selectorGone') && typeof a.selector !== 'string') {
    return fail('click needs the trigger selector or an explicit action.selector.');
  }
  if (a.type === 'workflow' && (typeof a.workflowName !== 'string' || !a.workflowName.trim())) {
    return fail('workflow action needs workflowName.');
  }
  if (a.type === 'burst' && (!Array.isArray(a.steps) || a.steps.length === 0 || a.steps.length > 8)) {
    return fail('burst action needs 1..8 steps (validated again by the burst executor).');
  }
  if (a.type === 'confirm' && (typeof a.message !== 'string' || a.message.length > 500)) {
    return fail('confirm action needs a short message.');
  }
  if (rule.mode !== undefined && ![
    'once',
    'repeat'
  ].includes(rule.mode)) {
    return fail('mode must be "once" or "repeat".');
  }
  const deadline = rule.deadlineMs ?? 60000;
  if (!Number.isFinite(deadline) || deadline < LIMITS.deadlineMin || deadline > LIMITS.deadlineMax) {
    return fail(`deadlineMs must be ${LIMITS.deadlineMin}..${LIMITS.deadlineMax}.`);
  }
  const maxEvents = rule.maxEvents ?? (rule.mode === 'repeat' ? 10 : 1);
  if (!Number.isFinite(maxEvents) || maxEvents < LIMITS.maxEventsMin || maxEvents > LIMITS.maxEventsMax) {
    return fail(`maxEvents must be ${LIMITS.maxEventsMin}..${LIMITS.maxEventsMax}.`);
  }
  const debounce = rule.debounceMs ?? (rule.mode === 'repeat' ? 1000 : 0);
  if (!Number.isFinite(debounce) || debounce < LIMITS.debounceMin || debounce > LIMITS.debounceMax) {
    return fail(`debounceMs must be ${LIMITS.debounceMin}..${LIMITS.debounceMax}.`);
  }
  return { ok: true };
}

function matchesTrigger(
  rule,
  snapshot,
  rs
) {
  const t = rule.trigger;
  switch (t.kind) {
    case 'selectorPresence':
      return snapshot.facts?.[rule.ruleId]?.present === true;
    case 'selectorGone': {
      const present = snapshot.facts?.[rule.ruleId]?.present;
      if (present === true) rs.priorPresent = true;
      return rs.priorPresent === true && present === false;
    }
    case 'textMatch': {
      const haystack = typeof snapshot.text === 'string' ? snapshot.text : '';
      return t.mode === 'exact'
        ? haystack.trim() === t.text.trim()
        : haystack.includes(t.text);
    }
    case 'urlChange':
    case 'navigation': {
      const url = typeof snapshot.url === 'string' ? snapshot.url : '';
      if (rs.baselineUrl === undefined) {
        rs.baselineUrl = url;
        return false;
      }
      return url !== rs.baselineUrl;
    }
    case 'adState': {
      const want = t.state ?? 'on';
      if (want === 'any') return true;
      return want === 'on' ? snapshot.adState === true : snapshot.adState === false;
    }
    case 'mediaTime': {
      const at = Number(t.atSeconds);
      const prev = rs.prevMediaTime;
      const cur = Number(snapshot.mediaTime) || 0;
      rs.prevMediaTime = cur;
      if (prev === undefined) return cur >= at;
      return prev < at && cur >= at;
    }
    default:
      return false;
  }
}

/**
 * Evaluate armed rules against one page-fact snapshot and return what fired plus the next state.
 * Rules retire past their deadline or maxEvents; once-mode rules retire after their first fire.
 * @param {Array<object>} rules The armed rules.
 * @param {object} snapshot The page facts: url, text, adState, mediaTime, per-rule presence.
 * @param {object} [state] The carried per-rule state from the previous evaluation.
 * @param {number} now Current time in milliseconds.
 * @returns {{ fired: Array<{ ruleId: string, action: object, atMs: number, fireCount: number }>, state: object }} What fired and the state to carry forward.
 */

export function evaluateRules(
  rules,
  snapshot,
  state,
  now
) {
  const next = { ...(state || {}) };
  const fired = [];
  for (const rule of rules) {
    const rs = { ...(next[rule.ruleId] || {}) };
    next[rule.ruleId] = rs;
    if (rs.retired) continue;
    if (rs.armedAt === undefined) rs.armedAt = now;
    if (now - rs.armedAt > (rule.deadlineMs ?? 60000)) {
      rs.retired = true;
      rs.retiredReason = 'deadline';
      continue;
    }
    if ((rs.fireCount || 0) >= (rule.maxEvents ?? 1)) {
      rs.retired = true;
      rs.retiredReason = 'maxEvents';
      continue;
    }
    if (!matchesTrigger(rule, snapshot, rs)) continue;
    const debounce = rule.debounceMs ?? (rule.mode === 'repeat' ? 1000 : 0);
    if (rs.lastFireAt !== undefined && now - rs.lastFireAt < debounce) continue;
    rs.fireCount = (rs.fireCount || 0) + 1;
    rs.lastFireAt = now;
    if (rule.mode !== 'repeat') rs.retired = true;
    if (rule.mode === 'repeat' && (rule.trigger.kind === 'urlChange' || rule.trigger.kind === 'navigation')) {
      rs.baselineUrl = snapshot.url;
    }
    fired.push({
      ruleId: rule.ruleId,
      action: rule.action,
      atMs: now,
      fireCount: rs.fireCount
    });
  }
  return {
    fired,
    state: next
  };
}
