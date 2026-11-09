-- A purchased plan now carries an expiry.
-- WHY additive only: one new column with a safe default (never expires), one new RPC for the billing function to call on settlement, and the three plan readers learn to degrade to pilot when the expiry has passed.

alter table public.opera_account_plans
  add column if not exists expires_at timestamptz;
alter table public.opera_account_plans
  add column if not exists source text not null default 'grant' check (source in ('grant', 'purchase', 'trial'));

comment on column public.opera_account_plans.expires_at is 'When this plan stops applying; null means never expires (manual grants stay grants forever unless revoked). A purchase sets now()+30 days and every later purchase extends from the current expiry, or from now when none is set or it has passed.';
comment on column public.opera_account_plans.source is 'How this plan row was granted: grant = owner/operator decision, purchase = a paid invoice, trial = a time-boxed trial.';

-- WHY THE READERS DEGRADE IN PLACE AND NOT AT READ TIME ELSEWHERE.
-- Every gate that reads a plan goes through one of these three functions; teaching them to treat an expired plan as the safe pilot is the whole change, and no caller has to know dates exist.

create or replace function public.opera_device_session_open(p_device_name text, p_token_hash text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_found boolean; v_uid uuid; v_device_id uuid; v_plan text; v_status text; v_expires timestamptz;
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

  select plan, status, expires_at into v_plan, v_status, v_expires from public.opera_account_plans where user_id = v_uid;
  if not found then
    v_plan := 'plan.pilot';
    v_status := 'active';
  elsif v_expires is not null and v_expires <= now() then
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

revoke all on function public.opera_device_session_open(text, text) from public, anon, authenticated;
grant execute on function public.opera_device_session_open(text, text) to service_role;

create or replace function public.opera_device_plan(p_device_name text, p_token_hash text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_found boolean; v_uid uuid; v_plan text; v_status text; v_expires timestamptz;
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
  select plan, status, expires_at into v_plan, v_status, v_expires from public.opera_account_plans where user_id = v_uid;
  if not found then
    v_plan := 'plan.pilot';
    v_status := 'active';
  elsif v_expires is not null and v_expires <= now() then
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
declare v_uid uuid := auth.uid(); v_plan text; v_status text; v_expires timestamptz;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  select plan, status, expires_at into v_plan, v_status, v_expires from public.opera_account_plans where user_id = v_uid;
  if not found then
    v_plan := 'plan.pilot';
    v_status := 'active';
  elsif v_expires is not null and v_expires <= now() then
    v_plan := 'plan.pilot';
    v_status := 'active';
    v_expires := null;
  end if;
  return jsonb_build_object(
    'ok', true,
    'plan', v_plan,
    'status', v_status,
    'expiresAt', v_expires,
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

-- WHY A HANDLE ON ACTIVATION INSTEAD OF AN UPDATE IN THE BILLING FUNCTION.
-- The function holds no write path into account state outside an RPC, and a half-written plan row (right plan, absent expiry, absent source) would silently make a purchase permanent — the worst defect money can produce here.
-- One SQL body owns the rule: manual grants never expire, an active purchase extends from its own expiry, an expired or pilot row starts from now.

create or replace function public.opera_plan_activate_purchase(p_owner uuid, p_kind text default 'plan.firm')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_plan text; v_source text; v_expires timestamptz; v_result jsonb;
begin
  if p_kind not in ('plan.pilot', 'plan.firm') then
    return jsonb_build_object('ok', false, 'error', format('no such plan kind: %s', p_kind));
  end if;
  insert into public.opera_account_plans (user_id, plan, status, source, expires_at, updated_at)
  values (p_owner, p_kind, 'active', 'purchase', now() + interval '30 days', now())
  on conflict (user_id) do update set
    plan = excluded.plan,
    status = 'active',
    source = case when opera_account_plans.plan = excluded.plan and opera_account_plans.expires_at is null then opera_account_plans.source else excluded.source end,
    expires_at = case
      when opera_account_plans.expires_at is null and opera_account_plans.plan = excluded.plan then null
      when opera_account_plans.plan = excluded.plan and opera_account_plans.expires_at is not null and opera_account_plans.expires_at > now() then opera_account_plans.expires_at + interval '30 days'
      else now() + interval '30 days'
    end,
    updated_at = now()
  returning plan, source, expires_at into v_plan, v_source, v_expires;
  return jsonb_build_object('ok', true, 'plan', v_plan, 'source', v_source, 'expiresAt', v_expires);
end $$;

revoke all on function public.opera_plan_activate_purchase(uuid, text) from public, anon, authenticated;
grant execute on function public.opera_plan_activate_purchase(uuid, text) to service_role;

comment on function public.opera_plan_activate_purchase(uuid, text) is 'Called by the billing function when an invoice whose lines include a plan kind closes. Manual grants (no expiry) never expire; purchases renew by 30 days from the current expiry, or from now.';
