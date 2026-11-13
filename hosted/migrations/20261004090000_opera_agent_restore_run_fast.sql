-- Restore opera_run_fast (2026-10-03).

-- Reverts the `drop function` in 20261003110000_opera_agent_claim_budget_and_wait_ramp.sql.

-- Why this is being undone: that migration removed a pre-existing function that this work did not create.
-- It had no caller and nothing depended on its absence, so removing it was a preference rather than a requirement, and discarding another author's artifact is an owner decision rather than an implementation detail.
-- The same commit that dropped it also locked the drop in a test, which made the removal effectively irreversible without a further test change.
-- Both are recorded here rather than quietly reverted.

-- The function itself is restored byte-for-byte from its definition in 20260922000000_opera_agent_ut_etw.sql, together with its original service_role grant, so the granted surface is exactly what it was.

-- It remains non-functional, and this comment says why rather than leaving the next reader to rediscover it: the body enqueues and awaits inside ONE transaction, so the INSERT into opera_commands is not visible to the device's opera_claim_next until this function commits, and opera_await_adaptive therefore always returns AWAIT_TIMEOUT.
-- Calling it cannot work.

-- The correct long-term resolution is an owner decision, not a silent drop: either fix the function by moving the wait out of the enqueue transaction, or remove it deliberately in its own commit with that decision recorded.
-- Until then it stays, because deleting it is not this work's call to make.

create or replace function public.opera_run_fast(p_method text, p_params jsonb, p_timeout_ms integer, p_device_name text, p_request_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_device public.opera_devices%rowtype; v_enqueue jsonb; v_command_id uuid; v_timeout integer;
begin
  select * into v_device from public.opera_devices where device_name=trim(p_device_name) and status<>'disabled'; if not found then return jsonb_build_object('ok',false,'error','Device is not paired.'); end if;
  if v_device.last_seen_at is null or v_device.last_seen_at<now()-interval '90 seconds' then return jsonb_build_object('ok',false,'error','Device is offline.','lastSeenAt',v_device.last_seen_at); end if;
  v_enqueue:=public.opera_enqueue(p_method,p_params,p_timeout_ms,p_device_name,p_request_id); if coalesce((v_enqueue->>'ok')::boolean,false)=false then return v_enqueue; end if;
  v_command_id:=(v_enqueue->>'commandId')::uuid; v_timeout:=least(greatest(coalesce(p_timeout_ms,45000),500),55000); return public.opera_await_adaptive(v_command_id,v_timeout);
end $$;

revoke all on function public.opera_run_fast(text,jsonb,integer,text,text) from public,anon,authenticated;
grant execute on function public.opera_run_fast(text,jsonb,integer,text,text) to service_role;