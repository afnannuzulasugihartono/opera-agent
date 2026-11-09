// @last-edited: 2026-11-09 UTC+7.
// @title: plan-info — what the hosted caller may see: the plan it is on, and how much of the day it has spent.
// @state: the plan, its quota, today's usage, both for the account that owns the device the caller is typing through.
// @dependencies: ./index.ts through one injection of the database client.

// WHY THIS FILE EXISTS

// The bridge refuses a command at its limit; the hosted caller ought to know where the limit is before it hits it.
// browser_status is the tool every agent is told to call first, so the plan is answered there: plan, planQuota, planUsed, planStatus.

import { PLANS } from '../_shared/plans.js';

export async function planInfo(db, userId: string | null): Promise<Record<string, unknown> | null> {
  if (!userId) return null;
  try {
    const { data } = await db
      .from('opera_account_plans')
      .select('plan, status')
      .eq('user_id', userId)
      .maybeSingle();
    const plan = String(data?.plan ?? 'plan.pilot');
    const status = String(data?.status ?? 'active');
    const quota = PLANS[plan]?.dailyQuota ?? PLANS['plan.pilot'].dailyQuota;
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    const { count } = await db
      .from('opera_commands')
      .select('id, opera_devices!inner(user_id)', { count: 'exact', head: true })
      .eq('opera_devices.user_id', userId)
      .gte('created_at', midnight.toISOString());
    const { data: reports } = await db
      .from('opera_usage_reports')
      .select('commands')
      .eq('user_id', userId)
      .gte('created_at', midnight.toISOString());
    const reported = (reports ?? []).reduce((sum, row) => sum + Number(row?.commands ?? 0), 0);
    return { plan, planStatus: status, planQuota: quota, planUsed: Number(count ?? 0) + reported };
  } catch {
    return null;
  }
}
