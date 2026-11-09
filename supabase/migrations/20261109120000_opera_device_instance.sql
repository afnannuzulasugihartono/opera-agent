-- A device belongs to one browser, and a browser keeps one identity of its own.
-- Without this, two browsers present one name: the second pairing replaces the first browser's token, and that browser is refused on its next connection.

alter table public.opera_devices add column if not exists instance_id text not null default '';

create unique index if not exists opera_devices_instance_id_key on public.opera_devices (instance_id) where instance_id <> '';

-- WHY the pairing code no longer has to match the name it was minted with.
-- The name is a label the dashboard asks for once; the browser that redeems the code may already carry a suffixed name from an earlier pairing.
-- The code still proves the account, the expiry still bounds it, and the ownership check still refuses a name that belongs to another account.

-- WHY a second browser gets a suffixed name instead of replacing the first.
-- Every command path addresses a device by name, so two live rows cannot share one.
-- The first free name wins, and an existing row with no identity yet is adopted rather than duplicated, which is what turns the browser that is already paired into the first holder of this identity.

create or replace function public.opera_pair_device(p_code text, p_token_hash text, p_device_name text, p_extension_version text, p_protocol_version integer, p_capabilities jsonb default '[]'::jsonb, p_browser_name text default '', p_instance_id text default '')
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pair public.opera_pairing_codes%rowtype;
  v_device public.opera_devices%rowtype;
  v_instance text := trim(coalesce(p_instance_id, ''));
  v_base text;
  v_name text;
  v_suffix integer := 1;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok', false, 'error', 'Invalid device token hash.'); end if;
  if v_instance <> '' and v_instance !~ '^[A-Za-z0-9._:-]{1,64}$' then return jsonb_build_object('ok', false, 'error', 'Invalid device identity.'); end if;
  select * into v_pair from public.opera_pairing_codes where code_hash = public.opera_sha256(upper(trim(p_code))) and consumed_at is null and expires_at > now() for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Pairing code is invalid or expired.'); end if;

  if v_instance <> '' then
    select * into v_device from public.opera_devices where instance_id = v_instance for update;
    if found then
      if v_device.user_id is not null and v_device.user_id is distinct from v_pair.issued_by then
        insert into public.opera_audit(event_type, details) values ('pairing.refused_owned_instance', jsonb_build_object('deviceName', v_device.device_name));
        return jsonb_build_object('ok', false, 'error', 'That device identity belongs to another account.');
      end if;
      update public.opera_devices set token_hash = p_token_hash, status = 'online', extension_version = left(coalesce(p_extension_version, ''), 64), protocol_version = coalesce(p_protocol_version, 1), capabilities = coalesce(p_capabilities, '[]'::jsonb), last_seen_at = now(), updated_at = now(), user_id = coalesce(user_id, v_pair.issued_by) where id = v_device.id returning * into v_device;
      update public.opera_pairing_codes set consumed_at = now() where id = v_pair.id;
      insert into public.opera_audit(event_type, device_id, details) values ('device.paired', v_device.id, jsonb_build_object('deviceName', v_device.device_name, 'instanceId', v_device.instance_id, 'version', v_device.extension_version, 'protocolVersion', v_device.protocol_version, 'browserName', v_device.browser_name));
      return jsonb_build_object('ok', true, 'deviceId', v_device.id, 'deviceName', v_device.device_name, 'protocolVersion', v_device.protocol_version, 'browserName', v_device.browser_name);
    end if;
  end if;

  v_base := left(coalesce(nullif(trim(v_pair.device_name), ''), nullif(trim(p_device_name), ''), 'opera'), 55);
  v_name := v_base;
  loop
    select * into v_device from public.opera_devices where device_name = v_name for update;
    if not found then exit; end if;
    if v_device.user_id is not null and v_device.user_id is distinct from v_pair.issued_by then
      insert into public.opera_audit(event_type, details) values ('pairing.refused_owned_name', jsonb_build_object('deviceName', v_name));
      return jsonb_build_object('ok', false, 'error', 'That device name belongs to another account.');
    end if;
    if v_device.instance_id = '' then
      update public.opera_devices set instance_id = v_instance, token_hash = p_token_hash, status = 'online', extension_version = left(coalesce(p_extension_version, ''), 64), protocol_version = coalesce(p_protocol_version, 1), capabilities = coalesce(p_capabilities, '[]'::jsonb), last_seen_at = now(), updated_at = now(), user_id = coalesce(v_device.user_id, v_pair.issued_by), browser_name = case when trim(coalesce(p_browser_name, '')) <> '' then left(trim(p_browser_name), 64) else v_device.browser_name end where id = v_device.id returning * into v_device;
      exit;
    end if;
    v_suffix := v_suffix + 1;
    if v_suffix > 20 then return jsonb_build_object('ok', false, 'error', 'Too many browsers are paired to this name.'); end if;
    v_name := left(v_base, 55) || '-' || v_suffix;
  end loop;

  if v_device.id is null then
    insert into public.opera_devices(device_name, token_hash, status, extension_version, protocol_version, capabilities, last_seen_at, updated_at, user_id, browser_name, instance_id)
    values (v_name, p_token_hash, 'online', left(coalesce(p_extension_version, ''), 64), coalesce(p_protocol_version, 1), coalesce(p_capabilities, '[]'::jsonb), now(), now(), v_pair.issued_by, left(trim(coalesce(p_browser_name, '')), 64), v_instance)
    returning * into v_device;
  end if;

  update public.opera_pairing_codes set consumed_at = now() where id = v_pair.id;
  insert into public.opera_audit(event_type, device_id, details) values ('device.paired', v_device.id, jsonb_build_object('deviceName', v_device.device_name, 'instanceId', v_device.instance_id, 'version', v_device.extension_version, 'protocolVersion', v_device.protocol_version, 'browserName', v_device.browser_name));
  return jsonb_build_object('ok', true, 'deviceId', v_device.id, 'deviceName', v_device.device_name, 'protocolVersion', v_device.protocol_version, 'browserName', v_device.browser_name);
end $$;

revoke all on function public.opera_pair_device(text, text, text, text, integer, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.opera_pair_device(text, text, text, text, integer, jsonb, text, text) to service_role;
