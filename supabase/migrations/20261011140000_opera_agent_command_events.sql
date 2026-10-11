-- Streaming events for a running command (2026-10-11).
--
-- The MCP edge function is stateless. Every POST builds a fresh server and
-- transport, enqueues a command, and blocks in opera_await_adaptive until the
-- device finishes it. The device knows what happened in between and had no way
-- to say so, so an eight-step burst or a twenty-second workflow was one opaque
-- wait for the model.
--
-- This adds the channel the watch-event path already proved: a cursor long-poll
-- that returns the instant rows appear rather than at a deadline. The shape is
-- copied from opera_watch_events_wait on purpose -- same 5ms sleep, same
-- "return rows first, ask the deadline second" ordering.
--
-- An event envelope reaches a model's context, so this is treated as an
-- untrusted input surface rather than a log:
--
--   - emit authenticates the device through opera_auth_device, the same helper
--     the claim path uses, and refuses a command whose device_id is not that
--     device. Without the ownership check any paired device could write into any
--     owner's command stream.
--   - kind is matched against a fixed allowlist instead of being stored as sent.
--     The kind is the label the model switches on, so an unbounded one would let
--     a device invent a category the consumer treats as trusted.
--   - the table has row level security on, no policies, and no grants to anon or
--     authenticated. The streaming path runs as service_role. Unlike the watch
--     events there is deliberately no owner-read policy: no surface reads these
--     as a user today, and an unused policy is a wider door than a missing one.
--
-- Retention is stated here because nothing else prunes this table. Command rows
-- are swept elsewhere; event rows are not, so without the explicit delete below
-- the table would grow by one row per action for the life of the deployment.
--
-- Both CREATE OR REPLACE statements carry the full argument type list in order.
-- A mismatched list does not replace a function, it creates a second overload,
-- and PostgREST then cannot resolve a named-argument call to either. That is not
-- hypothetical: opera_claim_next_wait was deployed with a reordered parameter
-- list and broke the extension's pull loop until pg_proc was read by hand.

create table if not exists public.opera_command_events (
  id bigserial primary key,
  command_id uuid not null references public.opera_commands(id) on delete cascade,
  device_name text not null,
  kind text not null,
  envelope jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists opera_command_events_command_idx on public.opera_command_events (command_id, id);

alter table public.opera_command_events enable row level security;

revoke all on public.opera_command_events from public, anon, authenticated;

create or replace function public.opera_emit_command_event(
  p_device_name text,
  p_token_hash text,
  p_command_id uuid,
  p_kind text,
  p_envelope jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_device_id uuid;
  v_kind text;
  v_event_id bigint;
begin
  v_kind := trim(coalesce(p_kind, ''));
  if v_kind = any(array['received','step','observation','note','done']) is not true then
    return jsonb_build_object('ok', false, 'error', 'Unknown event kind.');
  end if;

  v_device_id := public.opera_auth_device(p_device_name, p_token_hash);
  if v_device_id is null then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized device.');
  end if;

  if not exists (select 1 from public.opera_commands where id = p_command_id and device_id = v_device_id) then
    return jsonb_build_object('ok', false, 'error', 'Command not found.');
  end if;

  insert into public.opera_command_events (command_id, device_name, kind, envelope)
  values (p_command_id, trim(p_device_name), v_kind, coalesce(p_envelope, '{}'::jsonb))
  returning id into v_event_id;

  return jsonb_build_object('ok', true, 'eventId', v_event_id);
end $$;

create or replace function public.opera_command_events_wait(
  p_command_id uuid,
  p_after_id bigint default 0,
  p_timeout_ms integer default 20000
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_deadline timestamptz;
  v_after bigint;
  v_rows jsonb;
begin
  v_after := greatest(coalesce(p_after_id, 0), 0);
  v_deadline := clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_timeout_ms, 20000), 100), 30000) / 1000.0);
  loop
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.id), '[]'::jsonb)
      into v_rows
      from (
        select id, command_id, kind, envelope, created_at
        from public.opera_command_events
        where command_id = p_command_id
          and id > v_after
        order by id
        limit 200
      ) t;
    if jsonb_array_length(v_rows) > 0 then
      return jsonb_build_object(
        'ok', true,
        'events', v_rows,
        'cursor', (select max((e->>'id')::bigint) from jsonb_array_elements(v_rows) e),
        'count', jsonb_array_length(v_rows)
      );
    end if;
    if clock_timestamp() >= v_deadline then
      return jsonb_build_object('ok', true, 'events', '[]'::jsonb, 'cursor', v_after, 'count', 0);
    end if;
    perform pg_sleep(0.005);
  end loop;
end $$;

revoke all on function public.opera_emit_command_event(text,text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.opera_emit_command_event(text,text,uuid,text,jsonb) to service_role;
revoke all on function public.opera_command_events_wait(uuid,bigint,integer) from public, anon, authenticated;
grant execute on function public.opera_command_events_wait(uuid,bigint,integer) to service_role;

delete from public.opera_command_events where created_at < now() - interval '6 hours';