-- Checkpoint 7E hardening after contract review. Historical additive migration remains unchanged.

alter table opera_agent_private.vm_runs
  drop constraint if exists vm_runs_result_shape;
alter table opera_agent_private.vm_runs
  add constraint vm_runs_result_shape check (
    (result_token is null and result_digest is null and result_bytes is null)
    or (result_token is not null and result_digest is not null and result_bytes is not null
        and left(result_token, 6) = 'oavm1.' and octet_length(result_token) <= 196608
        and result_digest ~ '^sha256:[0-9a-f]{64}$' and result_bytes between 0 and 131072)
  );

create or replace function public.opera_vm_get(p_tenant_id uuid, p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, opera_agent_private
as $$
declare
  v_run opera_agent_private.vm_runs%rowtype;
begin
  select * into v_run
    from opera_agent_private.vm_runs
   where tenant_id = p_tenant_id and run_id = p_run_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'RUN_NOT_FOUND', 'error', 'VM run was not found.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'runId', v_run.run_id,
    'requestId', v_run.request_id,
    'programDigest', v_run.program_digest,
    'goalId', v_run.goal_id,
    'goalRevision', v_run.goal_revision,
    'targetDigest', v_run.target_digest,
    'status', v_run.status,
    'checkpointDigest', v_run.checkpoint_digest,
    'checkpointBytes', v_run.checkpoint_bytes,
    'resultToken', v_run.result_token,
    'resultDigest', v_run.result_digest,
    'resultBytes', v_run.result_bytes,
    'logicalTransition', v_run.logical_transition,
    'leaseEpoch', v_run.lease_epoch,
    'cancelRequested', v_run.cancel_requested,
    'availableAt', v_run.available_at,
    'leaseExpiresAt', v_run.lease_expires_at,
    'errorCode', v_run.error_code,
    'createdAt', v_run.created_at,
    'updatedAt', v_run.updated_at,
    'expiresAt', v_run.expires_at
  );
end
$$;

create or replace function public.opera_vm_claim(
  p_tenant_id uuid,
  p_run_id uuid,
  p_worker_id uuid,
  p_lease_ms integer default 25000
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, opera_agent_private
as $$
declare
  v_enabled boolean;
  v_now timestamptz := clock_timestamp();
  v_running integer;
  v_run opera_agent_private.vm_runs%rowtype;
begin
  select coalesce(value = 'true', false)
    into v_enabled
    from public.loa_v3_config
   where key = 'milestone7_vm_enabled';
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('ok', false, 'code', 'FEATURE_DISABLED', 'error', 'Checkpoint 7E VM host is disabled.');
  end if;
  if p_lease_ms < 5000 or p_lease_ms > 30000 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_LEASE', 'error', 'Lease duration is outside the accepted bound.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 7));

  update opera_agent_private.vm_runs
     set status = 'EXPIRED', lease_owner = null, lease_expires_at = null, available_at = null,
         updated_at = v_now, error_code = coalesce(error_code, 'RUN_DEADLINE')
   where tenant_id = p_tenant_id
     and status in ('QUEUED','RUNNING')
     and expires_at <= v_now;

  update opera_agent_private.vm_runs
     set status = 'CANCELLED', lease_owner = null, lease_expires_at = null, available_at = null,
         updated_at = v_now, error_code = 'CANCELLED'
   where tenant_id = p_tenant_id
     and status = 'RUNNING'
     and lease_expires_at <= v_now
     and expires_at > v_now
     and cancel_requested = true;

  update opera_agent_private.vm_runs
     set status = 'QUEUED', lease_owner = null, lease_expires_at = null, available_at = v_now,
         updated_at = v_now
   where tenant_id = p_tenant_id
     and status = 'RUNNING'
     and lease_expires_at <= v_now
     and expires_at > v_now
     and cancel_requested = false;

  update opera_agent_private.vm_runs
     set status = 'CANCELLED', lease_owner = null, lease_expires_at = null, available_at = null,
         updated_at = v_now, error_code = 'CANCELLED'
   where tenant_id = p_tenant_id
     and status = 'QUEUED'
     and cancel_requested = true;

  select count(*) into v_running
    from opera_agent_private.vm_runs
   where tenant_id = p_tenant_id
     and status = 'RUNNING'
     and lease_expires_at > v_now;
  if v_running >= 4 then
    return jsonb_build_object('ok', false, 'code', 'TENANT_CONCURRENCY', 'error', 'Tenant VM concurrency limit reached.');
  end if;

  select * into v_run
    from opera_agent_private.vm_runs
   where tenant_id = p_tenant_id
     and run_id = p_run_id
     and status = 'QUEUED'
     and cancel_requested = false
     and expires_at > v_now
     and available_at <= v_now
   order by created_at
   for update skip locked
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NO_WORK', 'error', 'VM run is not claimable.');
  end if;

  update opera_agent_private.vm_runs
     set status = 'RUNNING',
         lease_owner = p_worker_id,
         lease_epoch = lease_epoch + 1,
         lease_expires_at = v_now + make_interval(secs => p_lease_ms / 1000.0),
         available_at = null,
         updated_at = v_now
   where tenant_id = p_tenant_id and run_id = p_run_id
   returning * into v_run;

  return jsonb_build_object(
    'ok', true,
    'runId', v_run.run_id,
    'requestId', v_run.request_id,
    'programDigest', v_run.program_digest,
    'goalId', v_run.goal_id,
    'goalRevision', v_run.goal_revision,
    'targetDigest', v_run.target_digest,
    'programToken', v_run.program_token,
    'programBytes', v_run.program_bytes,
    'checkpointToken', v_run.checkpoint_token,
    'checkpointDigest', v_run.checkpoint_digest,
    'checkpointBytes', v_run.checkpoint_bytes,
    'logicalTransition', v_run.logical_transition,
    'leaseEpoch', v_run.lease_epoch,
    'leaseExpiresAt', v_run.lease_expires_at,
    'expiresAt', v_run.expires_at,
    'cancelRequested', v_run.cancel_requested
  );
end
$$;

revoke all on function public.opera_vm_get(uuid,uuid) from public, anon, authenticated;
revoke all on function public.opera_vm_claim(uuid,uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.opera_vm_get(uuid,uuid) to service_role;
grant execute on function public.opera_vm_claim(uuid,uuid,uuid,integer) to service_role;
