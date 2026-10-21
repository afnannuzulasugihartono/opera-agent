-- Report terminal command state from the streaming wait (2026-10-11).

-- opera_command_events_wait as first written could only say "events arrived".
-- The consumer that streams a command has two questions on every pass -- did anything happen, and is this command finished -- and answering the second with a separate call to opera_await_adaptive turns one round trip into two per tick.

-- The status is read on every pass, including the empty ones, so the consumer's loop is a single call: read the events that exist, read whether the command has reached a terminal status, and exit on either signal.

-- The status column is exposed as a string the caller compares, not as a boolean.
-- 'completed', 'failed', 'expired' and 'cancelled' are terminal; 'queued' and 'claimed' are not.
-- Encoding that set in SQL would hide it from the caller, and the set is exactly the one opera_await_adaptive already branches on.

-- This is a new file rather than an edit to 20261011140000 because migrations in this repository are not edited in place.

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
  v_status text;
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

    select status into v_status from public.opera_commands where id = p_command_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'Command not found.', 'events', '[]'::jsonb, 'cursor', v_after, 'count', 0);
    end if;

    if jsonb_array_length(v_rows) > 0 then
      return jsonb_build_object(
        'ok', true,
        'events', v_rows,
        'cursor', (select max((e->>'id')::bigint) from jsonb_array_elements(v_rows) e),
        'count', jsonb_array_length(v_rows),
        'status', v_status
      );
    end if;

    if v_status in ('completed','failed','expired','cancelled') then
      return jsonb_build_object('ok', true, 'events', '[]'::jsonb, 'cursor', v_after, 'count', 0, 'status', v_status);
    end if;

    if clock_timestamp() >= v_deadline then
      return jsonb_build_object('ok', true, 'events', '[]'::jsonb, 'cursor', v_after, 'count', 0, 'status', v_status);
    end if;
    perform pg_sleep(0.005);
  end loop;
end $$;

revoke all on function public.opera_command_events_wait(uuid,bigint,integer) from public, anon, authenticated;
grant execute on function public.opera_command_events_wait(uuid,bigint,integer) to service_role;