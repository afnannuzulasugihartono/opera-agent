-- WHY THE PROVIDER RIDES ALONG.

-- Every tool call recorded which client made it with a second write after the command finished: the edge function enqueued, waited, then issued an UPDATE to stamp the provider column.
-- That UPDATE is a full HTTPS crossing to the data API on the critical path, after the answer is already known, and measured at roughly 250 ms against a command the browser answers in under a millisecond.
-- It also forced the hot path to load the database client library for a single statement it otherwise never needs.

-- The provider is known before the command exists, so it is set at INSERT instead.
-- The separate UPDATE is gone and nothing reads differently: the column holds the same value it always held, only written once.
-- Callers that do not pass a provider keep the column default exactly as before, so this is backward compatible with every existing caller.

-- The old five-argument overload must go explicitly: create or replace with a new signature adds an overload instead of replacing, and two overloads leave PostgREST unable to resolve calls that omit the new argument.

drop function if exists public.opera_enqueue(text, jsonb, integer, text, text);

create or replace function public.opera_enqueue(
  p_method text,
  p_params jsonb default '{}'::jsonb,
  p_timeout_ms integer default null::integer,
  p_device_name text default 'opera'::text,
  p_request_id text default null::text,
  p_provider text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_device public.opera_devices%rowtype; v_default_timeout integer; v_timeout integer; v_cmd public.opera_commands%rowtype;
begin
  select default_timeout_ms into v_default_timeout from public.opera_methods where method=p_method and enabled=true; if v_default_timeout is null then return jsonb_build_object('ok',false,'error','Method is not allowlisted.'); end if;
  select * into v_device from public.opera_devices where device_name=trim(p_device_name) and status<>'disabled'; if not found then return jsonb_build_object('ok',false,'error','Device is not paired.'); end if;
  v_timeout:=least(greatest(coalesce(p_timeout_ms,v_default_timeout),500),55000);
  if p_request_id is not null then
    select * into v_cmd from public.opera_commands where device_id=v_device.id and request_id=left(p_request_id,128);
    if found then
      if p_provider is not null and coalesce(v_cmd.provider, '') <> left(p_provider, 64) then
        update public.opera_commands set provider = left(p_provider, 64) where id = v_cmd.id;
      end if;
      return jsonb_build_object('ok',true,'commandId',v_cmd.id,'status',v_cmd.status,'reused',true);
    end if;
  end if;
  -- Unchanged in meaning: this is the "nobody ever claims it" deadline.
  -- The claim below restarts the clock for the command's actual execution budget.
  insert into public.opera_commands(device_id,request_id,method,params,status,timeout_ms,expires_at,provider) values(v_device.id,case when p_request_id is null then null else left(p_request_id,128) end,p_method,coalesce(p_params,'{}'::jsonb),'queued',v_timeout,clock_timestamp()+make_interval(secs=>(v_timeout/1000.0)+5),case when p_provider is null then '' else left(p_provider,64) end) returning * into v_cmd;
  insert into public.opera_audit(event_type,device_id,command_id,details) values('command.queued',v_device.id,v_cmd.id,jsonb_build_object('method',v_cmd.method,'timeoutMs',v_timeout));
  return jsonb_build_object('ok',true,'commandId',v_cmd.id,'status',v_cmd.status,'reused',false);
end $function$;
