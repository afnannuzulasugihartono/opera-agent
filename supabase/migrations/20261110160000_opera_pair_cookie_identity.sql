-- A device belongs to one browser, and a browser keeps its identity across reinstalls.
-- The per-profile id in chrome.storage.local is wiped when the extension is removed, so every reinstall minted a new device row (opera-2 .. opera-7) and the old rows kept counting as "online".
-- The cookie jar of the browser profile survives the uninstall; the pairing page now sets `oa_device_id`, and the extension mirrors it into storage for the service worker.
-- At pair time the browser sends its cookie identity as p_cookie_instance_id and the pre-upgrade storage id as p_instance_id (the legacy).
-- Re-pairing then adopts the legacy row in place: the cookie identity replaces the legacy one, the device keeps its name, and no new row is minted.

-- WHY the legacy id still matters and is never deleted.
-- A browser that never saw the cookie (cookie blocked, first pair since the upgrade) falls back to the storage id, exactly like the 9-argument overload did before.
-- An identity the browser itself no longer holds is not proof enough to rename a row; the adoption below requires the row's owner to match the pairing code's issuer, or the row to be unowned, so one account's stale identity can never adopt another account's device.

-- WHY a defaulted 10th argument, mirrored semantics.
-- The 9-argument form keeps its exact behaviour for bridge builds that do not send the cookie identity; the new overload is what the deployed bridge calls.

create or replace function public.opera_pair_device(p_code text, p_token_hash text, p_device_name text, p_extension_version text, p_protocol_version integer, p_capabilities jsonb default '[]'::jsonb, p_browser_name text default '', p_instance_id text default '', p_cookie_instance_id text default '')
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pair public.opera_pairing_codes%rowtype;
  v_device public.opera_devices%rowtype;
  v_legacy text := trim(coalesce(p_instance_id, ''));
  v_cookie text := trim(coalesce(p_cookie_instance_id, ''));
  v_base text;
  v_name text;
  v_suffix integer := 1;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok', false, 'error', 'Invalid device token hash.'); end if;
  if v_legacy <> '' and v_legacy !~ '^[A-Za-z0-9._:-]{1,64}$' then return jsonb_build_object('ok', false, 'error', 'Invalid device identity.'); end if;
  if v_cookie <> '' and v_cookie !~ '^[A-Za-z0-9._:-]{1,64}$' then return jsonb_build_object('ok', false, 'error', 'Invalid device identity.'); end if;

  select * into v_pair from public.opera_pairing_codes where code_hash = public.opera_sha256(upper(trim(p_code))) and consumed_at is null and expires_at > now() for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Pairing code is invalid or expired.'); end if;

  if v_cookie <> '' then
    select * into v_device from public.opera_devices where instance_id = v_cookie for update;
    if found then
      if v_device.user_id is not null and v_device.user_id is distinct from v_pair.issued_by then
        insert into public.opera_audit(event_type, details) values ('pairing.refused_owned_instance', jsonb_build_object('deviceName', v_device.device_name, 'cookieInstanceId', v_cookie));
        return jsonb_build_object('ok', false, 'error', 'That device identity belongs to another account.');
      end if;
      update public.opera_devices set token_hash = p_token_hash, status = 'online', extension_version = left(coalesce(p_extension_version, ''), 64), protocol_version = coalesce(p_protocol_version, 1), capabilities = coalesce(p_capabilities, '[]'::jsonb), last_seen_at = now(), updated_at = now(), user_id = coalesce(user_id, v_pair.issued_by) where id = v_device.id returning * into v_device;
      update public.opera_pairing_codes set consumed_at = now() where id = v_pair.id;
      insert into public.opera_audit(event_type, device_id, details) values ('device.paired', v_device.id, jsonb_build_object('deviceName', v_device.device_name, 'instanceId', v_device.instance_id, 'version', v_device.extension_version, 'protocolVersion', v_device.protocol_version, 'browserName', v_device.browser_name));
      return jsonb_build_object('ok', true, 'deviceId', v_device.id, 'deviceName', v_device.device_name, 'protocolVersion', v_device.protocol_version, 'browserName', v_device.browser_name);
    end if;

    if v_legacy <> '' then
      select * into v_device from public.opera_devices where instance_id = v_legacy for update;
      if found and (v_device.user_id is null or v_device.user_id = v_pair.issued_by) then
        update public.opera_devices set instance_id = v_cookie, token_hash = p_token_hash, status = 'online', extension_version = left(coalesce(p_extension_version, ''), 64), protocol_version = coalesce(p_protocol_version, 1), capabilities = coalesce(p_capabilities, '[]'::jsonb), last_seen_at = now(), updated_at = now(), user_id = coalesce(v_device.user_id, v_pair.issued_by) where id = v_device.id returning * into v_device;
        update public.opera_pairing_codes set consumed_at = now() where id = v_pair.id;
        insert into public.opera_audit(event_type, device_id, details) values ('device.paired', v_device.id, jsonb_build_object('deviceName', v_device.device_name, 'instanceId', v_device.instance_id, 'adoptedFrom', v_legacy, 'version', v_device.extension_version, 'protocolVersion', v_device.protocol_version, 'browserName', v_device.browser_name, 'adopted', true));
        return jsonb_build_object('ok', true, 'deviceId', v_device.id, 'deviceName', v_device.device_name, 'protocolVersion', v_device.protocol_version, 'browserName', v_device.browser_name, 'adopted', true);
      end if;
      if found then
        insert into public.opera_audit(event_type, details) values ('pairing.refused_owned_legacy', jsonb_build_object('deviceName', v_device.device_name, 'cookieInstanceId', v_cookie));
      end if;
    end if;
  else
    if v_legacy <> '' then
      select * into v_device from public.opera_devices where instance_id = v_legacy for update;
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
      update public.opera_devices set instance_id = coalesce(nullif(v_cookie, ''), v_legacy), token_hash = p_token_hash, status = 'online', extension_version = left(coalesce(p_extension_version, ''), 64), protocol_version = coalesce(p_protocol_version, 1), capabilities = coalesce(p_capabilities, '[]'::jsonb), last_seen_at = now(), updated_at = now(), user_id = coalesce(v_device.user_id, v_pair.issued_by), browser_name = case when trim(coalesce(p_browser_name, '')) <> '' then left(trim(p_browser_name), 64) else v_device.browser_name end where id = v_device.id returning * into v_device;
      exit;
    end if;
    v_suffix := v_suffix + 1;
    if v_suffix > 20 then return jsonb_build_object('ok', false, 'error', 'Too many browsers are paired to this name.'); end if;
    v_name := left(v_base, 55) || '-' || v_suffix;
  end loop;

  if v_device.id is null then
    insert into public.opera_devices(device_name, token_hash, status, extension_version, protocol_version, capabilities, last_seen_at, updated_at, user_id, browser_name, instance_id)
    values (v_name, p_token_hash, 'online', left(coalesce(p_extension_version, ''), 64), coalesce(p_protocol_version, 1), coalesce(p_capabilities, '[]'::jsonb), now(), now(), v_pair.issued_by, left(trim(coalesce(p_browser_name, '')), 64), coalesce(nullif(v_cookie, ''), v_legacy))
    returning * into v_device;
  end if;

  update public.opera_pairing_codes set consumed_at = now() where id = v_pair.id;
  insert into public.opera_audit(event_type, device_id, details) values ('device.paired', v_device.id, jsonb_build_object('deviceName', v_device.device_name, 'instanceId', v_device.instance_id, 'version', v_device.extension_version, 'protocolVersion', v_device.protocol_version, 'browserName', v_device.browser_name));
  return jsonb_build_object('ok', true, 'deviceId', v_device.id, 'deviceName', v_device.device_name, 'protocolVersion', v_device.protocol_version, 'browserName', v_device.browser_name);
end $$;

revoke all on function public.opera_pair_device(text, text, text, text, integer, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.opera_pair_device(text, text, text, text, integer, jsonb, text, text, text) to service_role;
