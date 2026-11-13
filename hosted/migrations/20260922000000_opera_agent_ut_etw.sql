-- U-T Event-Triggered Workflows (2026-09-22): device-local watch rules fire page facts into an event stream the model subscribes to, eliminating the observe->analyze->act model round trip.
-- Also ships the universal fastpath: opera_await_adaptive (sub-50ms ramp then the proven 50ms) and opera_run_fast (enqueue+await in ONE SQL call) for the 1-hop gateway.

create table if not exists public.opera_watch_events (
  id bigint generated always as identity primary key,
  watcher_id text not null,
  device_name text not null,
  envelope jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists opera_watch_events_watcher_idx
  on public.opera_watch_events (watcher_id, id);

create index if not exists opera_watch_events_created_idx
  on public.opera_watch_events (created_at);

alter table public.opera_watch_events enable row level security;

revoke all on public.opera_watch_events from public, anon, authenticated;

create or replace function public.opera_watch_event_ingest(
  p_device_name text,
  p_token_hash text,
  p_watcher_id text,
  p_envelope jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_device public.opera_devices%rowtype;
begin
  select * into v_device from public.opera_devices
    where device_name = trim(p_device_name) and token_hash = p_token_hash and status <> 'disabled';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized device.');
  end if;
  if v_device.last_seen_at is null or v_device.last_seen_at < now() - interval '90 seconds' then
    return jsonb_build_object('ok', false, 'error', 'Device is offline.');
  end if;
  insert into public.opera_watch_events (watcher_id, device_name, envelope)
  values (trim(p_watcher_id), trim(p_device_name), p_envelope);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.opera_watch_events_wait(p_watcher text, p_after_seq bigint, p_timeout_ms integer default 25000) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_deadline timestamptz;
  v_after bigint;
  v_rows jsonb;
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
    perform pg_sleep(0.005);
  end loop;
end $$;

create or replace function public.opera_verify_device(p_device_name text, p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_device public.opera_devices%rowtype;
begin
  select * into v_device from public.opera_devices
    where device_name = trim(p_device_name) and token_hash = p_token_hash and status <> 'disabled';
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'deviceName', v_device.device_name);
end $$;

create or replace function public.opera_await_adaptive(p_command_id uuid, p_timeout_ms integer default 45000) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_deadline timestamptz; v_cmd public.opera_commands%rowtype; v_wait integer; v_polls integer := 0;
begin
  v_wait:=least(greatest(coalesce(p_timeout_ms,45000),100),55000); v_deadline:=clock_timestamp()+make_interval(secs=>v_wait/1000.0);
  loop
    select * into v_cmd from public.opera_commands where id=p_command_id; if not found then return jsonb_build_object('ok',false,'error','Command not found.'); end if;
    if v_cmd.status='completed' then return jsonb_build_object('ok',true,'commandId',v_cmd.id,'status',v_cmd.status,'result',v_cmd.result,'timing',jsonb_build_object('queuedMs',round(extract(epoch from (coalesce(v_cmd.claimed_at,v_cmd.completed_at)-v_cmd.created_at))*1000),'totalMs',round(extract(epoch from (v_cmd.completed_at-v_cmd.created_at))*1000)));
    elsif v_cmd.status in ('failed','expired','cancelled') then return jsonb_build_object('ok',false,'commandId',v_cmd.id,'status',v_cmd.status,'error',v_cmd.error); end if;
    if clock_timestamp()>=v_deadline then return jsonb_build_object('ok',false,'commandId',v_cmd.id,'status',v_cmd.status,'error',jsonb_build_object('code','AWAIT_TIMEOUT','message','Timed out waiting for command result.')); end if;
    v_polls:=v_polls+1;
    perform pg_sleep(case when v_polls<=4 then 0.005 when v_polls<=8 then 0.010 when v_polls<=10 then 0.020 else 0.050 end);
  end loop;
end $$;

create or replace function public.opera_run_fast(p_method text, p_params jsonb, p_timeout_ms integer, p_device_name text, p_request_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_device public.opera_devices%rowtype; v_enqueue jsonb; v_command_id uuid; v_timeout integer;
begin
  select * into v_device from public.opera_devices where device_name=trim(p_device_name) and status<>'disabled'; if not found then return jsonb_build_object('ok',false,'error','Device is not paired.'); end if;
  if v_device.last_seen_at is null or v_device.last_seen_at<now()-interval '90 seconds' then return jsonb_build_object('ok',false,'error','Device is offline.','lastSeenAt',v_device.last_seen_at); end if;
  v_enqueue:=public.opera_enqueue(p_method,p_params,p_timeout_ms,p_device_name,p_request_id); if coalesce((v_enqueue->>'ok')::boolean,false)=false then return v_enqueue; end if;
  v_command_id:=(v_enqueue->>'commandId')::uuid; v_timeout:=least(greatest(coalesce(p_timeout_ms,45000),500),55000); return public.opera_await_adaptive(v_command_id,v_timeout);
end $$;

revoke all on function public.opera_watch_event_ingest(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.opera_watch_event_ingest(text,text,text,jsonb) to service_role;
revoke all on function public.opera_watch_events_wait(text,bigint,integer) from public,anon,authenticated;
grant execute on function public.opera_watch_events_wait(text,bigint,integer) to service_role;
revoke all on function public.opera_verify_device(text,text) from public,anon,authenticated;
grant execute on function public.opera_verify_device(text,text) to service_role;
revoke all on function public.opera_await_adaptive(uuid,integer) from public,anon,authenticated;
grant execute on function public.opera_await_adaptive(uuid,integer) to service_role;
revoke all on function public.opera_run_fast(text,jsonb,integer,text,text) from public,anon,authenticated;
grant execute on function public.opera_run_fast(text,jsonb,integer,text,text) to service_role;

delete from public.opera_watch_events where created_at < now() - interval '24 hours';
