-- One table holds the plan; one RPC reads it for the account asking.
-- WHY additive only: plans are new state, nothing existing is re-keyed or rewritten.

create table if not exists public.opera_account_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'plan.pilot' check (plan in ('plan.pilot', 'plan.firm')),
  status text not null default 'active' check (status in ('active', 'paused')),
  updated_at timestamptz not null default now()
);

alter table public.opera_account_plans enable row level security;
revoke all on public.opera_account_plans from anon, authenticated;
create policy opera_account_plans_owner_read on public.opera_account_plans
  for select to authenticated using (user_id = auth.uid());

-- WHY THE QUOTAS ARE RESTATED HERE.
-- The plans module in JavaScript is the canonical statement, and this RPC cannot import it, so the numbers are repeated.
-- tests/plans.test.mjs pins the two copies to the same values, which is how the bridge and this function stop drifting apart.

create or replace function public.opera_my_plan()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_plan text; v_status text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  select plan, status into v_plan, v_status from public.opera_account_plans where user_id = v_uid;
  if not found then
    v_plan := 'plan.pilot';
    v_status := 'active';
  end if;
  return jsonb_build_object(
    'ok', true,
    'plan', v_plan,
    'status', v_status,
    'dailyQuota', case when v_plan = 'plan.firm' then 5000 else 200 end,
    'usedToday', (
      select count(*)
      from public.opera_commands c
      join public.opera_devices d on d.id = c.device_id
      where d.user_id = v_uid
        and c.created_at >= date_trunc('day', now())
    )::integer,
    'sessionAllowance', case when v_plan = 'plan.firm' then 500 else 50 end
  );
end $$;

revoke all on function public.opera_my_plan() from public, anon;
grant execute on function public.opera_my_plan() to authenticated, service_role;
