-- A device belongs to one browser because the extension runs inside one browser.
-- Add browser_name so the dashboard can list paired browsers separately.

alter table public.opera_devices add column if not exists browser_name text not null default '';

create or replace function public.opera_pair_device(p_code text, p_token_hash text, p_device_name text, p_extension_version text, p_protocol_version integer, p_capabilities jsonb default '[]'::jsonb, p_browser_name text default '')
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_pair public.opera_pairing_codes%rowtype; v_device public.opera_devices%rowtype;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok', false, 'error', 'Invalid device token hash.'); end if;
  select * into v_pair from public.opera_pairing_codes where code_hash = public.opera_sha256(upper(trim(p_code))) and device_name = trim(p_device_name) and consumed_at is null and expires_at > now() for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Pairing code is invalid or expired.'); end if;
  if exists (select 1 from public.opera_devices where device_name = trim(p_device_name) and user_id is not null and user_id is distinct from v_pair.issued_by) then
    insert into public.opera_audit(event_type, details) values ('pairing.refused_owned_name', jsonb_build_object('deviceName', trim(p_device_name)));
    return jsonb_build_object('ok', false, 'error', 'That device name belongs to another account.');
  end if;
  insert into public.opera_devices(device_name, token_hash, status, extension_version, protocol_version, capabilities, last_seen_at, updated_at, user_id, browser_name)
  values (trim(p_device_name), p_token_hash, 'online', left(coalesce(p_extension_version, ''), 64), coalesce(p_protocol_version, 1), coalesce(p_capabilities, '[]'::jsonb), now(), now(), v_pair.issued_by, left(trim(coalesce(p_browser_name, '')), 64))
  on conflict(device_name) do update set token_hash = excluded.token_hash, status = 'online', extension_version = excluded.extension_version, protocol_version = excluded.protocol_version, capabilities = excluded.capabilities, last_seen_at = now(), updated_at = now(), user_id = coalesce(public.opera_devices.user_id, excluded.user_id), browser_name = case when excluded.browser_name <> '' then excluded.browser_name else public.opera_devices.browser_name end
  where public.opera_devices.user_id is null or public.opera_devices.user_id = excluded.user_id
  returning * into v_device;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That device name belongs to another account.');
  end if;
  update public.opera_pairing_codes set consumed_at = now() where id = v_pair.id;
  insert into public.opera_audit(event_type, device_id, details) values ('device.paired', v_device.id, jsonb_build_object('deviceName', v_device.device_name, 'version', v_device.extension_version, 'protocolVersion', v_device.protocol_version, 'browserName', v_device.browser_name));
  return jsonb_build_object('ok', true, 'deviceId', v_device.id, 'deviceName', v_device.device_name, 'protocolVersion', v_device.protocol_version, 'browserName', v_device.browser_name);
end $$;
