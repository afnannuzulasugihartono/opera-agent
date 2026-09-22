create extension if not exists pg_net;

create table if not exists public.opera_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_name text not null,
  workflow_version integer not null,
  device_name text not null,
  input jsonb not null default '{}'::jsonb,
  definition jsonb not null,
  context jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','expired','cancelled')),
  timeout_ms integer not null check (timeout_ms between 1000 and 120000),
  trigger_hash text not null check (trigger_hash ~ '^[a-f0-9]{64}$'),
  result jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists opera_workflow_runs_status_created_idx on public.opera_workflow_runs(status,created_at desc);
create index if not exists opera_workflow_runs_workflow_idx on public.opera_workflow_runs(workflow_name,created_at desc);

alter table public.opera_workflow_runs enable row level security;
revoke all on public.opera_workflow_runs from anon,authenticated;

create or replace function public.opera_start_workflow(
  p_name text,
  p_input jsonb default '{}'::jsonb,
  p_timeout_ms integer default 60000,
  p_device_name text default 'opera'
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,net
as $$
declare
  v_wf public.opera_workflows%rowtype;
  v_run public.opera_workflow_runs%rowtype;
  v_token text;
  v_timeout integer;
  v_request_id bigint;
begin
  select * into v_wf from public.opera_workflows where name=p_name and enabled=true;
  if not found then
    return jsonb_build_object('ok',false,'error',jsonb_build_object('code','WORKFLOW_NOT_FOUND','message','Workflow not found or disabled.'));
  end if;
  if not exists(select 1 from public.opera_devices where device_name=trim(p_device_name) and status<>'disabled') then
    return jsonb_build_object('ok',false,'error',jsonb_build_object('code','DEVICE_NOT_PAIRED','message','Device is not paired.'));
  end if;
  v_timeout:=least(greatest(coalesce(p_timeout_ms,60000),1000),120000);
  v_token:=encode(gen_random_bytes(24),'hex');
  insert into public.opera_workflow_runs(
    workflow_name,workflow_version,device_name,input,definition,context,status,timeout_ms,trigger_hash
  ) values (
    v_wf.name,v_wf.version,trim(p_device_name),coalesce(p_input,'{}'::jsonb),v_wf.definition,
    jsonb_build_object('input',coalesce(p_input,'{}'::jsonb),'vars','{}'::jsonb,'steps','{}'::jsonb),
    'queued',v_timeout,public.opera_sha256(v_token)
  ) returning * into v_run;

  select net.http_post(
    url := 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-runner',
    body := jsonb_build_object('runId',v_run.id,'token',v_token),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 5000
  ) into v_request_id;

  insert into public.opera_audit(event_type,workflow_name,details)
  values('workflow.started',v_wf.name,jsonb_build_object('runId',v_run.id,'version',v_wf.version,'requestId',v_request_id,'timeoutMs',v_timeout));

  return jsonb_build_object('ok',true,'runId',v_run.id,'status','queued','workflow',v_wf.name,'version',v_wf.version,'requestId',v_request_id);
end $$;

create or replace function public.opera_get_workflow_run(p_run_id uuid) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_run public.opera_workflow_runs%rowtype;
begin
  select * into v_run from public.opera_workflow_runs where id=p_run_id;
  if not found then return jsonb_build_object('ok',false,'error',jsonb_build_object('code','RUN_NOT_FOUND','message','Workflow run not found.')); end if;
  return jsonb_build_object(
    'ok',true,'runId',v_run.id,'workflow',v_run.workflow_name,'version',v_run.workflow_version,'status',v_run.status,
    'result',v_run.result,'error',v_run.error,'createdAt',v_run.created_at,'startedAt',v_run.started_at,'completedAt',v_run.completed_at,
    'timing',jsonb_build_object(
      'queueMs',case when v_run.started_at is null then null else round(extract(epoch from(v_run.started_at-v_run.created_at))*1000) end,
      'totalMs',case when v_run.completed_at is null then null else round(extract(epoch from(v_run.completed_at-v_run.created_at))*1000) end
    )
  );
end $$;

create or replace function public.opera_await_workflow(p_run_id uuid,p_timeout_ms integer default 65000) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_deadline timestamptz; v_run public.opera_workflow_runs%rowtype; v_wait integer;
begin
  v_wait:=least(greatest(coalesce(p_timeout_ms,65000),100),120000);
  v_deadline:=clock_timestamp()+make_interval(secs=>v_wait/1000.0);
  loop
    select * into v_run from public.opera_workflow_runs where id=p_run_id;
    if not found then return jsonb_build_object('ok',false,'error',jsonb_build_object('code','RUN_NOT_FOUND','message','Workflow run not found.')); end if;
    if v_run.status='completed' then return public.opera_get_workflow_run(p_run_id);
    elsif v_run.status in ('failed','expired','cancelled') then return public.opera_get_workflow_run(p_run_id); end if;
    if clock_timestamp()>=v_deadline then
      return jsonb_build_object('ok',false,'runId',v_run.id,'status',v_run.status,'error',jsonb_build_object('code','AWAIT_TIMEOUT','message','Timed out waiting for workflow run.'));
    end if;
    perform pg_sleep(0.1);
  end loop;
end $$;

revoke all on function public.opera_start_workflow(text,jsonb,integer,text) from public,anon,authenticated;
revoke all on function public.opera_get_workflow_run(uuid) from public,anon,authenticated;
revoke all on function public.opera_await_workflow(uuid,integer) from public,anon,authenticated;
grant execute on function public.opera_start_workflow(text,jsonb,integer,text) to service_role;
grant execute on function public.opera_get_workflow_run(uuid) to service_role;
grant execute on function public.opera_await_workflow(uuid,integer) to service_role;
