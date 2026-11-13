
alter table public.opera_workflows add column if not exists ephemeral boolean not null default false;
alter table public.opera_workflows add column if not exists lease_until timestamptz;
alter table public.opera_workflows add column if not exists request_id text;
create unique index if not exists opera_workflows_request_id_uidx on public.opera_workflows(request_id) where request_id is not null;
create index if not exists opera_workflows_ephemeral_lease_idx on public.opera_workflows(ephemeral, lease_until) where ephemeral = true;

create or replace function public.opera_register_ephemeral_workflow(
  p_request_id text,
  p_definition jsonb,
  p_description text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.opera_workflows%rowtype;
  v_active integer;
  v_valid jsonb;
  v_name text;
  v_lease timestamptz;
  v_attempt integer;
begin
  perform public.opera_sweep_ephemeral_workflows();
  if p_definition is null then return jsonb_build_object('ok',false,'error','Workflow definition must contain a steps array.'); end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{1,100}$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_REQUEST');
  end if;
  select * into v_existing from public.opera_workflows where request_id = p_request_id;
  if found then

    if v_existing.definition is distinct from p_definition then
      return jsonb_build_object('ok', false, 'error', 'REQUEST_ID_CONFLICT');
    end if;
    return jsonb_build_object('ok', true, 'name', v_existing.name, 'version', v_existing.version, 'lease_until', v_existing.lease_until);
  end if;
  select count(*) into v_active from public.opera_workflows where ephemeral = true and lease_until > now();
  if v_active >= 100 then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;
  if jsonb_typeof(p_definition) <> 'object' or jsonb_typeof(p_definition->'steps') <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'Workflow definition must contain a steps array.');
  end if;
  v_valid := public.opera_validate_steps(p_definition->'steps');
  if coalesce((v_valid->>'ok')::boolean, false) = false then
    return v_valid;
  end if;
  v_lease := now() + interval '60 minutes';
  for v_attempt in 1..3 loop
    v_name := 'adhoc.' || substring(extensions.gen_random_uuid()::text, 1, 8);
    begin
      insert into public.opera_workflows(name, version, enabled, description, definition, ephemeral, lease_until, request_id, updated_at)
      values (v_name, 1, true, left(coalesce(p_description, ''), 2000), p_definition, true, v_lease, p_request_id, now());
      exit;
    exception when unique_violation then
      select * into v_existing from public.opera_workflows where request_id = p_request_id;
      if found then
        if v_existing.definition is distinct from p_definition then
          return jsonb_build_object('ok', false, 'error', 'REQUEST_ID_CONFLICT');
        end if;
        return jsonb_build_object('ok', true, 'name', v_existing.name, 'version', v_existing.version, 'lease_until', v_existing.lease_until);
      end if;
      if v_attempt = 3 then
        return jsonb_build_object('ok', false, 'error', 'NAME_COLLISION');
      end if;
    end;
  end loop;
  insert into public.opera_audit(event_type, workflow_name, details)
  values ('workflow.ephemeral_registered', v_name, jsonb_build_object('request_id', p_request_id, 'lease_until', v_lease));
  return jsonb_build_object('ok', true, 'name', v_name, 'version', 1, 'lease_until', v_lease);
end;
$$;

revoke all on function public.opera_register_ephemeral_workflow(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.opera_register_ephemeral_workflow(text, jsonb, text) to service_role;

create or replace function public.opera_delete_workflow(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  if left(coalesce(p_name, ''), 6) <> 'adhoc.' then
    return jsonb_build_object('ok', false, 'error', 'PERMANENT_DELETE_REFUSED');
  end if;
  delete from public.opera_workflows where name = p_name;
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'deleted', (v_deleted > 0));
end;
$$;

revoke all on function public.opera_delete_workflow(text) from public, anon, authenticated;
grant execute on function public.opera_delete_workflow(text) to service_role;

create or replace function public.opera_sweep_ephemeral_workflows()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_swept integer := 0;
begin
  delete from public.opera_workflows where ephemeral = true and lease_until < now();
  get diagnostics v_swept = row_count;
  return jsonb_build_object('ok', true, 'swept', v_swept);
end;
$$;

revoke all on function public.opera_sweep_ephemeral_workflows() from public, anon, authenticated;
grant execute on function public.opera_sweep_ephemeral_workflows() to service_role;
