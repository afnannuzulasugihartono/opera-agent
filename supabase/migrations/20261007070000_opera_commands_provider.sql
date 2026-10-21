-- Track which AI harness issued each command and workflow run, so the dashboard can show device + browser + provider per row (e.g. opera / Brave / opencode).
-- The MCP server stamps provider after enqueue; unknown callers stay ''.

alter table public.opera_commands add column if not exists provider text not null default '';
alter table public.opera_workflow_runs add column if not exists provider text not null default '';

create index if not exists opera_commands_provider_idx
  on public.opera_commands(provider) where provider <> '';

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
          'method', c.method, 'status', c.status, 'provider', c.provider,
          'createdAt', c.created_at, 'completedAt', c.completed_at
        ) order by c.created_at desc)
        from (select * from public.opera_commands where device_id = d.id order by created_at desc limit 10) c
      ), '[]'::jsonb)
    ) order by d.created_at)
    from public.opera_devices d where d.user_id = v_uid
  ), '[]'::jsonb));
end $$;
