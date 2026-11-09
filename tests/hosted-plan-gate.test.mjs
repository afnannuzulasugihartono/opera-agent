// @last-edited: 2026-11-09 UTC+7.
// @title: hosted-plan-gate.test — the hosted caller learns its plan at the door, not at the wall.
// @state: the plan, its quota, today's usage for the account that owns the device, and the safe answer when the database cannot.
// @dependencies: node:test, strict, ../supabase/functions/opera-agent-mcp/plan-info.ts, ../supabase/functions/_shared/plans.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PLANS } from '../supabase/functions/_shared/plans.js';
import { planInfo } from '../supabase/functions/opera-agent-mcp/plan-info.ts';

function fakeDb({ plan = null, status = 'active', count = 0, reports = [], fail = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      if (fail) throw new Error('the database is behind');
      if (table === 'opera_account_plans') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: plan ? { plan, status } : null })
            })
          })
        };
      }
      if (table === 'opera_usage_reports') {
        return {
          select: () => ({
            eq: () => ({
              gte: async () => ({ data: reports })
            })
          })
        };
      }
      return {
        select: () => ({
          eq: () => ({
            gte: async () => ({ count })
          })
        })
      };
    }
  };
}

test('browser_status carries the plan for the account with the device', async () => {
  const answer = await planInfo(fakeDb({ plan: 'plan.firm', status: 'active', count: 314 }), 'user-1');
  assert.deepEqual(answer, { plan: 'plan.firm', planStatus: 'active', planQuota: PLANS['plan.firm'].dailyQuota, planUsed: 314, planRemaining: PLANS['plan.firm'].dailyQuota - 314, planExhausted: false });
});

test('a pilot at the cap reports zero remaining and exhausted', async () => {
  const answer = await planInfo(fakeDb({ plan: 'plan.pilot', count: 200 }), 'user-2');
  assert.equal(answer.planRemaining, 0);
  assert.equal(answer.planExhausted, true);
});

test('usage reports from the loopback bridge count toward exhaustion', async () => {
  const answer = await planInfo(fakeDb({ plan: 'plan.pilot', count: 190, reports: [{ commands: 10 }] }), 'user-4');
  assert.equal(answer.planUsed, 200);
  assert.equal(answer.planExhausted, true);
  assert.equal(answer.planRemaining, 0);
});

test('spend from the loopback bridge lands in the same number the caller sees', async () => {
  const answer = await planInfo(fakeDb({ plan: 'plan.pilot', count: 40, reports: [{ commands: 9 }, { commands: 1 }] }), 'user-4');
  assert.equal(answer.planUsed, 50, 'the hosted number carries both surfaces');
});

test('an account with no plan row is a pilot, not an absence of limits', async () => {
  const answer = await planInfo(fakeDb({ plan: null, count: 0 }), 'user-2');
  assert.equal(answer.plan, 'plan.pilot');
  assert.equal(answer.planQuota, PLANS['plan.pilot'].dailyQuota);
  assert.equal(answer.planUsed, 0);
});

test('a static caller is not given someone else\'s plan', async () => {
  assert.equal(await planInfo(fakeDb({}), null), null);
});

test('a reluctant database costs the fields, not the answer', async () => {
  assert.equal(await planInfo(fakeDb({ fail: true }), 'user-3'), null);
});
