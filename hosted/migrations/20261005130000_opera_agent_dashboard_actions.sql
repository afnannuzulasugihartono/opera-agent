-- Dashboard v2: revoke, usage counts, and self-issuing pairing codes.

-- WHY a second file: the binding migration is already applied to production, and an applied migration is never rewritten.
-- Everything here is additive.

-- APPLY: paste into the Supabase dashboard SQL editor, after the binding file.

-- Revocation rotates the token hash instead of setting status='disabled'.
-- Two reasons, both load-bearing: a disabled device is excluded from auth before the status check, so the device could never pair again and the owner would brick their own machine; and tests/device-status-truth.test.mjs exists precisely to keep status='disabled' owner-only in SQL, because nothing else re-enables it.
-- A rotated hash is dead the same way and pairing always restores it.

create or replace function public.opera_revoke_my_device(p_device_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  update public.opera_devices set
    token_hash = repeat('0', 64),
    status = 'offline',
    last_seen_at = null,
    updated_at = now()
  where id = p_device_id and user_id = auth.uid()
  returning device_name into v_name;
  if not found then return jsonb_build_object('ok', false, 'error', 'No such device on this account.'); end if;
  insert into public.opera_audit(event_type, device_id, details) values ('device.revoked', p_device_id, jsonb_build_object('deviceName', v_name));
  return jsonb_build_object('ok', true, 'deviceName', v_name);
end $$;

create or replace function public.opera_create_pairing_code(p_device_name text default 'opera', p_ttl_minutes integer default 10, p_issued_by uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_code text; v_expires timestamptz; v_issuer uuid;
begin
  if p_device_name is null or char_length(trim(p_device_name)) not between 1 and 64 then return jsonb_build_object('ok', false, 'error', 'Invalid device name.'); end if;
  p_ttl_minutes := least(greatest(coalesce(p_ttl_minutes, 10), 1), 60);
  v_issuer := coalesce(p_issued_by, auth.uid());
  update public.opera_pairing_codes set consumed_at = now() where device_name = trim(p_device_name) and consumed_at is null;
  v_code := upper(substr(encode(gen_random_bytes(12), 'hex'), 1, 16));
  v_expires := now() + make_interval(mins => p_ttl_minutes);
  insert into public.opera_pairing_codes(code_hash, device_name, expires_at, issued_by)
  values (public.opera_sha256(v_code), trim(p_device_name), v_expires, v_issuer);
  insert into public.opera_audit(event_type, details) values ('pairing_code.created', jsonb_build_object('deviceName', trim(p_device_name)));
  return jsonb_build_object('ok', true, 'deviceName', trim(p_device_name), 'code', v_code, 'expiresAt', v_expires);
end $$;

create or replace function public.opera_my_devices()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  return jsonb_build_object('ok', true, 'devices', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', d.device_name, 'status', d.status, 'browserName', d.browser_name,
      'extensionVersion', d.extension_version, 'lastSeenAt', d.last_seen_at,
      'totalCommands', (select count(*) from public.opera_commands where device_id = d.id),
      'completedCommands', (select count(*) from public.opera_commands where device_id = d.id and status = 'completed'),
      'commands', coalesce((
        select jsonb_agg(jsonb_build_object(
          'method', c.method, 'status', c.status, 'createdAt', c.created_at, 'completedAt', c.completed_at
        ) order by c.created_at desc)
        from (select * from public.opera_commands where device_id = d.id order by created_at desc limit 10) c
      ), '[]'::jsonb)
    ) order by d.created_at)
    from public.opera_devices d where d.user_id = v_uid
  ), '[]'::jsonb));
end $$;

grant execute on function public.opera_revoke_my_device(uuid) to authenticated;
