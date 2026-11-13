-- Server-side command discovery for the extension pull path (2026-10-02).

-- The bridge used to sleep between `opera_claim_next` calls, which cost one HTTP round trip per poll: 14 per 12s window per idle device.
-- Phase A measured the resulting queue wait at p50 830ms and p95 1910ms, because the device only asks again every 2000ms once the fast window has closed.

-- This function moves the wait next to the data.
-- The bridge makes exactly one call per window and the database decides when a command arrived.

-- Two properties are deliberate and load-bearing:

-- 1. The device heartbeat, the expiry sweep and the audit INSERT are written ONCE, before the cycle opens.
--    Running the full `opera_claim_next` body per iteration would issue five statements per poll, which at a 5ms cadence is roughly 21 calls per second -- about 18x the current database load, which would trade egress for a larger problem.
--    The cycle body is a single index-served lookup on opera_commands_queue_idx (device_id, status, created_at).

-- 2. The ramp stays under 50ms for the first 720ms of an idle window.
--    The 2026-09-24 egress note records that follow-up commands arrive right behind the previous HTTP round trip, so that is the window where responsiveness is actually felt.
--    The tail coarsens to 250ms because after that point a human is not waiting on the next action yet.

-- `opera_claim_next` is intentionally left in place: it remains the single-shot, non-waiting claim, and removing it would change a public RPC contract beyond this task.

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

  update public.opera_commands set status='claimed',attempts=attempts+1,claimed_at=now() where id=v_cmd.id returning * into v_cmd;
  insert into public.opera_audit(event_type,device_id,command_id,details) values('command.claimed',v_device_id,v_cmd.id,jsonb_build_object('method',v_cmd.method,'attempt',v_cmd.attempts));
  return jsonb_build_object('ok',true,'command',jsonb_build_object('id',v_cmd.id,'method',v_cmd.method,'params',v_cmd.params,'timeoutMs',v_cmd.timeout_ms),'waitedPolls',v_polls,'waitedMs',round(extract(epoch from (clock_timestamp()-v_started))*1000));
end $$;

revoke all on function public.opera_claim_next_wait(text,text,text,integer,jsonb,integer) from public,anon,authenticated;
grant execute on function public.opera_claim_next_wait(text,text,text,integer,jsonb,integer) to service_role;