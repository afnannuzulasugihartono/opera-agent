// @last-edited: 2026-11-09 UTC+7.
// @title: plans — what each plan allows, in one place, for both bridges.
// @state: the pilot and the firm, their daily quota, their session allowance, and the features only the firm gets.
// @dependencies: none.

// WHY THIS FILE EXISTS

// The gate lives in the service, never in the binary, so the service needs one place that says what a plan allows.
// Two surfaces read it: the hosted MCP for the account's plan, and the loopback bridge for the session allowance a paired device gets for that account.

// WHY THE NUMBERS ARE MIRRORED IN SQL.
// The RPC in the migration cannot import JavaScript, so the quotas are restated there; tests/billing/plans.test.mjs pins the two copies to the same numbers, which is how the two readers stay one plan.

export const PLANS = Object.freeze({
  'plan.pilot': Object.freeze({
    dailyQuota: 200,
    sessionAllowance: 50,
    features: Object.freeze({ all: false, statement: false, vm: false, remoteDrive: false })
  }),
  'plan.firm': Object.freeze({
    dailyQuota: 5000,
    sessionAllowance: 500,
    features: Object.freeze({ all: true, statement: true, vm: true, remoteDrive: true })
  })
});

export const DEFAULT_PLAN = 'plan.pilot';

export function planFor(name) {
  return PLANS[name] ?? PLANS[DEFAULT_PLAN];
}

export function allowsFeature(name, feature) {
  return planFor(name).features[feature] === true;
}

export function planQuota(name) {
  return planFor(name).dailyQuota;
}
