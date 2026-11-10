// @last-edited: 2026-11-09 UTC+7.
// @title: plan-gate — the questions the bridge asks before it moves a command.
// @state: the plan check, the daily quota, the firm-only methods, and the refusal that names the plan.
// @dependencies: ./index.ts through the claim path.

// WHY THIS FILE EXISTS

// The gate lives in the service, and the service is the bridge: a device whose account has no active plan should never see a command, and one whose quota is spent should never see another one today.
// The checks are plain functions here so a unit test can refuse every bad door without a socket, a database, or a browser.

// WHY THE REFUSAL IS INTENTIONAL.
// A silent refusal is a bug report nobody writes; a named one is a support question that names the fix.
// Every refusal below carries the plan that ran out.

import { PLANS } from '../_shared/plans.js';

const FIRM_FEATURES = Object.freeze({
  all: 'the whole-page map',
  statements: 'statement delivery'
});

export function planIsActive(status) {
  return String(status || '') === 'active';
}

function firmOnlyMethods() {
  return [{ prefix: 'statement.', feature: 'statements' }];
}

export function capabilityAllowed(plan, method, params = {}) {
  const name = String(method ?? '');
  const mode = params?.all === true && params?.view === 'map';
  if (name === 'page.read' && mode) return { ok: plan === 'plan.firm', feature: 'all' };
  for (const { prefix, feature } of firmOnlyMethods()) {
    if (name.startsWith(prefix)) return { ok: plan === 'plan.firm', feature };
  }
  return { ok: true };
}

export function dailyQuota(plan) {
  return PLANS[plan]?.dailyQuota ?? PLANS['plan.pilot'].dailyQuota;
}

export function handshakeVerdict(profile) {
  if (!planIsActive(profile?.status)) {
    return { ok: false, code: 'PLAN_LIMIT_REACHED', message: `plan ${profile?.plan ?? 'plan.pilot'} is not active for this account` };
  }
  return { ok: true };
}

export function quotaAllowance(plan, usedToday) {
  const quota = dailyQuota(plan);
  return { ok: Number(usedToday) < quota, quota, used: Number(usedToday) || 0 };
}

export function gateVerdict(profile, command) {
  const plan = String(profile?.plan ?? 'plan.pilot');
  const standing = handshakeVerdict(profile);
  if (!standing.ok) return standing;

  const method = String(command?.method ?? '');
  const params = command?.params && typeof command.params === 'object' ? command.params : {};
  const capability = capabilityAllowed(plan, method, params);
  if (!capability.ok) {
    return {
      ok: false,
      code: 'PLAN_LIMIT_REACHED',
      message: `${FIRM_FEATURES[capability.feature]} requires plan.firm; plan is ${plan}`
    };
  }
  const allowance = quotaAllowance(plan, profile?.usedToday);
  if (!allowance.ok) {
    return {
      ok: false,
      code: 'PLAN_LIMIT_REACHED',
      message: `today's quota of ${allowance.quota} commands for ${plan} is used; resets tomorrow`
    };
  }
  return { ok: true, plan, quota: allowance.quota, used: allowance.used };
}
