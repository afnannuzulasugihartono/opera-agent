-- Checkpoint 7E: durable Reactive Browser VM host.
-- Additive/private only. No extension, pairing, MCP, protocol, capability, or browser-method change.

create schema if not exists opera_agent_private;
revoke all on schema opera_agent_private from public, anon, authenticated;
grant usage on schema opera_agent_private to service_role;

insert into public.loa_v3_config (key, value)
values ('milestone7_vm_enabled', 'false')
on conflict (key) do nothing;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'opera_agent_vm_host_v1') then
    perform vault.create_secret(
      rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '='),
      'opera_agent_vm_host_v1',
      'AES-256-GCM key for opaque Opera Agent Reactive VM host payloads'
    );
  end if;
end
$$;

create table if not exists opera_agent_private.vm_runs (
  tenant_id uuid not null,
  run_id uuid not null,
  request_id text not null,
  program_digest text not null,
  goal_id text not null,
  goal_revision integer not null,
  target_digest text not null,
  status text not null default 'QUEUED',
  program_token text not null,
  program_bytes integer not null,
  checkpoint_token text not null,
  checkpoint_digest text not null,
  checkpoint_bytes integer not null,
  result_token text,
  result_digest text,
  result_bytes integer,
  logical_transition bigint not null default 0,
  lease_owner uuid,
  lease_epoch bigint not null default 0,
  lease_expires_at timestamptz,
  available_at timestamptz,
  cancel_requested boolean not null default false,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  primary key (tenant_id, run_id),
  unique (tenant_id, request_id),
  constraint vm_runs_request_id check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  constraint vm_runs_program_digest check (program_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint vm_runs_goal_id check (goal_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  constraint vm_runs_goal_revision check (goal_revision between 1 and 2147483647),
  constraint vm_runs_target_digest check (target_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint vm_runs_status check (status in ('QUEUED','RUNNING','SUSPENDED','RETURNED','LIMIT_REACHED','FAILED','CANCELLED','EXPIRED')),
  constraint vm_runs_program_token check (left(program_token, 6) = 'oavm1.' and octet_length(program_token) <= 196608),
  constraint vm_runs_program_bytes check (program_bytes between 1 and 131072),
  constraint vm_runs_checkpoint_token check (left(checkpoint_token, 6) = 'oavm1.' and octet_length(checkpoint_token) <= 196608),
  constraint vm_runs_checkpoint_digest check (checkpoint_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint vm_runs_checkpoint_bytes check (checkpoint_bytes between 1 and 131072),
  constraint vm_runs_result_shape check (
    (result_token is null and result_digest is null and result_bytes is null)
    or (left(result_token, 6) = 'oavm1.' and octet_length(result_token) <= 196608
        and result_digest ~ '^sha256:[0-9a-f]{64}$' and result_bytes between 0 and 131072)
  ),
  constraint vm_runs_transition_bound check (logical_transition between 0 and 2147483647),
  constraint vm_runs_lease_epoch_bound check (lease_epoch between 0 and 2147483647),
  constraint vm_runs_lease_shape check (
    (status = 'RUNNING' and lease_owner is not null and lease_expires_at is not null)
    or (status <> 'RUNNING' and lease_owner is null and lease_expires_at is null)
  ),
  constraint vm_runs_available_shape check (
    (status = 'QUEUED' and available_at is not null)
    or (status <> 'QUEUED' and available_at is null)
  ),
  constraint vm_runs_error_code check (error_code is null or char_length(error_code) between 1 and 128),
  constraint vm_runs_time_order check (updated_at >= created_at),
  constraint vm_runs_expiry check (expires_at > created_at and expires_at <= created_at + interval '5 minutes')
);

create index if not exists vm_runs_claim_idx
  on opera_agent_private.vm_runs (tenant_id, available_at, created_at)
  where status = 'QUEUED';
create index if not exists vm_runs_lease_idx
  on opera_agent_private.vm_runs (tenant_id, lease_expires_at)
  where status = 'RUNNING';
create index if not exists vm_runs_cleanup_idx
  on opera_agent_private.vm_runs (updated_at)
  where status in ('SUSPENDED','RETURNED','LIMIT_REACHED','FAILED','CANCELLED','EXPIRED');

create table if not exists opera_agent_private.vm_effects (
  tenant_id uuid not null,
  run_id uuid not null,
  idempotency_key text not null,
  request_digest text not null,
  method text not null,
  command_id uuid,
  status text not null default 'RESERVED',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, run_id, idempotency_key),
  foreign key (tenant_id, run_id) references opera_agent_private.vm_runs(tenant_id, run_id) on delete cascade,
  constraint vm_effects_key check (idempotency_key ~ '^vm1:[0-9a-f]{64}$'),
  constraint vm_effects_digest check (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint vm_effects_method check (char_length(method) between 1 and 128),
  constraint vm_effects_status check (status in ('RESERVED','ENQUEUED','OBSERVED','FAILED')),
  constraint vm_effects_time_order check (updated_at >= created_at)
);

create index if not exists vm_effects_command_idx
  on opera_agent_private.vm_effects (command_id)
  where command_id is not null;

create table if not exists opera_agent_private.vm_rate_windows (
  tenant_id uuid not null,
  window_start timestamptz not null,
  enqueue_count integer not null default 0,
  primary key (tenant_id, window_start),
  constraint vm_rate_windows_count check (enqueue_count between 0 and 100000)
);

alter table opera_agent_private.vm_runs enable row level security;
alter table opera_agent_private.vm_effects enable row level security;
alter table opera_agent_private.vm_rate_windows enable row level security;
revoke all on table opera_agent_private.vm_runs from public, anon, authenticated;
revoke all on table opera_agent_private.vm_effects from public, anon, authenticated;
revoke all on table opera_agent_private.vm_rate_windows from public, anon, authenticated;
grant select, insert, update, delete on table opera_agent_private.vm_runs to service_role;
grant select, insert, update, delete on table opera_agent_private.vm_effects to service_role;
grant select, insert, update, delete on table opera_agent_private.vm_rate_windows to service_role;

create or replace function public.opera_vm_crypto_key()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  v_enabled boolean;
  v_key text;
begin
  select coalesce(value = 'true', false)
    into v_enabled
    from public.loa_v3_config
   where key = 'milestone7_vm_enabled';
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('enabled', false);
  end if;

  select decrypted_secret
    into v_key
    from vault.decrypted_secrets
   where name = 'opera_agent_vm_host_v1'
   order by created_at desc
   limit 1;
  if v_key is null then
    raise exception using errcode = '55000', message = 'VM host key is unavailable';
  end if;
  return jsonb_build_object('enabled', true, 'key', v_key);
end
$$;

create or replace function public.opera_vm_enqueue(
  p_tenant_id uuid,
  p_run_id uuid,
  p_request_id text,
  p_program_digest text,
  p_goal_id text,
  p_goal_revision integer,
  p_target_digest text,
  p_program_token text,
  p_program_bytes integer,
  p_checkpoint_token text,
  p_checkpoint_digest text,
  p_checkpoint_bytes integer,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, opera_agent_private
as $$
declare
  v_enabled boolean;
  v_now timestamptz := clock_timestamp();
  v_window timestamptz := date_trunc('minute', clock_timestamp());
  v_rate integer;
  v_outstanding integer;
  v_existing opera_agent_private.vm_runs%rowtype;
begin
  select coalesce(value = 'true', false) into v_enabled from public.loa_v3_config where key = 'milestone7_vm_enabled';
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('ok', false, 'code', 'FEATURE_DISABLED', 'error', 'Checkpoint 7E VM host is disabled.');
  end if;

  if p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     or p_program_digest !~ '^sha256:[0-9a-f]{64}$'
     or p_goal_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     or p_goal_revision not between 1 and 2147483647
     or p_target_digest !~ '^sha256:[0-9a-f]{64}$'
     or left(p_program_token, 6) <> 'oavm1.' or octet_length(p_program_token) > 196608
     or p_program_bytes not between 1 and 131072
     or left(p_checkpoint_token, 6) <> 'oavm1.' or octet_length(p_checkpoint_token) > 196608
     or p_checkpoint_digest !~ '^sha256:[0-9a-f]{64}$'
     or p_checkpoint_bytes not between 1 and 131072
     or p_expires_at <= v_now or p_expires_at > v_now + interval '5 minutes 5 seconds' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_RUN', 'error', 'VM run metadata is invalid.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 7));

  insert into opera_agent_private.vm_rate_windows(tenant_id, window_start, enqueue_count)
  values (p_tenant_id, v_window, 1)
  on conflict (tenant_id, window_start)
  do update set enqueue_count = opera_agent_private.vm_rate_windows.enqueue_count + 1
  returning enqueue_count into v_rate;
  if v_rate > 20 then
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'error', 'VM enqueue rate exceeded.');
  end if;

  select * into v_existing
    from opera_agent_private.vm_runs
   where tenant_id = p_tenant_id and request_id = p_request_id
   for update;
  if found then
    if v_existing.program_digest = p_program_digest
       and v_existing.goal_id = p_goal_id
       and v_existing.goal_revision = p_goal_revision
       and v_existing.target_digest = p_target_digest
       and v_existing.checkpoint_digest = p_checkpoint_digest then
      return jsonb_build_object('ok', true, 'replayed', true, 'runId', v_existing.run_id, 'status', v_existing.status);
    end if;
    return jsonb_build_object('ok', false, 'code', 'REQUEST_CONFLICT', 'error', 'requestId is already bound to different VM metadata.');
  end if;

  select count(*) into v_outstanding
    from opera_agent_private.vm_runs
   where tenant_id = p_tenant_id
     and status in ('QUEUED','RUNNING','SUSPENDED')
     and expires_at > v_now;
  if v_outstanding >= 32 then
    return jsonb_build_object('ok', false, 'code', 'QUEUE_FULL', 'error', 'Tenant VM queue is full.');
  end if;

  insert into opera_agent_private.vm_runs(
    tenant_id, run_id, request_id, program_digest, goal_id, goal_revision, target_digest,
    status, program_token, program_bytes, checkpoint_token, checkpoint_digest, checkpoint_bytes,
    logical_transition, lease_epoch, available_at, created_at, updated_at, expires_at
  ) values (
    p_tenant_id, p_run_id, p_request_id, p_program_digest, p_goal_id, p_goal_revision, p_target_digest,
    'QUEUED', p_program_token, p_program_bytes, p_checkpoint_token, p_checkpoint_digest, p_checkpoint_bytes,
    0, 0, v_now, v_now, v_now, p_expires_at
  );
  return jsonb_build_object('ok', true, 'replayed', false, 'runId', p_run_id, 'status', 'QUEUED');
end
$$;

create or replace function public.opera_vm_get(p_tenant_id uuid, p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, opera_agent_private
as $$
declare
  v_run opera_agent_private.vm_runs%rowtype;
begin
  select * into v_run from opera_agent_private.vm_runs where tenant_id = p_tenant_id and run_id = p_run_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'RUN_NOT_FOUND', 'error', 'VM run was not found.');
  end if;
  return jsonb_build_object(
    'ok', true, 'runId', v_run.run_id, 'requestId', v_run.request_id, 'programDigest', v_run.program_digest,
    'goalId', v_run.goal_id, 'goalRevision', v_run.goal_revision, 'targetDigest', v_run.target_digest,
    'status', v_run.status, 'checkpointDigest', v_run.checkpoint_digest, 'checkpointBytes', v_run.checkpoint_bytes,
    'resultDigest', v_run.result_digest, 'resultBytes', v_run.result_bytes,
    'logicalTransition', v_run.logical_transition, 'leaseEpoch', v_run.lease_epoch,
    'cancelRequested', v_run.cancel_requested, 'availableAt', v_run.available_at,
    'leaseExpiresAt', v_run.lease_expires_at, 'errorCode', v_run.error_code,
    'createdAt', v_run.created_at, 'updatedAt', v_run.updated_at, 'expiresAt', v_run.expires_at
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
  select coalesce(value = 'true', false) into v_enabled from public.loa_v3_config where key = 'milestone7_vm_enabled';
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
   where tenant_id = p_tenant_id and status = 'RUNNING' and lease_expires_at > v_now;
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
     set status = 'RUNNING', lease_owner = p_worker_id, lease_epoch = lease_epoch + 1,
         lease_expires_at = v_now + make_interval(secs => p_lease_ms / 1000.0),
         available_at = null, updated_at = v_now
   where tenant_id = p_tenant_id and run_id = p_run_id
   returning * into v_run;

  return jsonb_build_object(
    'ok', true, 'runId', v_run.run_id, 'requestId', v_run.request_id,
    'programDigest', v_run.program_digest, 'goalId', v_run.goal_id, 'goalRevision', v_run.goal_revision,
    'targetDigest', v_run.target_digest, 'programToken', v_run.program_token, 'programBytes', v_run.program_bytes,
    'checkpointToken', v_run.checkpoint_token, 'checkpointDigest', v_run.checkpoint_digest,
    'checkpointBytes', v_run.checkpoint_bytes, 'logicalTransition', v_run.logical_transition,
    'leaseEpoch', v_run.lease_epoch, 'leaseExpiresAt', v_run.lease_expires_at,
    'expiresAt', v_run.expires_at, 'cancelRequested', v_run.cancel_requested
  );
end
$$;

create or replace function public.opera_vm_lease_status(
  p_tenant_id uuid,
  p_run_id uuid,
  p_worker_id uuid,
  p_lease_epoch bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, opera_agent_private
as $$
declare
  v_run opera_agent_private.vm_runs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_run from opera_agent_private.vm_runs where tenant_id = p_tenant_id and run_id = p_run_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'RUN_NOT_FOUND'); end if;
  return jsonb_build_object(
    'ok', true,
    'leaseValid', v_run.status = 'RUNNING' and v_run.lease_owner = p_worker_id
      and v_run.lease_epoch = p_lease_epoch and v_run.lease_expires_at > v_now and v_run.expires_at > v_now,
    'cancelRequested', v_run.cancel_requested,
    'status', v_run.status,
    'logicalTransition', v_run.logical_transition,
    'expiresAt', v_run.expires_at,
    'leaseExpiresAt', v_run.lease_expires_at
  );
end
$$;

create or replace function public.opera_vm_checkpoint(
  p_tenant_id uuid,
  p_run_id uuid,
  p_worker_id uuid,
  p_lease_epoch bigint,
  p_expected_transition bigint,
  p_program_digest text,
  p_goal_revision integer,
  p_target_digest text,
  p_checkpoint_token text,
  p_checkpoint_digest text,
  p_checkpoint_bytes integer,
  p_new_status text,
  p_available_at timestamptz,
  p_result_token text default null,
  p_result_digest text default null,
  p_result_bytes integer default null,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, opera_agent_private
as $$
declare
  v_enabled boolean;
  v_now timestamptz := clock_timestamp();
  v_run opera_agent_private.vm_runs%rowtype;
begin
  select coalesce(value = 'true', false) into v_enabled from public.loa_v3_config where key = 'milestone7_vm_enabled';
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('ok', false, 'code', 'FEATURE_DISABLED', 'error', 'Checkpoint 7E VM host is disabled.');
  end if;

  if p_new_status not in ('QUEUED','SUSPENDED','RETURNED','LIMIT_REACHED','FAILED','CANCELLED','EXPIRED')
     or left(p_checkpoint_token, 6) <> 'oavm1.' or octet_length(p_checkpoint_token) > 196608
     or p_checkpoint_digest !~ '^sha256:[0-9a-f]{64}$'
     or p_checkpoint_bytes not between 1 and 131072
     or (p_new_status = 'QUEUED' and p_available_at is null)
     or (p_new_status <> 'QUEUED' and p_available_at is not null)
     or (p_available_at is not null and p_available_at > v_now + interval '60 seconds')
     or ((p_result_token is null) <> (p_result_digest is null))
     or ((p_result_token is null) <> (p_result_bytes is null))
     or (p_result_token is not null and (left(p_result_token, 6) <> 'oavm1.' or octet_length(p_result_token) > 196608
         or p_result_digest !~ '^sha256:[0-9a-f]{64}$' or p_result_bytes not between 0 and 131072))
     or (p_error_code is not null and char_length(p_error_code) not between 1 and 128) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CHECKPOINT', 'error', 'VM checkpoint metadata is invalid.');
  end if;

  select * into v_run
    from opera_agent_private.vm_runs
   where tenant_id = p_tenant_id and run_id = p_run_id
   for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'RUN_NOT_FOUND', 'error', 'VM run was not found.'); end if;

  if v_run.logical_transition = p_expected_transition + 1
     and v_run.checkpoint_digest = p_checkpoint_digest
     and v_run.status = p_new_status
     and coalesce(v_run.result_digest, '') = coalesce(p_result_digest, '')
     and coalesce(v_run.error_code, '') = coalesce(p_error_code, '') then
    return jsonb_build_object('ok', true, 'replayed', true, 'logicalTransition', v_run.logical_transition, 'status', v_run.status);
  end if;

  if v_run.status <> 'RUNNING' or v_run.lease_owner <> p_worker_id or v_run.lease_epoch <> p_lease_epoch
     or v_run.lease_expires_at <= v_now then
    return jsonb_build_object('ok', false, 'code', 'STALE_LEASE', 'error', 'VM lease no longer authorizes this checkpoint.');
  end if;
  if v_run.expires_at <= v_now then
    return jsonb_build_object('ok', false, 'code', 'RUN_EXPIRED', 'error', 'VM run deadline has expired.');
  end if;
  if v_run.logical_transition <> p_expected_transition
     or v_run.program_digest <> p_program_digest
     or v_run.goal_revision <> p_goal_revision
     or v_run.target_digest <> p_target_digest then
    return jsonb_build_object('ok', false, 'code', 'STALE_RUN', 'error', 'VM checkpoint fence does not match the current run.');
  end if;
  if v_run.cancel_requested and p_new_status <> 'CANCELLED' then
    return jsonb_build_object('ok', false, 'code', 'CANCEL_REQUESTED', 'error', 'VM run cancellation must be checkpointed first.');
  end if;
  if p_available_at is not null and p_available_at >= v_run.expires_at then
    return jsonb_build_object('ok', false, 'code', 'RUN_EXPIRED', 'error', 'VM resume time is outside the run deadline.');
  end if;

  update opera_agent_private.vm_runs
     set status = p_new_status,
         checkpoint_token = p_checkpoint_token,
         checkpoint_digest = p_checkpoint_digest,
         checkpoint_bytes = p_checkpoint_bytes,
         result_token = p_result_token,
         result_digest = p_result_digest,
         result_bytes = p_result_bytes,
         logical_transition = logical_transition + 1,
         lease_owner = null,
         lease_expires_at = null,
         available_at = p_available_at,
         error_code = p_error_code,
         updated_at = v_now
   where tenant_id = p_tenant_id and run_id = p_run_id
   returning * into v_run;
  return jsonb_build_object('ok', true, 'replayed', false, 'logicalTransition', v_run.logical_transition, 'status', v_run.status);
end
$$;

create or replace function public.opera_vm_effect_reserve(
  p_tenant_id uuid,
  p_run_id uuid,
  p_worker_id uuid,
  p_lease_epoch bigint,
  p_expected_transition bigint,
  p_program_digest text,
  p_goal_revision integer,
  p_target_digest text,
  p_idempotency_key text,
  p_request_digest text,
  p_method text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, opera_agent_private
as $$
declare
  v_enabled boolean;
  v_now timestamptz := clock_timestamp();
  v_run opera_agent_private.vm_runs%rowtype;
  v_effect opera_agent_private.vm_effects%rowtype;
begin
  select coalesce(value = 'true', false) into v_enabled from public.loa_v3_config where key = 'milestone7_vm_enabled';
  if not coalesce(v_enabled, false) then return jsonb_build_object('ok', false, 'code', 'FEATURE_DISABLED'); end if;
  if p_idempotency_key !~ '^vm1:[0-9a-f]{64}$' or p_request_digest !~ '^sha256:[0-9a-f]{64}$'
     or p_method not in ('browser.ping','browser.burst','tabs.list','tabs.get','tabs.find','page.read','page.query','page.find','page.collect_links','page.capture','page.wait_for','media.state') then
    return jsonb_build_object('ok', false, 'code', 'DISALLOWED_EFFECT', 'error', 'VM effect is not in the Checkpoint 7A read-only allowlist.');
  end if;

  select * into v_run from opera_agent_private.vm_runs where tenant_id = p_tenant_id and run_id = p_run_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'RUN_NOT_FOUND'); end if;
  if v_run.status <> 'RUNNING' or v_run.lease_owner <> p_worker_id or v_run.lease_epoch <> p_lease_epoch
     or v_run.lease_expires_at <= v_now then return jsonb_build_object('ok', false, 'code', 'STALE_LEASE'); end if;
  if v_run.logical_transition <> p_expected_transition or v_run.program_digest <> p_program_digest
     or v_run.goal_revision <> p_goal_revision or v_run.target_digest <> p_target_digest then
    return jsonb_build_object('ok', false, 'code', 'STALE_RUN');
  end if;

  insert into opera_agent_private.vm_effects(tenant_id, run_id, idempotency_key, request_digest, method, status, created_at, updated_at)
  values (p_tenant_id, p_run_id, p_idempotency_key, p_request_digest, p_method, 'RESERVED', v_now, v_now)
  on conflict (tenant_id, run_id, idempotency_key) do nothing;

  select * into v_effect from opera_agent_private.vm_effects
   where tenant_id = p_tenant_id and run_id = p_run_id and idempotency_key = p_idempotency_key;
  if v_effect.request_digest <> p_request_digest or v_effect.method <> p_method then
    return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_COLLISION', 'error', 'VM idempotency key is bound to another effect.');
  end if;
  return jsonb_build_object('ok', true, 'replayed', v_effect.created_at < v_now, 'status', v_effect.status, 'commandId', v_effect.command_id);
end
$$;

create or replace function public.opera_vm_effect_attach(
  p_tenant_id uuid,
  p_run_id uuid,
  p_worker_id uuid,
  p_lease_epoch bigint,
  p_idempotency_key text,
  p_request_digest text,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, opera_agent_private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_run opera_agent_private.vm_runs%rowtype;
  v_effect opera_agent_private.vm_effects%rowtype;
begin
  select * into v_run from opera_agent_private.vm_runs where tenant_id = p_tenant_id and run_id = p_run_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'RUN_NOT_FOUND'); end if;
  if v_run.status <> 'RUNNING' or v_run.lease_owner <> p_worker_id or v_run.lease_epoch <> p_lease_epoch
     or v_run.lease_expires_at <= v_now then return jsonb_build_object('ok', false, 'code', 'STALE_LEASE'); end if;

  select * into v_effect from opera_agent_private.vm_effects
   where tenant_id = p_tenant_id and run_id = p_run_id and idempotency_key = p_idempotency_key
   for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'EFFECT_NOT_FOUND'); end if;
  if v_effect.request_digest <> p_request_digest then return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_COLLISION'); end if;
  if v_effect.command_id is not null and v_effect.command_id <> p_command_id then return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_COLLISION'); end if;
  if v_effect.command_id = p_command_id then return jsonb_build_object('ok', true, 'replayed', true, 'commandId', p_command_id); end if;

  update opera_agent_private.vm_effects
     set command_id = p_command_id, status = 'ENQUEUED', updated_at = v_now
   where tenant_id = p_tenant_id and run_id = p_run_id and idempotency_key = p_idempotency_key;
  return jsonb_build_object('ok', true, 'replayed', false, 'commandId', p_command_id);
end
$$;

create or replace function public.opera_vm_effect_finish(
  p_tenant_id uuid,
  p_run_id uuid,
  p_worker_id uuid,
  p_lease_epoch bigint,
  p_idempotency_key text,
  p_command_id uuid,
  p_ok boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, opera_agent_private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_run opera_agent_private.vm_runs%rowtype;
  v_effect opera_agent_private.vm_effects%rowtype;
begin
  select * into v_run from opera_agent_private.vm_runs where tenant_id = p_tenant_id and run_id = p_run_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'RUN_NOT_FOUND'); end if;
  if v_run.status <> 'RUNNING' or v_run.lease_owner <> p_worker_id or v_run.lease_epoch <> p_lease_epoch
     or v_run.lease_expires_at <= v_now then return jsonb_build_object('ok', false, 'code', 'STALE_LEASE'); end if;
  select * into v_effect from opera_agent_private.vm_effects
   where tenant_id = p_tenant_id and run_id = p_run_id and idempotency_key = p_idempotency_key
   for update;
  if not found or v_effect.command_id <> p_command_id then return jsonb_build_object('ok', false, 'code', 'EFFECT_NOT_FOUND'); end if;
  update opera_agent_private.vm_effects
     set status = case when p_ok then 'OBSERVED' else 'FAILED' end, updated_at = v_now
   where tenant_id = p_tenant_id and run_id = p_run_id and idempotency_key = p_idempotency_key;
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.opera_vm_cancel(p_tenant_id uuid, p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, opera_agent_private
as $$
declare
  v_run opera_agent_private.vm_runs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_run from opera_agent_private.vm_runs where tenant_id = p_tenant_id and run_id = p_run_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'RUN_NOT_FOUND'); end if;
  if v_run.status in ('RETURNED','LIMIT_REACHED','FAILED','CANCELLED','EXPIRED') then
    return jsonb_build_object('ok', true, 'replayed', true, 'status', v_run.status);
  end if;
  if v_run.status = 'RUNNING' then
    update opera_agent_private.vm_runs set cancel_requested = true, updated_at = v_now where tenant_id = p_tenant_id and run_id = p_run_id;
    return jsonb_build_object('ok', true, 'replayed', false, 'status', 'RUNNING', 'cancelRequested', true);
  end if;
  update opera_agent_private.vm_runs
     set status = 'CANCELLED', cancel_requested = true, available_at = null,
         lease_owner = null, lease_expires_at = null, updated_at = v_now, error_code = 'CANCELLED'
   where tenant_id = p_tenant_id and run_id = p_run_id;
  return jsonb_build_object('ok', true, 'replayed', false, 'status', 'CANCELLED');
end
$$;

create or replace function public.opera_vm_expire(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, opera_agent_private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  if p_limit < 1 or p_limit > 1000 then raise exception using errcode = '22023', message = 'limit must be between 1 and 1000'; end if;
  with expired as (
    select tenant_id, run_id
      from opera_agent_private.vm_runs
     where status in ('QUEUED','RUNNING') and expires_at <= v_now
     order by expires_at
     for update skip locked
     limit p_limit
  )
  update opera_agent_private.vm_runs r
     set status = 'EXPIRED', available_at = null, lease_owner = null, lease_expires_at = null,
         updated_at = v_now, error_code = coalesce(r.error_code, 'RUN_DEADLINE')
    from expired e
   where r.tenant_id = e.tenant_id and r.run_id = e.run_id;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace function public.opera_vm_cleanup(p_retention_seconds integer default 86400)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, opera_agent_private
as $$
declare
  v_runs integer;
  v_rates integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_retention_seconds < 3600 or p_retention_seconds > 604800 then
    raise exception using errcode = '22023', message = 'retention must be between 3600 and 604800 seconds';
  end if;
  delete from opera_agent_private.vm_runs
   where status in ('SUSPENDED','RETURNED','LIMIT_REACHED','FAILED','CANCELLED','EXPIRED')
     and updated_at < v_now - make_interval(secs => p_retention_seconds);
  get diagnostics v_runs = row_count;
  delete from opera_agent_private.vm_rate_windows where window_start < date_trunc('minute', v_now) - interval '10 minutes';
  get diagnostics v_rates = row_count;
  return jsonb_build_object('runsDeleted', v_runs, 'rateWindowsDeleted', v_rates);
end
$$;

revoke all on function public.opera_vm_crypto_key() from public, anon, authenticated;
revoke all on function public.opera_vm_enqueue(uuid,uuid,text,text,text,integer,text,text,integer,text,text,integer,timestamptz) from public, anon, authenticated;
revoke all on function public.opera_vm_get(uuid,uuid) from public, anon, authenticated;
revoke all on function public.opera_vm_claim(uuid,uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.opera_vm_lease_status(uuid,uuid,uuid,bigint) from public, anon, authenticated;
revoke all on function public.opera_vm_checkpoint(uuid,uuid,uuid,bigint,bigint,text,integer,text,text,text,integer,text,timestamptz,text,text,integer,text) from public, anon, authenticated;
revoke all on function public.opera_vm_effect_reserve(uuid,uuid,uuid,bigint,bigint,text,integer,text,text,text,text) from public, anon, authenticated;
revoke all on function public.opera_vm_effect_attach(uuid,uuid,uuid,bigint,text,text,uuid) from public, anon, authenticated;
revoke all on function public.opera_vm_effect_finish(uuid,uuid,uuid,bigint,text,uuid,boolean) from public, anon, authenticated;
revoke all on function public.opera_vm_cancel(uuid,uuid) from public, anon, authenticated;
revoke all on function public.opera_vm_expire(integer) from public, anon, authenticated;
revoke all on function public.opera_vm_cleanup(integer) from public, anon, authenticated;

grant execute on function public.opera_vm_crypto_key() to service_role;
grant execute on function public.opera_vm_enqueue(uuid,uuid,text,text,text,integer,text,text,integer,text,text,integer,timestamptz) to service_role;
grant execute on function public.opera_vm_get(uuid,uuid) to service_role;
grant execute on function public.opera_vm_claim(uuid,uuid,uuid,integer) to service_role;
grant execute on function public.opera_vm_lease_status(uuid,uuid,uuid,bigint) to service_role;
grant execute on function public.opera_vm_checkpoint(uuid,uuid,uuid,bigint,bigint,text,integer,text,text,text,integer,text,timestamptz,text,text,integer,text) to service_role;
grant execute on function public.opera_vm_effect_reserve(uuid,uuid,uuid,bigint,bigint,text,integer,text,text,text,text) to service_role;
grant execute on function public.opera_vm_effect_attach(uuid,uuid,uuid,bigint,text,text,uuid) to service_role;
grant execute on function public.opera_vm_effect_finish(uuid,uuid,uuid,bigint,text,uuid,boolean) to service_role;
grant execute on function public.opera_vm_cancel(uuid,uuid) to service_role;
grant execute on function public.opera_vm_expire(integer) to service_role;
grant execute on function public.opera_vm_cleanup(integer) to service_role;
