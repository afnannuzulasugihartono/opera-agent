-- The bridge verifies a device by token hash; the gate needs to know the plan that device's account holds.
-- WHY one RPC and not two: the hash is already computed on both paths, and a plan read is one join, not a round trip per call site.

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
  );
end $$;

revoke all on function public.opera_device_plan(text, text) from public, anon, authenticated;
grant execute on function public.opera_device_plan(text, text) to service_role;
