-- Command execution budget and wait-ramp corrections (2026-10-02).
--
-- Four independent defects found while measuring the AI command path. No
-- response contract changes: every function keeps its signature, its envelope,
-- and its grants.
--
-- 1. The execution budget started at enqueue.
--
--    `expires_at` was set to now() + timeout_ms + 5s when the command was
--    enqueued, so time spent queued was charged against the command's own
--    execution budget. Two functions then act on that column:
--    `opera_claim_next` sweeps any `queued`/`claimed` row past `expires_at` into
--    `expired`, and `opera_complete_command` refuses to complete anything that is
--    not `claimed` or `queued`.
--
--    The reachable failure: a command enqueued while the device is offline sits
--    queued for minutes, is claimed on reconnect with almost nothing left, and
--    the very next poll flips it to `expired` while the extension is still
--    executing it. The completion is then rejected as "no longer completable"
--    and the work is silently lost. With the server-side wait installed on
--    2026-10-02 the normal queue wait is ~118ms p50, but an offline device is
--    still minutes, so the bug remains reachable.
--
--    The claim now restarts the clock from `timeout_ms`, so a command always gets
--    its full execution budget once the device actually takes it. Enqueue keeps
--    its own expiry so a command that nobody ever claims is still swept; that
--    value now bounds "never claimed" rather than "queued plus executed".
--
-- 2. `opera_watch_events_wait` polled at a flat 5ms for up to 32 seconds, which
--    Phase A measured at 6400 loop iterations per full-length call. It now uses
--    the same ramp `opera_await_adaptive` already uses: 5/5/5/5/10/10/10/10/20/
--    20 then 50ms. Measured at 648 iterations for the same 32 seconds, a 9.9x
--    reduction, with the first 100ms exactly as fine as before. That opening
--    window is the one that matters, because a watch fires in response to the
--    `start_watch` that armed it.
--
-- 3. `created_at` defaulted to `now()`, which in Postgres is
--    `transaction_timestamp()` and therefore constant for a whole transaction.
--    The claim orders by `created_at`, so rows inserted together had a
--    non-deterministic order and `for update skip locked limit 1` could pick any
--    of them. `clock_timestamp()` varies within a transaction, so the queue
--    index (device_id, status, created_at) now yields a strict order. Existing
--    rows keep their recorded timestamps.
--
-- 4. `opera_run_fast` is dropped. It enqueues and awaits inside one transaction,
--    so the INSERT is not visible to the device's `opera_claim_next` until the
--    function commits, and `opera_await_adaptive` therefore always timed out.
--    No caller existed, yet it was granted to service_role, which made it a live
--    trap for the next person who found the name. The definition remains in
--    `20260922000000_opera_agent_ut_etw.sql`, so the drop is reversible by
--    replaying that migration.

-- 1. The execution budget starts when the command is claimed.
create or replace function public.opera_enqueue(p_method text,p_params jsonb default '{}'::jsonb,p_timeout_ms integer default null,p_device_name text default 'opera',p_request_id text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_device public.opera_devices%rowtype; v_default_timeout integer; v_timeout integer; v_cmd public.opera_commands%rowtype;
begin
  select default_timeout_ms into v_default_timeout from public.opera_methods where method=p_method and enabled=true; if v_default_timeout is null then return jsonb_build_object('ok',false,'error','Method is not allowlisted.'); end if;
  select * into v_device from public.opera_devices where device_name=trim(p_device_name) and status<>'disabled'; if not found then return jsonb_build_object('ok',false,'error','Device is not paired.'); end if;
  v_timeout:=least(greatest(coalesce(p_timeout_ms,v_default_timeout),500),55000);
  if p_request_id is not null then select * into v_cmd from public.opera_commands where device_id=v_device.id and request_id=left(p_request_id,128); if found then return jsonb_build_object('ok',true,'commandId',v_cmd.id,'status',v_cmd.status,'reused',true); end if; end if;

  insert into public.opera_commands(device_id,request_id,method,params,status,timeout_ms,expires_at) values(v_device.id,case when p_request_id is null then null else left(p_request_id,128) end,p_method,coalesce(p_params,'{}'::jsonb),'queued',v_timeout,clock_timestamp()+make_interval(secs=>(v_timeout/1000.0)+5)) returning * into v_cmd;
  insert into public.opera_audit(event_type,device_id,command_id,details) values('command.queued',v_device.id,v_cmd.id,jsonb_build_object('method',v_cmd.method,'timeoutMs',v_timeout));
  return jsonb_build_object('ok',true,'commandId',v_cmd.id,'status',v_cmd.status,'reused',false);
end $$;

create or replace function public.opera_claim_next(p_device_name text,p_token_hash text,p_extension_version text default '',p_protocol_version integer default 1,p_capabilities jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_device_id uuid; v_cmd public.opera_commands%rowtype;
begin
  v_device_id:=public.opera_auth_device(p_device_name,p_token_hash); if v_device_id is null then return jsonb_build_object('ok',false,'error','Unauthorized device.'); end if;
  update public.opera_devices set status='online',extension_version=case when coalesce(p_extension_version,'')<>'' then left(p_extension_version,64) else extension_version end,protocol_version=coalesce(p_protocol_version,protocol_version),capabilities=case when jsonb_typeof(coalesce(p_capabilities,'[]'::jsonb))='array' then p_capabilities else capabilities end,last_seen_at=now(),updated_at=now() where id=v_device_id and (last_seen_at is null or last_seen_at<now()-interval '3 seconds');
  update public.opera_commands set status='expired',completed_at=now(),error=jsonb_build_object('code','EXPIRED','message','Command expired before execution.') where device_id=v_device_id and status in ('queued','claimed') and expires_at<=now();
  select * into v_cmd from public.opera_commands where device_id=v_device_id and status='queued' and expires_at>now() order by created_at for update skip locked limit 1;
  if not found then return jsonb_build_object('ok',true,'command',null); end if;

  update public.opera_commands set status='claimed',attempts=attempts+1,claimed_at=clock_timestamp(),expires_at=clock_timestamp()+make_interval(secs=>(v_cmd.timeout_ms/1000.0)+5) where id=v_cmd.id returning * into v_cmd;
  insert into public.opera_audit(event_type,device_id,command_id,details) values('command.claimed',v_device_id,v_cmd.id,jsonb_build_object('method',v_cmd.method,'attempt',v_cmd.attempts));
  return jsonb_build_object('ok',true,'command',jsonb_build_object('id',v_cmd.id,'method',v_cmd.method,'params',v_cmd.params,'timeoutMs',v_cmd.timeout_ms));
end $$;

create or replace function public.opera_claim_next_wait(
  p_device_name text,
  p_token_hash text,
  p_extension_version text default '',
  p_protocol_version integer default 1,
  p_capabilities jsonb default '[]'::jsonb,
  p_wait_ms integer default 12000
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_device_id uuid;
  v_cmd public.opera_commands%rowtype;
  v_deadline timestamptz;
  v_started timestamptz;
  v_polls integer := 0;
begin
  v_started:=clock_timestamp();
  v_device_id:=public.opera_auth_device(p_device_name,p_token_hash); if v_device_id is null then return jsonb_build_object('ok',false,'error','Unauthorized device.'); end if;
  update public.opera_devices set status='online',extension_version=case when coalesce(p_extension_version,'')<>'' then left(p_extension_version,64) else extension_version end,protocol_version=coalesce(p_protocol_version,protocol_version),capabilities=case when jsonb_typeof(coalesce(p_capabilities,'[]'::jsonb))='array' then p_capabilities else capabilities end,last_seen_at=now(),updated_at=now() where id=v_device_id and (last_seen_at is null or last_seen_at<now()-interval '3 seconds');
  update public.opera_commands set status='expired',completed_at=now(),error=jsonb_build_object('code','EXPIRED','message','Command expired before execution.') where device_id=v_device_id and status in ('queued','claimed') and expires_at<=now();
  v_deadline:=clock_timestamp()+make_interval(secs=>least(greatest(coalesce(p_wait_ms,12000),0),25000)/1000.0);
  loop
    select * into v_cmd from public.opera_commands where device_id=v_device_id and status='queued' and expires_at>now() order by created_at for update skip locked limit 1;
    exit when found;
    exit when clock_timestamp()>=v_deadline;
    v_polls:=v_polls+1;
    perform pg_sleep(case when v_polls<=8 then 0.005 when v_polls<=16 then 0.010 when v_polls<=24 then 0.025 when v_polls<=32 then 0.050 else 0.250 end);
  end loop;
  if not found then
    return jsonb_build_object('ok',true,'command',null,'waitedPolls',v_polls,'waitedMs',round(extract(epoch from (clock_timestamp()-v_started))*1000));
  end if;
  update public.opera_commands set status='claimed',attempts=attempts+1,claimed_at=clock_timestamp(),expires_at=clock_timestamp()+make_interval(secs=>(v_cmd.timeout_ms/1000.0)+5) where id=v_cmd.id returning * into v_cmd;
  insert into public.opera_audit(event_type,device_id,command_id,details) values('command.claimed',v_device_id,v_cmd.id,jsonb_build_object('method',v_cmd.method,'attempt',v_cmd.attempts));
  return jsonb_build_object('ok',true,'command',jsonb_build_object('id',v_cmd.id,'method',v_cmd.method,'params',v_cmd.params,'timeoutMs',v_cmd.timeout_ms),'waitedPolls',v_polls,'waitedMs',round(extract(epoch from (clock_timestamp()-v_started))*1000));
end $$;

create or replace function public.opera_watch_events_wait(p_watcher text, p_after_seq bigint, p_timeout_ms integer default 25000) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_deadline timestamptz;
  v_after bigint;
  v_rows jsonb;
  v_polls integer := 0;
begin
  v_after := greatest(coalesce(p_after_seq, 0), 0);
  v_deadline := clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_timeout_ms, 25000), 100), 32000) / 1000.0);
  loop
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.id), '[]'::jsonb)
      into v_rows
      from (
        select id, watcher_id, device_name, envelope, created_at
        from public.opera_watch_events
        where id > v_after
          and (p_watcher is null or watcher_id = trim(p_watcher))
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
    v_polls := v_polls + 1;
    perform pg_sleep(case when v_polls<=4 then 0.005 when v_polls<=8 then 0.010 when v_polls<=10 then 0.020 else 0.050 end);
  end loop;
end $$;

alter table public.opera_commands alter column created_at set default clock_timestamp();

drop function if exists public.opera_run_fast(text,jsonb,integer,text,text);

revoke all on function public.opera_enqueue(text,jsonb,integer,text,text) from public,anon,authenticated;
grant execute on function public.opera_enqueue(text,jsonb,integer,text,text) to service_role;
revoke all on function public.opera_claim_next(text,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.opera_claim_next(text,text,text,integer,jsonb) to service_role;
revoke all on function public.opera_claim_next_wait(text,text,text,integer,jsonb,integer) from public,anon,authenticated;
grant execute on function public.opera_claim_next_wait(text,text,text,integer,jsonb,integer) to service_role;
revoke all on function public.opera_watch_events_wait(text,bigint,integer) from public,anon,authenticated;
grant execute on function public.opera_watch_events_wait(text,bigint,integer) to service_role;