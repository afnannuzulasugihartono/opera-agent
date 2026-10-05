-- Let an account run one browser action on its own device from the dashboard.
--
-- WHY owner-scoped: the caller never names a device. The function resolves it
-- through auth.uid(), so one account cannot drive another account's browser by
-- guessing a device name. The underlying opera_enqueue/opera_run keep their
-- existing revoked signatures; this is a thin owner-scoped wrapper that composes
-- them exactly as the edge function does.
--
-- APPLY: paste into the Supabase dashboard SQL editor.

create or replace function public.opera_run_on_my_device(
  p_method text,
  p_params jsonb default '{}'::jsonb,
  p_timeout_ms integer default null,
  p_request_id text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_device public.opera_devices%rowtype; v_enqueue jsonb; v_command_id uuid; v_wait integer;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  -- The method must be an enabled allowlisted primitive; the device-side runtime
  -- refuses anything else regardless, and this keeps the error honest early.
  if not exists (select 1 from public.opera_methods where method = p_method and enabled) then
    return jsonb_build_object('ok', false, 'error', 'Unknown or disabled method.');
  end if;
  select * into v_device from public.opera_devices
  where user_id = auth.uid() and status <> 'disabled'
  order by created_at limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'No paired device on this account.'); end if;
  if v_device.last_seen_at is null or v_device.last_seen_at < now() - interval '90 seconds' then
    return jsonb_build_object('ok', false, 'error', 'Device is offline. Open the extension so it can check in.');
  end if;
  v_enqueue := public.opera_enqueue(p_method, coalesce(p_params, '{}'::jsonb), p_timeout_ms, v_device.device_name, p_request_id);
  if not coalesce((v_enqueue ->> 'ok')::boolean, false) then return v_enqueue; end if;
  v_command_id := (v_enqueue ->> 'commandId')::uuid;
  v_wait := least(greatest(coalesce(p_timeout_ms, 45000), 500), 55000);
  return public.opera_await(v_command_id, v_wait);
end $$;

grant execute on function public.opera_run_on_my_device(text, jsonb, integer, text) to authenticated;