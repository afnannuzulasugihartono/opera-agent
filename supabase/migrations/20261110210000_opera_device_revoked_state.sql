-- A revoked device must leave the account, not sit on the dashboard wearing an offline badge.
-- "Cabut device ini" cut the credentials and set the row offline, and the account's device list still carried it, so the reader saw the same card after the button and concluded that nothing happened.
-- The state now says what it means: a revoked row is one whose token was cut on purpose, and the account's list does not count it as a device.

-- WHY THE ROW IS KEPT AND ONLY MARKED.
-- The commands a device ran belong to the account's history, and a deleted row would leave them pointing at nothing.
-- The row stays, the token stays cut, and the account's device list stops carrying it.

-- WHY THE ALREADY REVOKED ROWS ARE MARKED NOW.
-- Two devices were revoked before this migration, with the old wording: status offline and a cut token.
-- They are the same state, so they are named the same way, and they leave the list with the rest.

update public.opera_devices
set status = 'revoked', updated_at = now()
where token_hash = repeat('0', 64) and status <> 'revoked';

-- WHY THE STATUS CARRIES A WORD OF ITS OWN.
-- "offline" says a browser is not answering right now; "revoked" says this browser was cut off on purpose.
-- The two must not read the same, because one is a moment and the other is a decision.

alter table public.opera_devices
  drop constraint if exists opera_devices_status_check;
alter table public.opera_devices
  add constraint opera_devices_status_check check (status = any (array['offline'::text, 'online'::text, 'disabled'::text, 'revoked'::text]));

-- WHY THE REVOKE SETS THAT STATE.
-- The button says "cut this off", so the row is cut off: the token is replaced by a value no browser holds, the presence is cleared, and the row is marked revoked so no list counts it.
-- The token was already the real authority, so a revoked device cannot authenticate and cannot claim a command; the state is what the reader sees.

create or replace function public.opera_revoke_my_device(p_device_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare v_name text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  update public.opera_devices set
    token_hash = repeat('0', 64),
    status = 'revoked',
    last_seen_at = null,
    updated_at = now()
  where id = p_device_id and user_id = auth.uid()
  returning device_name into v_name;
  if not found then return jsonb_build_object('ok', false, 'error', 'No such device on this account.'); end if;
  insert into public.opera_audit(event_type, device_id, details) values ('device.revoked', p_device_id, jsonb_build_object('deviceName', v_name));
  return jsonb_build_object('ok', true, 'deviceName', v_name);
end $$;

revoke all on function public.opera_revoke_my_device(uuid) from public;
grant execute on function public.opera_revoke_my_device(uuid) to authenticated, service_role;

-- WHY THE LIST LEAVES THE REVOKED OUT.
-- A revoked browser is not one of the account's devices any more, and the count that answers "how many browsers am I driving" must not carry it.
-- The row stays in the table for the history; the list is what the reader reads.

create or replace function public.opera_my_devices()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
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
          'method', c.method, 'status', c.status, 'provider', c.provider,
          'createdAt', c.created_at, 'completedAt', c.completed_at
        ) order by c.created_at desc)
        from (select * from public.opera_commands where device_id = d.id order by created_at desc limit 10) c
      ), '[]'::jsonb)
    ) order by d.created_at)
    from public.opera_devices d where d.user_id = v_uid and d.status <> 'revoked'
  ), '[]'::jsonb));
end $$;

revoke all on function public.opera_my_devices() from public;
grant execute on function public.opera_my_devices() to authenticated, service_role;
