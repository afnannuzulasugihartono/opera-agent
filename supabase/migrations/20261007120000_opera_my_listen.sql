-- Let a signed-in account see its own listening sessions without transcript text.
--
-- WHY metadata only, never segment text: the dashboard doctrine is method and
-- status, never content — a screenshot of this page must not leak speech. The
-- full transcript travels only inside MCP tool results to the paired agent.

create or replace function public.opera_my_listen()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  return jsonb_build_object('ok', true, 'sessions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'deviceName', d.device_name, 'status', s.status,
      'startedAt', s.started_at, 'endedAt', s.ended_at,
      'segments', (select count(*) from public.opera_listen_segments g where g.session_id = s.id)
    ) order by s.started_at desc)
    from public.opera_listen_sessions s join public.opera_devices d on d.id = s.device_id
    where s.user_id = v_uid
  ), '[]'::jsonb));
end $$;

revoke execute on function public.opera_my_listen() from public, anon;
grant execute on function public.opera_my_listen() to authenticated;
