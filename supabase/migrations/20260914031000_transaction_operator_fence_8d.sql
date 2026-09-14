-- Checkpoint 8D review candidate only. NOT DEPLOYED by this commit.
-- Adds a service-only singleton lease epoch used to fence every trusted operator
-- mutation across process death/recovery. No browser dispatch or agent authority.
begin;

create table opera_agent_tx_candidate.operator_control (
  singleton boolean primary key default true check (singleton),
  epoch bigint not null default 0 check (epoch >= 0),
  owner_id text check (owner_id is null or owner_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  namespace uuid,
  lease_until timestamptz,
  host_enabled boolean not null default false,
  check ((owner_id is null) = (namespace is null)),
  check ((owner_id is null) = (lease_until is null)),
  check (owner_id is not null or not host_enabled)
);
insert into opera_agent_tx_candidate.operator_control(singleton) values (true);
alter table opera_agent_tx_candidate.operator_control enable row level security;
revoke all on opera_agent_tx_candidate.operator_control from public, anon, authenticated;

create function public.opera_tx_operator_acquire_8d(p_owner text,p_namespace uuid,p_ttl_ms integer)
returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare v_epoch bigint; v_owner text; v_lease timestamptz;
begin
  if p_owner is null or p_owner !~ '^[A-Za-z0-9_-]{8,128}$'
    or p_namespace is null or p_ttl_ms < 10000 or p_ttl_ms > 300000 then
    raise exception 'INVALID_SERVER_FENCE_REQUEST';
  end if;
  select epoch,owner_id,lease_until into v_epoch,v_owner,v_lease
    from opera_agent_tx_candidate.operator_control where singleton=true for update;
  if not found then raise exception 'SERVER_FENCE_STATE_INVALID'; end if;
  if v_owner is not null and v_lease > clock_timestamp() then raise exception 'SERVER_FENCE_BUSY'; end if;
  update opera_agent_tx_candidate.operator_control
    set epoch=epoch+1,owner_id=p_owner,namespace=p_namespace,
        lease_until=clock_timestamp()+(p_ttl_ms*interval '1 millisecond'),host_enabled=false
    where singleton=true returning epoch into v_epoch;
  return v_epoch;
end $$;

create function public.opera_tx_operator_heartbeat_8d(p_owner text,p_namespace uuid,p_epoch bigint,p_ttl_ms integer)
returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare v_epoch bigint;
begin
  if p_ttl_ms < 10000 or p_ttl_ms > 300000 then raise exception 'INVALID_SERVER_FENCE_REQUEST'; end if;
  update opera_agent_tx_candidate.operator_control
    set lease_until=clock_timestamp()+(p_ttl_ms*interval '1 millisecond')
    where singleton=true and owner_id=p_owner and namespace=p_namespace and epoch=p_epoch
      and lease_until>clock_timestamp()
    returning epoch into v_epoch;
  if not found then raise exception 'SERVER_FENCE_LOST'; end if;
  return v_epoch;
end $$;

create function public.opera_tx_operator_assert_8d(p_owner text,p_namespace uuid,p_epoch bigint)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform 1 from opera_agent_tx_candidate.operator_control
    where singleton=true and owner_id=p_owner and namespace=p_namespace and epoch=p_epoch
      and lease_until>clock_timestamp()
    for share;
  if not found then raise exception 'SERVER_FENCE_LOST'; end if;
end $$;

create function public.opera_tx_operator_set_host_8d(p_owner text,p_namespace uuid,p_epoch bigint,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_enabled boolean;
begin
  update opera_agent_tx_candidate.operator_control set host_enabled=p_enabled
    where singleton=true and owner_id=p_owner and namespace=p_namespace and epoch=p_epoch
      and lease_until>clock_timestamp()
    returning host_enabled into v_enabled;
  if not found then raise exception 'SERVER_FENCE_LOST'; end if;
  return v_enabled;
end $$;

create function public.opera_tx_operator_cleanup_fixture_8d(
  p_owner text,p_namespace uuid,p_epoch bigint,p_actor text,p_goal text,p_transaction text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_host boolean; v_mode text; v_legacy boolean; v_agent boolean;
begin
  perform public.opera_tx_operator_assert_8d(p_owner,p_namespace,p_epoch);
  select host_enabled into v_host from opera_agent_tx_candidate.operator_control where singleton=true;
  select mode,legacy_gated,agent_commit_enabled into v_mode,v_legacy,v_agent
    from opera_agent_tx_candidate.policy where singleton=true for share;
  if v_host or v_mode<>'OFF' or v_legacy or v_agent then raise exception 'SERVER_FENCE_NOT_CLEAN'; end if;
  delete from opera_agent_tx_candidate.runs
    where tenant_id=p_namespace::text and actor_id=p_actor and transaction_id=p_transaction;
  delete from opera_agent_tx_candidate.rates where tenant_id=p_namespace::text;
  delete from opera_agent_tx_candidate.acceptance_bindings
    where tenant_id=p_namespace::text and actor_id=p_actor and transaction_id=p_transaction;
  delete from opera_agent_private.goal_heads where tenant_id=p_namespace and goal_id=p_goal;
  delete from opera_agent_tx_candidate.principals
    where tenant_id=p_namespace::text and actor_id=p_actor;
  return true;
end $$;

create function public.opera_tx_operator_release_8d(p_owner text,p_namespace uuid,p_epoch bigint)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_host boolean; v_mode text; v_legacy boolean; v_agent boolean;
begin
  select host_enabled into v_host from opera_agent_tx_candidate.operator_control
    where singleton=true and owner_id=p_owner and namespace=p_namespace and epoch=p_epoch
      and lease_until>clock_timestamp()
    for update;
  if not found then raise exception 'SERVER_FENCE_LOST'; end if;
  select mode,legacy_gated,agent_commit_enabled into v_mode,v_legacy,v_agent
    from opera_agent_tx_candidate.policy where singleton=true for share;
  if v_host or v_mode<>'OFF' or v_legacy or v_agent then raise exception 'SERVER_FENCE_NOT_CLEAN'; end if;
  -- This check is inside the exclusive control-row barrier, AFTER waiting for
  -- previously admitted share-lock mutations. Earlier verifyClean is advisory:
  -- a lost-reply insert may commit between that snapshot and this release.
  if exists(select 1 from opera_agent_tx_candidate.principals where tenant_id=p_namespace::text)
    or exists(select 1 from opera_agent_tx_candidate.rates where tenant_id=p_namespace::text)
    or exists(select 1 from opera_agent_tx_candidate.acceptance_bindings where tenant_id=p_namespace::text)
    or exists(select 1 from opera_agent_tx_candidate.runs where tenant_id=p_namespace::text)
    or exists(select 1 from opera_agent_tx_candidate.run_identities where tenant_id=p_namespace::text)
    or exists(select 1 from opera_agent_tx_candidate.run_limits where tenant_id=p_namespace::text)
    or exists(select 1 from opera_agent_tx_candidate.run_previews where tenant_id=p_namespace::text)
    or exists(select 1 from opera_agent_tx_candidate.run_challenges where tenant_id=p_namespace::text)
    or exists(select 1 from opera_agent_tx_candidate.journal where tenant_id=p_namespace::text)
    or exists(select 1 from opera_agent_tx_candidate.approvals where tenant_id=p_namespace::text)
    or exists(select 1 from opera_agent_tx_candidate.commit_slots where tenant_id=p_namespace::text)
    or exists(select 1 from opera_agent_private.goal_heads where tenant_id=p_namespace)
  then raise exception 'SERVER_FENCE_OWNED_ROWS_REMAIN'; end if;
  update opera_agent_tx_candidate.operator_control
    set owner_id=null,namespace=null,lease_until=null,host_enabled=false
    where singleton=true and owner_id=p_owner and namespace=p_namespace and epoch=p_epoch;
  if not found then raise exception 'SERVER_FENCE_LOST'; end if;
  return true;
end $$;

create function public.opera_tx_operator_state_8d()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object(
    'epoch',epoch,'ownerId',owner_id,'namespace',namespace,
    'leaseUntil',lease_until,'hostEnabled',host_enabled)
  from opera_agent_tx_candidate.operator_control where singleton=true
$$;

create function public.opera_tx_operator_host_gate_8d()
returns boolean language sql stable security definer set search_path=pg_catalog as $$
  select coalesce((
    select c.host_enabled and c.owner_id is not null and c.namespace is not null
      and c.lease_until>clock_timestamp()
      and p.mode='DARK' and p.legacy_gated=false and p.agent_commit_enabled=false
    from opera_agent_tx_candidate.operator_control c
    cross join opera_agent_tx_candidate.policy p
    where c.singleton=true and p.singleton=true
  ),false)
$$;

revoke execute on function public.opera_tx_operator_acquire_8d(text,uuid,integer) from public,anon,authenticated;
revoke execute on function public.opera_tx_operator_heartbeat_8d(text,uuid,bigint,integer) from public,anon,authenticated;
revoke execute on function public.opera_tx_operator_assert_8d(text,uuid,bigint) from public,anon,authenticated;
revoke execute on function public.opera_tx_operator_set_host_8d(text,uuid,bigint,boolean) from public,anon,authenticated;
revoke execute on function public.opera_tx_operator_cleanup_fixture_8d(text,uuid,bigint,text,text,text) from public,anon,authenticated;
revoke execute on function public.opera_tx_operator_release_8d(text,uuid,bigint) from public,anon,authenticated;
revoke execute on function public.opera_tx_operator_state_8d() from public,anon,authenticated;
revoke execute on function public.opera_tx_operator_host_gate_8d() from public,anon,authenticated;
grant execute on function public.opera_tx_operator_acquire_8d(text,uuid,integer) to service_role;
grant execute on function public.opera_tx_operator_heartbeat_8d(text,uuid,bigint,integer) to service_role;
grant execute on function public.opera_tx_operator_assert_8d(text,uuid,bigint) to service_role;
grant execute on function public.opera_tx_operator_set_host_8d(text,uuid,bigint,boolean) to service_role;
grant execute on function public.opera_tx_operator_cleanup_fixture_8d(text,uuid,bigint,text,text,text) to service_role;
grant execute on function public.opera_tx_operator_release_8d(text,uuid,bigint) to service_role;
grant execute on function public.opera_tx_operator_state_8d() to service_role;
grant execute on function public.opera_tx_operator_host_gate_8d() to service_role;

commit;
