-- A device name belongs to the account that paired it, and pairing can no longer take it.
--
-- WHY: opera_pair_device upserted on device_name and kept user_id with
-- coalesce(existing, new), so a valid code for an owned name replaced the owner's
-- token_hash while the owner stayed the owner. Measured on this project in a
-- rolled-back transaction: the token changed and the row still read as owned. Any
-- confirmed account could mint such a code, because opera_create_pairing_code
-- never asked who owned the name. The commands queued for the owner then reach
-- another person's browser, and the results that come back are theirs to write.
--
-- WHY three guards and not one: the issuer check stops the request early with a
-- readable error, the ownership check at pairing stops a code that already exists,
-- and the WHERE on the upsert stops two pairings that race past both. The last is
-- the one that holds when the others are bypassed.
--
-- WHY the issuer comes from the session: p_issued_by was caller-supplied and the
-- function is executable by every signed-in account, so a caller could issue a code
-- in someone else's name, spend their hourly allowance, or plant a device on their
-- account. Only a caller with no session (service_role) may name an issuer.
--
-- WHY cancelling is scoped to the issuer: every new code cancelled the previous one
-- for the same name, whoever held it, so one account could keep cancelling another's
-- pairing. A code now cancels only its own issuer's earlier codes.
--
-- Signatures, grants and the rate limit are unchanged.

create or replace function public.opera_create_pairing_code(p_device_name text default 'opera', p_ttl_minutes integer default 10, p_issued_by uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_code text; v_expires timestamptz; v_issuer uuid; v_recent integer; v_name text;
begin
  if p_device_name is null or char_length(trim(p_device_name)) not between 1 and 64 then return jsonb_build_object('ok', false, 'error', 'Invalid device name.'); end if;
  v_name := trim(p_device_name);
  p_ttl_minutes := least(greatest(coalesce(p_ttl_minutes, 10), 1), 60);
  v_issuer := case when auth.uid() is not null then auth.uid() else p_issued_by end;
  if exists (select 1 from public.opera_devices where device_name = v_name and user_id is not null and user_id is distinct from v_issuer) then
    insert into public.opera_audit(event_type, details) values ('pairing_code.name_taken', jsonb_build_object('issuer', v_issuer));
    return jsonb_build_object('ok', false, 'error', 'That device name belongs to another account.');
  end if;
  if v_issuer is not null then
    select count(*) into v_recent
    from public.opera_pairing_codes
    where issued_by = v_issuer and created_at > now() - interval '1 hour';
    if v_recent >= 5 then
      insert into public.opera_audit(event_type, details) values ('pairing_code.rate_limited', jsonb_build_object('issuer', v_issuer, 'recent', v_recent));
      return jsonb_build_object('ok', false, 'error', 'Too many pairing codes this hour. Try again later.');
    end if;
  end if;
  update public.opera_pairing_codes set consumed_at = now() where device_name = v_name and issued_by is not distinct from v_issuer and consumed_at is null;
  v_code := upper(substr(encode(gen_random_bytes(12), 'hex'), 1, 16));
  v_expires := now() + make_interval(mins => p_ttl_minutes);
  insert into public.opera_pairing_codes(code_hash, device_name, expires_at, issued_by)
  values (public.opera_sha256(v_code), v_name, v_expires, v_issuer);
  insert into public.opera_audit(event_type, details) values ('pairing_code.created', jsonb_build_object('deviceName', v_name));
  return jsonb_build_object('ok', true, 'deviceName', v_name, 'code', v_code, 'expiresAt', v_expires);
end $$;

create or replace function public.opera_pair_device(p_code text, p_token_hash text, p_device_name text, p_extension_version text, p_protocol_version integer, p_capabilities jsonb default '[]'::jsonb)
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
  insert into public.opera_devices(device_name, token_hash, status, extension_version, protocol_version, capabilities, last_seen_at, updated_at, user_id)
  values (trim(p_device_name), p_token_hash, 'online', left(coalesce(p_extension_version, ''), 64), coalesce(p_protocol_version, 1), coalesce(p_capabilities, '[]'::jsonb), now(), now(), v_pair.issued_by)
  on conflict(device_name) do update set token_hash = excluded.token_hash, status = 'online', extension_version = excluded.extension_version, protocol_version = excluded.protocol_version, capabilities = excluded.capabilities, last_seen_at = now(), updated_at = now(), user_id = coalesce(public.opera_devices.user_id, excluded.user_id)
  where public.opera_devices.user_id is null or public.opera_devices.user_id = excluded.user_id
  returning * into v_device;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That device name belongs to another account.');
  end if;
  update public.opera_pairing_codes set consumed_at = now() where id = v_pair.id;
  insert into public.opera_audit(event_type, device_id, details) values ('device.paired', v_device.id, jsonb_build_object('deviceName', v_device.device_name, 'version', v_device.extension_version, 'protocolVersion', v_device.protocol_version));
  return jsonb_build_object('ok', true, 'deviceId', v_device.id, 'deviceName', v_device.device_name, 'protocolVersion', v_device.protocol_version);
end $$;
