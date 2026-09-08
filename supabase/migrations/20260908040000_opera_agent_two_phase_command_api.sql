create or replace function public.opera_start_command(
  p_method text,
  p_params jsonb default '{}'::jsonb,
  p_timeout_ms integer default null,
  p_device_name text default 'opera',
  p_request_id text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  return public.opera_enqueue(p_method,p_params,p_timeout_ms,p_device_name,p_request_id)
    || jsonb_build_object('deferred',true,'next','opera_await');
end $$;

create or replace function public.opera_run(
  p_method text,
  p_params jsonb default '{}'::jsonb,
  p_timeout_ms integer default null,
  p_device_name text default 'opera',
  p_request_id text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  return public.opera_start_command(p_method,p_params,p_timeout_ms,p_device_name,p_request_id)
    || jsonb_build_object('compatibility','opera_run is asynchronous; call opera_await(commandId) in a separate transaction.');
end $$;

create or replace function public.opera_run_workflow(
  p_name text,
  p_input jsonb default '{}'::jsonb,
  p_timeout_ms integer default 60000,
  p_device_name text default 'opera'
) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  return public.opera_start_workflow(p_name,p_input,p_timeout_ms,p_device_name)
    || jsonb_build_object('deferred',true,'next','opera_await_workflow','compatibility','opera_run_workflow is asynchronous; call opera_await_workflow(runId) in a separate transaction.');
end $$;

revoke all on function public.opera_start_command(text,jsonb,integer,text,text) from public,anon,authenticated;
revoke all on function public.opera_run(text,jsonb,integer,text,text) from public,anon,authenticated;
revoke all on function public.opera_run_workflow(text,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.opera_start_command(text,jsonb,integer,text,text) to service_role;
grant execute on function public.opera_run(text,jsonb,integer,text,text) to service_role;
grant execute on function public.opera_run_workflow(text,jsonb,integer,text) to service_role;
