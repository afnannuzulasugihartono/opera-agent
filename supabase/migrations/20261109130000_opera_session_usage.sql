-- The loopback bridge meters the local drive session: this migration is where the session opens, where the usage report lands, and where both fold into the one daily count the hosted surface reads.
-- WHY additive only: the two new RPCs are new doors on existing tables, and the two replaced RPCs compute the same shape they always did, with one more term.

create table if not exists public.opera_usage_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.opera_devices(id) on delete set null,
  commands integer not null check (commands between 1 and 10000),
  created_at timestamptz not null default now()
);

alter table public.opera_usage_reports enable row level security;
revoke all on public.opera_usage_reports from anon, authenticated;
create index if not exists opera_usage_reports_user_day_idx
  on public.opera_usage_reports (user_id, created_at);

-- WHY THE NUMBERS ARE RESTATED HERE, AGAIN.
-- The plans module in JavaScript is the canonical statement, and this SQL cannot import it, so the quotas and the allowances are repeated.
-- tests/session-usage.test.mjs pins the JavaScript and this file to the same numbers, which is how the readers stop drifting apart.
-- The daily count adds two terms: rows in opera_commands (the hosted surface) and rows in opera_usage_reports (the local surface, reported at session end).

create or replace function public.opera_device_session_open(p_device_name text, p_token_hash text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_found boolean; v_uid uuid; v_device_id uuid; v_plan text; v_status text;
  v_quota integer; v_used bigint; v_allowance bigint;
begin
  select exists(
    select 1 from public.opera_devices
    where device_name = trim(p_device_name) and token_hash = p_token_hash and status <> 'disabled'
  ) into v_found;
  if not v_found then return jsonb_build_object('ok', false, 'error', 'Unauthorized device.'); end if;

  select user_id, id into v_uid, v_device_id from public.opera_devices
    where device_name = trim(p_device_name) and token_hash = p_token_hash and status <> 'disabled';

  if v_uid is null then
    return jsonb_build_object(
      'ok', true, 'userId', null, 'plan', 'plan.pilot', 'status', 'active',
      'dailyQuota', 200, 'usedToday', 0, 'sessionAllowance', 50);
  end if;

  select plan, status into v_plan, v_status from public.opera_account_plans where user_id = v_uid;
  if not found then
    v_plan := 'plan.pilot';
    v_status := 'active';
  end if;
  v_quota := case when v_plan = 'plan.firm' then 5000 else 200 end;
  v_used := (
    select count(*)
    from public.opera_commands c
    join public.opera_devices d on d.id = c.device_id
    where d.user_id = v_uid
      and c.created_at >= date_trunc('day', now())
  ) + (
    select coalesce(sum(commands), 0)
    from public.opera_usage_reports
    where user_id = v_uid
      and created_at >= date_trunc('day', now())
  );

  if v_status <> 'active' then
    return jsonb_build_object(
      'ok', false, 'plan', v_plan,
      'message', format('plan %s is not active for this account', v_plan));
  end if;
  if v_used >= v_quota then
    return jsonb_build_object(
      'ok', false, 'plan', v_plan, 'dailyQuota', v_quota, 'usedToday', v_used,
      'message', format('today''s quota of %s commands for %s is used; resets tomorrow', v_quota, v_plan));
  end if;

  v_allowance := least(case when v_plan = 'plan.firm' then 500 else 50 end, v_quota - v_used);
  return jsonb_build_object(
    'ok', true, 'userId', v_uid, 'plan', v_plan, 'status', v_status,
    'dailyQuota', v_quota, 'usedToday', v_used, 'sessionAllowance', v_allowance);
end $$;

create or replace function public.opera_device_session_report(p_device_name text, p_token_hash text, p_commands integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_found boolean; v_uid uuid; v_device_id uuid;
begin
  if p_commands is null or p_commands < 1 or p_commands > 10000 then
    return jsonb_build_object('ok', false, 'error', 'p_commands must be an integer between 1 and 10000.');
  end if;
  select exists(
    select 1 from public.opera_devices
    where device_name = trim(p_device_name) and token_hash = p_token_hash and status <> 'disabled'
  ) into v_found;
  if not v_found then return jsonb_build_object('ok', false, 'error', 'Unauthorized device.'); end if;

  select user_id, id into v_uid, v_device_id from public.opera_devices
    where device_name = trim(p_device_name) and token_hash = p_token_hash and status <> 'disabled';

  if v_uid is null then
    return jsonb_build_object('ok', true, 'reported', 0, 'skipped', 'the device has no owning account');
  end if;

  insert into public.opera_usage_reports(user_id, device_id, commands) values (v_uid, v_device_id, p_commands);
  return jsonb_build_object('ok', true, 'reported', p_commands);
end $$;

revoke all on function public.opera_device_session_open(text, text) from public, anon, authenticated;
grant execute on function public.opera_device_session_open(text, text) to service_role;
revoke all on function public.opera_device_session_report(text, text, integer) from public, anon, authenticated;
grant execute on function public.opera_device_session_report(text, text, integer) to service_role;

-- WHY THE EXISTING READERS CHANGE IN THE SAME FILE.
-- The hosted gate and the hosted status read their daily count from here; an account that spends locally and is answered as if it had spent nothing is one quota in name only.

create or replace function public.opera_device_plan(p_device_name text, p_token_hash text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_found boolean; v_uid uuid; v_plan text; v_status text;
begin
  select exists(
    select 1 from public.opera_devices
    where device_name = trim(p_device_name) and token_hash = p_token_hash and status <> 'disabled'
  ) into v_found;
  if not v_found then return jsonb_build_object('ok', false, 'error', 'Unauthorized device.'); end if;
  select user_id into v_uid from public.opera_devices
    where device_name = trim(p_device_name) and token_hash = p_token_hash and status <> 'disabled';
  if v_uid is null then
    return jsonb_build_object('ok', true, 'userId', null, 'plan', 'plan.pilot', 'status', 'active', 'dailyQuota', 200, 'usedToday', 0);
  end if;
  select plan, status into v_plan, v_status from public.opera_account_plans where user_id = v_uid;
  if not found then
    v_plan := 'plan.pilot';
    v_status := 'active';
  end if;
  return jsonb_build_object(
    'ok', true,
    'userId', v_uid,
    'plan', v_plan,
    'status', v_status,
    'dailyQuota', case when v_plan = 'plan.firm' then 5000 else 200 end,
    'usedToday', (
      select count(*)
      from public.opera_commands c
      join public.opera_devices d on d.id = c.device_id
      where d.user_id = v_uid
        and c.created_at >= date_trunc('day', now())
    )::integer
    + (
      select coalesce(sum(commands), 0)
      from public.opera_usage_reports
      where user_id = v_uid
        and created_at >= date_trunc('day', now())
    )::integer
  );
end $$;

revoke all on function public.opera_device_plan(text, text) from public, anon, authenticated;
grant execute on function public.opera_device_plan(text, text) to service_role;

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
    ) + (
      select coalesce(sum(commands), 0)
      from public.opera_usage_reports
      where user_id = v_uid
        and created_at >= date_trunc('day', now())
    ),
    'sessionAllowance', case when v_plan = 'plan.firm' then 500 else 50 end
  );
end $$;

revoke all on function public.opera_my_plan() from public, anon;
grant execute on function public.opera_my_plan() to authenticated, service_role;
