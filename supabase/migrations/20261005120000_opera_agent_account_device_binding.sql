-- Bind devices to accounts so the dashboard shows a user only their own rows.
--
-- WHY additive only: the base migration withheld everything from anon and
-- authenticated and defined no policies. This file adds columns plus the first
-- policies, and changes no existing grant, function name, or table shape beyond
-- two nullable owner columns. Existing unowned rows keep working untouched.
--
-- APPLY: paste into the Supabase dashboard SQL editor. CI never applies
-- migrations, and the dashboard is the only writer that matters here.

alter table public.opera_devices
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.opera_pairing_codes
  add column if not exists issued_by uuid references auth.users(id) on delete set null;

-- Issuance records who asked, so pairing transfers ownership instead of
-- creating an orphan. The issuer argument defaults to null to keep every
-- existing caller compiling.
create or replace function public.opera_create_pairing_code(p_device_name text default 'opera', p_ttl_minutes integer default 10, p_issued_by uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_code text; v_expires timestamptz;
begin
  if p_device_name is null or char_length(trim(p_device_name)) not between 1 and 64 then return jsonb_build_object('ok', false, 'error', 'Invalid device name.'); end if;
  p_ttl_minutes := least(greatest(coalesce(p_ttl_minutes, 10), 1), 60);
  update public.opera_pairing_codes set consumed_at = now() where device_name = trim(p_device_name) and consumed_at is null;
  v_code := upper(substr(encode(gen_random_bytes(12), 'hex'), 1, 16));
  v_expires := now() + make_interval(mins => p_ttl_minutes);
  insert into public.opera_pairing_codes(code_hash, device_name, expires_at, issued_by)
  values (public.opera_sha256(v_code), trim(p_device_name), v_expires, p_issued_by);
  insert into public.opera_audit(event_type, details) values ('pairing_code.created', jsonb_build_object('deviceName', trim(p_device_name)));
  return jsonb_build_object('ok', true, 'deviceName', trim(p_device_name), 'code', v_code, 'expiresAt', v_expires);
end $$;

-- Pairing adopts the issuer, but never steals: a device that already has an
-- owner keeps it even when a new code is consumed for it.
create or replace function public.opera_pair_device(p_code text, p_token_hash text, p_device_name text, p_extension_version text, p_protocol_version integer, p_capabilities jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_pair public.opera_pairing_codes%rowtype; v_device public.opera_devices%rowtype;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok', false, 'error', 'Invalid device token hash.'); end if;
  select * into v_pair from public.opera_pairing_codes where code_hash = public.opera_sha256(upper(trim(p_code))) and device_name = trim(p_device_name) and consumed_at is null and expires_at > now() for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Pairing code is invalid or expired.'); end if;
  insert into public.opera_devices(device_name, token_hash, status, extension_version, protocol_version, capabilities, last_seen_at, updated_at, user_id)
  values (trim(p_device_name), p_token_hash, 'online', left(coalesce(p_extension_version, ''), 64), coalesce(p_protocol_version, 1), coalesce(p_capabilities, '[]'::jsonb), now(), now(), v_pair.issued_by)
  on conflict(device_name) do update set token_hash = excluded.token_hash, status = 'online', extension_version = excluded.extension_version, protocol_version = excluded.protocol_version, capabilities = excluded.capabilities, last_seen_at = now(), updated_at = now(), user_id = coalesce(public.opera_devices.user_id, excluded.user_id)
  returning * into v_device;
  update public.opera_pairing_codes set consumed_at = now() where id = v_pair.id;
  insert into public.opera_audit(event_type, device_id, details) values ('device.paired', v_device.id, jsonb_build_object('deviceName', v_device.device_name, 'version', v_device.extension_version, 'protocolVersion', v_device.protocol_version));
  return jsonb_build_object('ok', true, 'deviceId', v_device.id, 'deviceName', v_device.device_name, 'protocolVersion', v_device.protocol_version);
end $$;

-- The dashboard reads through one function so the page never needs table
-- grants: devices owned by the caller plus their ten latest commands, with
-- page content excluded by construction (method, status and timestamps only).
create or replace function public.opera_my_devices()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  return jsonb_build_object('ok', true, 'devices', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', d.device_name, 'status', d.status,
      'extensionVersion', d.extension_version, 'lastSeenAt', d.last_seen_at,
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

-- First policies on these tables: owners read their own rows, nobody else's.
-- Service-role paths are untouched; they bypass RLS as before.
create policy opera_devices_owner_read on public.opera_devices
  for select to authenticated using (user_id = auth.uid());

create policy opera_commands_owner_read on public.opera_commands
  for select to authenticated using (
    exists (select 1 from public.opera_devices d where d.id = device_id and d.user_id = auth.uid())
  );

create policy opera_pairing_codes_owner_read on public.opera_pairing_codes
  for select to authenticated using (issued_by = auth.uid());

-- Authenticated callers need execute rights on the two RPCs the dashboard uses.
grant execute on function public.opera_create_pairing_code(text, integer, uuid) to authenticated;
grant execute on function public.opera_my_devices() to authenticated;
