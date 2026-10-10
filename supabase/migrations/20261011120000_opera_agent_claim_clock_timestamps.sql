-- WHY: opera_claim_next_wait opens ONE transaction and may then sit in its polling
-- loop for up to 25 seconds (the caller clamps wait_ms to 0..25000). Every time
-- reference inside that transaction that used now() -- which in PostgreSQL is
-- transaction_timestamp(), frozen at BEGIN -- therefore read a clock up to 25
-- seconds stale, while clock_timestamp() reads the real clock.
--
-- Proven on this database before changing anything: inside one transaction, after
-- pg_sleep(2.0), now() was 0.0000s past transaction_timestamp() and
-- clock_timestamp() was 2.0083s past it.
--
-- The function author already knew this. v_started, v_deadline, the loop's exit
-- condition and the returned waitedMs are all measured with clock_timestamp(),
-- because those are elapsed-time measurements a frozen clock would make wrong. Two
-- reads were left on now() anyway, and those are the two that decide what work runs:
--
--   1. claimed_at = now(). A command that arrived three seconds into the wait was
--      stamped as claimed three seconds BEFORE it was created. Measured on the live
--      table before this migration: 306 of 9732 rows (3.1%) had
--      claimed_at < created_at, the worst by 5029ms -- almost exactly the 5s wait
--      window the extension sends. Every latency figure derived from these columns
--      was wrong for exactly the fastest claims, which are the ones anyone looks at
--      when asking "is this fast?". The function's own waitedMs was already correct,
--      so the function knew the real wait while the table recorded a fiction.
--
--   2. expires_at > now() in the candidate SELECT, and expires_at <= now() in the
--      expiry sweep. These read as "not yet expired" for the whole transaction, so a
--      command that expired while the caller waited was still handed out. An agent
--      that receives an expired command runs work whose caller has already given up,
--      and the result lands nowhere.
--
-- WHAT: one change -- every now() in this function becomes clock_timestamp() -- so
-- the whole function reads one clock. There is no behavioural change for a call that
-- returns immediately, because clock_timestamp() and now() agree at that instant.
-- The change only removes drift that accumulates across a long wait.
--
-- WHY NOT A TRIGGER: a trigger would fix rows written from elsewhere but leave the
-- two comparisons inside this function still reading a stale clock, which is the
-- half that hands out expired work. The function is the defect.

-- WHY this drop, and why it must stay: applying this fix with the wrong parameter
-- order does not replace the function, it ADDS a second overload, because PostgreSQL
-- matches create or replace on the argument TYPE LIST including order. With two
-- overloads PostgREST cannot choose one for a named-argument call, so the extension's
-- pull loop fails to resolve the function at all. That happened once during this
-- work: the fix was first written as (text,text,integer,text,integer,jsonb), which
-- left the original 7-now() body live and call-broken until it was dropped.
-- The signature below is the one opera-agent-bridge actually calls, and the test in
-- tests/postgres/ pins the overload count to one so a second copy cannot reappear.

drop function if exists public.opera_claim_next_wait(text, text, integer, text, integer, jsonb);

create or replace function public.opera_claim_next_wait(
  p_device_name       text,
  p_token_hash        text,
  p_extension_version text    default null,
  p_protocol_version  integer default null,
  p_capabilities      jsonb   default null,
  p_wait_ms           integer default 12000
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device_id uuid;
  v_cmd       public.opera_commands%rowtype;
  v_deadline  timestamptz;
  v_started   timestamptz;
  v_polls     integer := 0;
  v_now       timestamptz;
begin
  -- ONE clock for the whole function, read at the moment of use. Reading
  -- clock_timestamp() inline would work too, but then each call site is a separate
  -- chance to reintroduce the bug and there is no way to see from the SQL whether a
  -- given reference was left on the frozen clock.

  v_started := clock_timestamp();
  v_device_id := public.opera_auth_device(p_device_name, p_token_hash);
  if v_device_id is null then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized device.');
  end if;

  update public.opera_devices
     set status = 'online',
         extension_version = case when coalesce(p_extension_version, '') <> '' then left(p_extension_version, 64) else extension_version end,
         protocol_version = coalesce(p_protocol_version, protocol_version),
         capabilities = case when jsonb_typeof(coalesce(p_capabilities, '[]'::jsonb)) = 'array' then p_capabilities else capabilities end,
         last_seen_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where id = v_device_id
     and (last_seen_at is null or last_seen_at < clock_timestamp() - interval '3 seconds');

  v_now := clock_timestamp();
  update public.opera_commands
     set status = 'expired',
         completed_at = v_now,
         error = jsonb_build_object('code', 'EXPIRED', 'message', 'Command expired before execution.')
   where device_id = v_device_id
     and status in ('queued', 'claimed')
     and expires_at <= v_now;

  v_deadline := clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_wait_ms, 12000), 0), 25000) / 1000.0);

  loop
    v_now := clock_timestamp();
    select * into v_cmd
      from public.opera_commands
     where device_id = v_device_id
       and status = 'queued'
       and expires_at > v_now
     order by created_at
     for update skip locked
     limit 1;
    exit when found;
    exit when v_now >= v_deadline;
    v_polls := v_polls + 1;
    perform pg_sleep(case when v_polls <= 8 then 0.005
                         when v_polls <= 16 then 0.010
                         when v_polls <= 24 then 0.025
                         when v_polls <= 32 then 0.050
                         else 0.100 end);
  end loop;

  if not found then
    return jsonb_build_object('ok', true, 'command', null, 'waitedPolls', v_polls,
                              'waitedMs', round(extract(epoch from (clock_timestamp() - v_started)) * 1000));
  end if;

  -- The line the whole migration exists for. claimed_at is the moment the claim
  -- happened, and the claim happens after a wait that may be a quarter of a minute
  -- long, so now() would stamp it before the row existed.
  update public.opera_commands
     set status = 'claimed',
         attempts = attempts + 1,
         claimed_at = clock_timestamp()
   where id = v_cmd.id
   returning * into v_cmd;

  insert into public.opera_audit(event_type, device_id, command_id, details)
  values ('command.claimed', v_device_id, v_cmd.id, jsonb_build_object('method', v_cmd.method, 'attempt', v_cmd.attempts));

  return jsonb_build_object('ok', true,
                            'command', jsonb_build_object('id', v_cmd.id, 'method', v_cmd.method, 'params', v_cmd.params, 'timeoutMs', v_cmd.timeout_ms),
                            'waitedPolls', v_polls,
                            'waitedMs', round(extract(epoch from (clock_timestamp() - v_started)) * 1000));
end;
$$;

revoke all on function public.opera_claim_next_wait(text, text, text, integer, jsonb, integer) from public, anon, authenticated;
grant execute on function public.opera_claim_next_wait(text, text, text, integer, jsonb, integer) to service_role;

-- WHY this comment: a function whose every line reads now() is indistinguishable
-- from a function that has this bug again. The invariant is one sentence, so the next
-- reader can check it without reading the body.
comment on function public.opera_claim_next_wait(text, text, text, integer, jsonb, integer) is
  'Long-poll claim. EVERY time reference must use clock_timestamp(), never now(): this function holds one transaction for up to 25 seconds and now() is frozen at BEGIN. On the frozen clock a claim is stamped before its command exists, and a command that expired during the wait is still handed out.';