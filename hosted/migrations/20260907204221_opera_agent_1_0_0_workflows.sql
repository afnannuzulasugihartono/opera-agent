
create or replace function public.opera_resolve_json(p_value jsonb, p_context jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_type text;
  v_key text;
  v_item jsonb;
  v_out jsonb;
  v_text text := '';
  v_resolved jsonb;
  v_path text;
begin
  if p_value is null then return 'null'::jsonb; end if;
  v_type := jsonb_typeof(p_value);
  if v_type='object' and p_value ? '$ref' then
    v_path := p_value->>'$ref';
    if coalesce(v_path,'')='' then return 'null'::jsonb; end if;
    return coalesce(p_context #> string_to_array(v_path,'.'),'null'::jsonb);
  elsif v_type='object' and p_value ? '$concat' then
    for v_item in select value from jsonb_array_elements(p_value->'$concat') loop
      v_resolved := public.opera_resolve_json(v_item,p_context);
      if jsonb_typeof(v_resolved)='string' then v_text := v_text || (v_resolved #>> '{}');
      elsif v_resolved <> 'null'::jsonb then v_text := v_text || v_resolved::text;
      end if;
    end loop;
    return to_jsonb(v_text);
  elsif v_type='object' then
    v_out := '{}'::jsonb;
    for v_key,v_item in select key,value from jsonb_each(p_value) loop
      v_out := v_out || jsonb_build_object(v_key, public.opera_resolve_json(v_item,p_context));
    end loop;
    return v_out;
  elsif v_type='array' then
    select coalesce(jsonb_agg(public.opera_resolve_json(value,p_context)),'[]'::jsonb) into v_out from jsonb_array_elements(p_value);
    return v_out;
  end if;
  return p_value;
end;
$$;

create or replace function public.opera_eval_condition(p_condition jsonb, p_context jsonb)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_left jsonb;
  v_right jsonb;
  v_op text;
  v_text text;
begin
  v_left := public.opera_resolve_json(coalesce(p_condition->'left','null'::jsonb),p_context);
  v_right := public.opera_resolve_json(coalesce(p_condition->'right','null'::jsonb),p_context);
  v_op := coalesce(p_condition->>'op','truthy');
  if v_op='exists' then return v_left is not null and v_left <> 'null'::jsonb;
  elsif v_op='not_exists' then return v_left is null or v_left = 'null'::jsonb;
  elsif v_op='eq' then return v_left = v_right;
  elsif v_op='ne' then return v_left <> v_right;
  elsif v_op='contains' then return coalesce(v_left #>> '{}',v_left::text,'') like '%' || coalesce(v_right #>> '{}',v_right::text,'') || '%';
  elsif v_op='truthy' then
    if v_left is null or v_left='null'::jsonb or v_left='false'::jsonb or v_left='0'::jsonb or v_left='""'::jsonb or v_left='[]'::jsonb or v_left='{}'::jsonb then return false; end if;
    return true;
  elsif v_op='falsey' then
    return not public.opera_eval_condition(jsonb_build_object('left',p_condition->'left','op','truthy'),p_context);
  end if;
  return false;
end;
$$;

create or replace function public.opera_validate_steps(p_steps jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_step jsonb;
  v_type text;
  v_method text;
  v_res jsonb;
begin
  if jsonb_typeof(p_steps) <> 'array' then return jsonb_build_object('ok',false,'error','steps must be an array'); end if;
  for v_step in select value from jsonb_array_elements(p_steps) loop
    v_type := coalesce(v_step->>'type','command');
    if v_type='command' then
      v_method := v_step->>'method';
      if not exists(select 1 from public.opera_methods where method=v_method and enabled=true) then
        return jsonb_build_object('ok',false,'error','Workflow references a non-allowlisted method: '||coalesce(v_method,'<null>'));
      end if;
    elsif v_type='if' then
      v_res := public.opera_validate_steps(coalesce(v_step->'then','[]'::jsonb)); if coalesce((v_res->>'ok')::boolean,false)=false then return v_res; end if;
      v_res := public.opera_validate_steps(coalesce(v_step->'else','[]'::jsonb)); if coalesce((v_res->>'ok')::boolean,false)=false then return v_res; end if;
    elsif v_type in ('repeat','foreach') then
      v_res := public.opera_validate_steps(coalesce(v_step->'steps','[]'::jsonb)); if coalesce((v_res->>'ok')::boolean,false)=false then return v_res; end if;
    elsif v_type not in ('set','wait','fail') then
      return jsonb_build_object('ok',false,'error','Unsupported workflow step type: '||v_type);
    end if;
  end loop;
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.opera_register_workflow(
  p_name text,
  p_definition jsonb,
  p_description text default '',
  p_enabled boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.opera_workflows%rowtype;
  v_version integer;
  v_valid jsonb;
begin
  if p_name !~ '^[a-z0-9][a-z0-9._-]{1,127}$' then return jsonb_build_object('ok',false,'error','Invalid workflow name.'); end if;
  if jsonb_typeof(p_definition) <> 'object' or jsonb_typeof(p_definition->'steps') <> 'array' then return jsonb_build_object('ok',false,'error','Workflow definition must contain a steps array.'); end if;
  v_valid := public.opera_validate_steps(p_definition->'steps');
  if coalesce((v_valid->>'ok')::boolean,false)=false then return v_valid; end if;
  select * into v_current from public.opera_workflows where name=p_name for update;
  if found then v_version := v_current.version + 1; else v_version := 1; end if;
  insert into public.opera_workflow_versions(name,version,description,definition)
  values(p_name,v_version,left(coalesce(p_description,''),2000),p_definition);
  insert into public.opera_workflows(name,version,enabled,description,definition,updated_at)
  values(p_name,v_version,coalesce(p_enabled,true),left(coalesce(p_description,''),2000),p_definition,now())
  on conflict(name) do update set version=excluded.version,enabled=excluded.enabled,description=excluded.description,definition=excluded.definition,updated_at=now();
  insert into public.opera_audit(event_type,workflow_name,details)
  values('workflow.registered',p_name,jsonb_build_object('version',v_version,'enabled',p_enabled));
  return jsonb_build_object('ok',true,'name',p_name,'version',v_version,'enabled',p_enabled);
end;
$$;

create or replace function public.opera_rollback_workflow(p_name text, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.opera_workflow_versions%rowtype;
begin
  select * into v_old from public.opera_workflow_versions where name=p_name and version=p_version;
  if not found then return jsonb_build_object('ok',false,'error','Workflow version not found.'); end if;
  return public.opera_register_workflow(p_name,v_old.definition,'Rollback to version '||p_version,true);
end;
$$;

create or replace function public.opera_execute_steps(
  p_steps jsonb,
  p_context jsonb,
  p_deadline timestamptz,
  p_device_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx jsonb := coalesce(p_context,'{}'::jsonb);
  v_step jsonb;
  v_type text;
  v_id text;
  v_method text;
  v_params jsonb;
  v_result jsonb;
  v_branch jsonb;
  v_remaining integer;
  v_ms integer;
  v_i integer;
  v_max integer;
  v_items jsonb;
  v_item jsonb;
  v_collect jsonb := '[]'::jsonb;
  v_collect_value jsonb;
  v_var text;
  v_collect_var text;
begin
  for v_step in select value from jsonb_array_elements(coalesce(p_steps,'[]'::jsonb)) loop
    if coalesce((v_ctx->>'_halt')::boolean,false) then return v_ctx; end if;
    if clock_timestamp() >= p_deadline then
      return v_ctx || jsonb_build_object('_halt',true,'_error',jsonb_build_object('code','WORKFLOW_TIMEOUT','message','Workflow deadline exceeded.'));
    end if;
    v_type := coalesce(v_step->>'type','command');
    v_id := coalesce(v_step->>'id','step');

    if v_type='command' then
      v_method := v_step->>'method';
      v_params := public.opera_resolve_json(coalesce(v_step->'params','{}'::jsonb),v_ctx);
      v_remaining := greatest(500,least(55000,round(extract(epoch from (p_deadline-clock_timestamp()))*1000)::integer));
      v_ms := least(v_remaining,least(greatest(coalesce((v_step->>'timeoutMs')::integer,v_remaining),500),55000));
      v_result := public.opera_run(v_method,v_params,v_ms,p_device_name,coalesce(v_step->>'requestId',null));
      v_ctx := jsonb_set(v_ctx,array['steps',v_id],coalesce(v_result,'null'::jsonb),true);
      if coalesce((v_result->>'ok')::boolean,false)=false and not coalesce((v_step->>'continueOnError')::boolean,false) then
        return v_ctx || jsonb_build_object('_halt',true,'_error',coalesce(v_result->'error',jsonb_build_object('code','COMMAND_FAILED','message','Workflow command failed.')));
      end if;

    elsif v_type='set' then
      v_var := v_step->>'name';
      if coalesce(v_var,'')='' then return v_ctx || jsonb_build_object('_halt',true,'_error',jsonb_build_object('code','INVALID_WORKFLOW','message','set step requires name.')); end if;
      v_ctx := jsonb_set(v_ctx,array['vars',v_var],public.opera_resolve_json(v_step->'value',v_ctx),true);

    elsif v_type='wait' then
      v_ms := least(greatest(coalesce((v_step->>'ms')::integer,100),0),5000);
      if v_ms > 0 then perform pg_sleep(v_ms/1000.0); end if;

    elsif v_type='fail' then
      return v_ctx || jsonb_build_object('_halt',true,'_error',jsonb_build_object('code',coalesce(v_step->>'code','WORKFLOW_FAILED'),'message',coalesce(v_step->>'message','Workflow failed.')));

    elsif v_type='if' then
      if public.opera_eval_condition(coalesce(v_step->'condition','{}'::jsonb),v_ctx) then v_branch := coalesce(v_step->'then','[]'::jsonb); else v_branch := coalesce(v_step->'else','[]'::jsonb); end if;
      v_ctx := public.opera_execute_steps(v_branch,v_ctx,p_deadline,p_device_name);

    elsif v_type='repeat' then
      v_max := least(greatest(coalesce((v_step->>'maxIterations')::integer,5),1),30);
      for v_i in 1..v_max loop
        v_ctx := public.opera_execute_steps(coalesce(v_step->'steps','[]'::jsonb),v_ctx,p_deadline,p_device_name);
        exit when coalesce((v_ctx->>'_halt')::boolean,false);
        if public.opera_eval_condition(coalesce(v_step->'until','{}'::jsonb),v_ctx) then exit; end if;
      end loop;
      if not coalesce((v_ctx->>'_halt')::boolean,false)
         and not public.opera_eval_condition(coalesce(v_step->'until','{}'::jsonb),v_ctx)
         and coalesce((v_step->>'failOnLimit')::boolean,true) then
        return v_ctx || jsonb_build_object('_halt',true,'_error',jsonb_build_object('code','REPEAT_LIMIT','message','Repeat condition was not satisfied.'));
      end if;

    elsif v_type='foreach' then
      v_items := public.opera_resolve_json(coalesce(v_step->'items','[]'::jsonb),v_ctx);
      if jsonb_typeof(v_items) <> 'array' then return v_ctx || jsonb_build_object('_halt',true,'_error',jsonb_build_object('code','INVALID_WORKFLOW','message','foreach items must resolve to an array.')); end if;
      v_var := coalesce(v_step->>'itemVar','item');
      v_collect_var := v_step->>'collectVar';
      v_collect := '[]'::jsonb;
      v_max := least(greatest(coalesce((v_step->>'maxItems')::integer,20),1),30);
      v_i := 0;
      for v_item in select value from jsonb_array_elements(v_items) loop
        exit when v_i >= v_max;
        v_ctx := jsonb_set(v_ctx,array['vars',v_var],v_item,true);
        v_ctx := jsonb_set(v_ctx,array['vars','index'],to_jsonb(v_i),true);
        v_ctx := public.opera_execute_steps(coalesce(v_step->'steps','[]'::jsonb),v_ctx,p_deadline,p_device_name);
        exit when coalesce((v_ctx->>'_halt')::boolean,false);
        if v_collect_var is not null and v_step ? 'collect' then
          v_collect_value := public.opera_resolve_json(v_step->'collect',v_ctx);
          v_collect := v_collect || jsonb_build_array(v_collect_value);
        end if;
        v_i := v_i + 1;
      end loop;
      if v_collect_var is not null then v_ctx := jsonb_set(v_ctx,array['vars',v_collect_var],v_collect,true); end if;
    end if;
  end loop;
  return v_ctx;
end;
$$;

create or replace function public.opera_run_workflow(
  p_name text,
  p_input jsonb default '{}'::jsonb,
  p_timeout_ms integer default 45000,
  p_device_name text default 'opera'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wf public.opera_workflows%rowtype;
  v_deadline timestamptz;
  v_ctx jsonb;
  v_output jsonb;
  v_timeout integer;
begin
  select * into v_wf from public.opera_workflows where name=p_name and enabled=true;
  if not found then return jsonb_build_object('ok',false,'error',jsonb_build_object('code','WORKFLOW_NOT_FOUND','message','Workflow not found or disabled.')); end if;
  v_timeout := least(greatest(coalesce(p_timeout_ms,45000),500),55000);
  v_deadline := clock_timestamp()+make_interval(secs=>v_timeout/1000.0);
  v_ctx := jsonb_build_object('input',coalesce(p_input,'{}'::jsonb),'vars','{}'::jsonb,'steps','{}'::jsonb);
  v_ctx := public.opera_execute_steps(v_wf.definition->'steps',v_ctx,v_deadline,p_device_name);
  insert into public.opera_audit(event_type,workflow_name,details)
  values('workflow.executed',p_name,jsonb_build_object('version',v_wf.version,'ok',not coalesce((v_ctx->>'_halt')::boolean,false)));
  if coalesce((v_ctx->>'_halt')::boolean,false) then
    return jsonb_build_object('ok',false,'workflow',p_name,'version',v_wf.version,'error',v_ctx->'_error','context',v_ctx-'_halt'-'_error');
  end if;
  if v_wf.definition ? 'output' then v_output := public.opera_resolve_json(v_wf.definition->'output',v_ctx); else v_output := v_ctx; end if;
  return jsonb_build_object('ok',true,'workflow',p_name,'version',v_wf.version,'result',v_output);
end;
$$;

revoke all on function public.opera_register_workflow(text,jsonb,text,boolean) from public, anon, authenticated;
revoke all on function public.opera_rollback_workflow(text,integer) from public, anon, authenticated;
revoke all on function public.opera_run_workflow(text,jsonb,integer,text) from public, anon, authenticated;
