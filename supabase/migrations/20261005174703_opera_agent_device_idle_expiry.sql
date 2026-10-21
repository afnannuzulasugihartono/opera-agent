-- Expire a device that has stopped reporting, so removing the extension eventually revokes its access.

-- WHY this file exists: uninstalling an MV3 extension sends no event to the server, so the device row outlives the software that created it.
-- A token removed from browser storage still verified forever, and the account page kept listing a device that no longer existed.

-- WHY seven days: long past any realistic gap between closing a laptop and reopening it, so an installed browser is never expired by accident.
-- Every heartbeat advances last_seen_at, so the window resets for as long as the device is in use and only a removed one falls out of it.

-- WHY decided at validation time rather than by a sweep: this project runs no scheduler, so a background job would never fire and the rows would keep accumulating.
-- Deciding here stops a stale token the moment the window passes, with nothing to run and nothing to wait for.

create or replace function public.opera_verify_device(p_device_name text, p_token_hash text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_device public.opera_devices%rowtype;
begin
  select * into v_device from public.opera_devices
    where device_name = trim(p_device_name)
      and token_hash = p_token_hash
      and status <> 'disabled'
      and last_seen_at > now() - interval '7 days';
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'deviceName', v_device.device_name, 'last_seen_at', v_device.last_seen_at);
end $function$;