-- LOCAL REVIEW CANDIDATE ONLY. Not a migration; never apply to production.
-- Native PostgreSQL journal/CAS primitives. No browser/agent dispatch authority.
-- Authenticated admission, actual ledger/source adapters and token verification
-- must be connected by a separately audited host before production use.
begin;
create schema opera_agent_tx_candidate;
revoke all on schema opera_agent_tx_candidate from public, anon, authenticated;
grant usage on schema opera_agent_tx_candidate to service_role;

create table opera_agent_tx_candidate.policy (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'OFF' check (mode in ('OFF','DARK','ENFORCED')),
  legacy_gated boolean not null default false,
  agent_commit_enabled boolean not null default false check (not agent_commit_enabled),
  check (mode <> 'ENFORCED' or legacy_gated)
);
insert into opera_agent_tx_candidate.policy(singleton) values (true);
create table opera_agent_tx_candidate.principals (
  tenant_id text not null check (tenant_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  actor_id text not null check (actor_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  user_id text not null check (user_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  oauth_client_id text not null check (oauth_client_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  primary key(tenant_id,actor_id)
);
create table opera_agent_tx_candidate.rates (
  tenant_id text primary key,
  window_start timestamptz not null,
  prepares integer not null default 0 check (prepares between 0 and 20),
  commits integer not null default 0 check (commits between 0 and 10)
);
create table opera_agent_tx_candidate.runs (
  tenant_id text not null,
  actor_id text not null,
  transaction_id text not null check (transaction_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  prepare_digest text not null check (prepare_digest ~ '^sha256:[0-9a-f]{64}$'),
  fence_digest text not null check (fence_digest ~ '^sha256:[0-9a-f]{64}$'),
  target_digest text not null check (target_digest ~ '^sha256:[0-9a-f]{64}$'),
  device_id text not null check (device_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  tab_id bigint not null check (tab_id between 0 and 9007199254740991),
  payload_token text not null check (octet_length(payload_token) <= 196608 and payload_token ~ '^oatx1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  status text not null default 'PREPARED' check (status in (
    'PREPARING','PREPARED','VALIDATING','AWAITING_APPROVAL','APPROVED','COMMITTING',
    'COMMITTED_UNVERIFIED','OBSERVING','VERIFIED','REJECTED','CANCELLED','EXPIRED','FAILED','AMBIGUOUS')),
  transition integer not null default 0 check (transition between 0 and 100),
  lease_epoch integer not null default 0 check (lease_epoch between 0 and 2147483646),
  worker_id text check (worker_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  lease_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  prepared_at timestamptz not null,
  expires_at timestamptz not null,
  validated_at timestamptz,
  terminal_at timestamptz,
  commit_key text not null check (commit_key = 'tx1:' || encode(sha256(convert_to(
    '{"prepareDigest":"' || prepare_digest || '","targetDigest":"' || target_digest ||
    '","tenantId":"' || tenant_id || '","transactionId":"' || transaction_id || '"}', 'UTF8')), 'hex')),
  primary key(tenant_id,transaction_id),
  foreign key(tenant_id,actor_id) references opera_agent_tx_candidate.principals(tenant_id,actor_id),
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  check (prepared_at <= created_at and expires_at <= prepared_at + interval '10 minutes'),
  check ((worker_id is null) = (lease_until is null)),
  check ((status in ('VERIFIED','REJECTED','CANCELLED','EXPIRED','FAILED')) = (terminal_at is not null))
);
create index tx_candidate_pending on opera_agent_tx_candidate.runs(tenant_id,status);
create index tx_candidate_retention on opera_agent_tx_candidate.runs(terminal_at,expires_at);
create table opera_agent_tx_candidate.journal (
  tenant_id text not null,
  transaction_id text not null,
  transition integer not null check (transition between 0 and 100),
  material_digest text not null check (material_digest ~ '^sha256:[0-9a-f]{64}$'),
  status text not null check (status in (
    'PREPARING','PREPARED','VALIDATING','AWAITING_APPROVAL','APPROVED','COMMITTING',
    'COMMITTED_UNVERIFIED','OBSERVING','VERIFIED','REJECTED','CANCELLED','EXPIRED','FAILED','AMBIGUOUS')),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(tenant_id,transaction_id,transition),
  foreign key(tenant_id,transaction_id) references opera_agent_tx_candidate.runs on delete cascade
);
create table opera_agent_tx_candidate.approvals (
  tenant_id text not null,
  transaction_id text not null,
  nonce_digest text not null unique check (nonce_digest ~ '^sha256:[0-9a-f]{64}$'),
  approval_digest text not null check (approval_digest ~ '^sha256:[0-9a-f]{64}$'),
  user_id text not null,
  oauth_client_id text not null,
  approval_ttl_ms integer not null check (approval_ttl_ms between 1 and 120000),
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumption_digest text check (consumption_digest ~ '^sha256:[0-9a-f]{64}$'),
  primary key(tenant_id,transaction_id),
  foreign key(tenant_id,transaction_id) references opera_agent_tx_candidate.runs on delete cascade,
  check (expires_at > issued_at and expires_at <= issued_at + interval '2 minutes'),
  check ((consumed_at is null) = (consumption_digest is null))
);
create table opera_agent_tx_candidate.commit_slots (
  tenant_id text not null,
  transaction_id text not null,
  commit_key text not null unique check (commit_key ~ '^tx1:[0-9a-f]{64}$'),
  fence_digest text not null,
  reserved_at timestamptz not null default clock_timestamp(),
  primary key(tenant_id,transaction_id),
  foreign key(tenant_id,transaction_id) references opera_agent_tx_candidate.runs on delete cascade
);

create function opera_agent_tx_candidate.assert_dark(p_tenant text,p_actor text)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform 1 from opera_agent_tx_candidate.policy where mode='DARK' and not agent_commit_enabled for share;
  if not found then raise exception 'TRANSACTION_DISABLED'; end if;
  perform 1 from opera_agent_tx_candidate.principals where tenant_id=p_tenant and actor_id=p_actor;
  if not found then raise exception 'DARK_IDENTITY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant,814));
end $$;
create function opera_agent_tx_candidate.snapshot(p_run opera_agent_tx_candidate.runs,p_replay boolean default false)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select jsonb_build_object('transactionId',p_run.transaction_id,'status',p_run.status,
    'leaseEpoch',p_run.lease_epoch,'transition',p_run.transition,'commitKey',p_run.commit_key,
    'replay',p_replay,'browserDispatchAllowed',false)
$$;
create function opera_agent_tx_candidate.assert_lease(p_run opera_agent_tx_candidate.runs,p_epoch integer,p_fence text)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if p_run.fence_digest is distinct from p_fence then raise exception 'FENCE_MISMATCH'; end if;
  if p_run.terminal_at is not null then raise exception 'TRANSACTION_TERMINAL'; end if;
  if p_run.expires_at <= clock_timestamp() then raise exception 'TRANSACTION_EXPIRED'; end if;
  if p_epoch is distinct from p_run.lease_epoch or p_run.lease_until is null or p_run.lease_until <= clock_timestamp()
    then raise exception 'STALE_LEASE'; end if;
end $$;
create function opera_agent_tx_candidate.prepare(p_tenant text,p_actor text,p_tx text,p_prepare text,p_fence text,p_target text,p_device text,p_tab bigint,p_payload text,p_prepared_at timestamptz,p_expires_at timestamptz)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare r opera_agent_tx_candidate.runs; rt opera_agent_tx_candidate.rates; stamp timestamptz;
begin
  perform opera_agent_tx_candidate.assert_dark(p_tenant,p_actor);
  select * into r from opera_agent_tx_candidate.runs where tenant_id=p_tenant and transaction_id=p_tx for update;
  if found then
    if r.actor_id is distinct from p_actor or r.prepare_digest is distinct from p_prepare or r.fence_digest is distinct from p_fence
      or r.target_digest is distinct from p_target or r.payload_token is distinct from p_payload
      or r.device_id is distinct from p_device or r.tab_id is distinct from p_tab
      or r.prepared_at is distinct from p_prepared_at or r.expires_at is distinct from p_expires_at then raise exception 'IDEMPOTENCY_COLLISION'; end if;
    return opera_agent_tx_candidate.snapshot(r,true);
  end if;
  if (select count(*) from opera_agent_tx_candidate.runs where tenant_id=p_tenant and terminal_at is null
    and status <> 'COMMITTING' and expires_at > clock_timestamp()) >= 8 then raise exception 'PENDING_LIMIT'; end if;
  stamp := date_trunc('minute',clock_timestamp());
  insert into opera_agent_tx_candidate.rates(tenant_id,window_start) values(p_tenant,stamp) on conflict do nothing;
  select * into rt from opera_agent_tx_candidate.rates where tenant_id=p_tenant for update;
  if rt.window_start <> stamp then
    update opera_agent_tx_candidate.rates set window_start=stamp,prepares=0,commits=0 where tenant_id=p_tenant;
    rt.prepares := 0;
  end if;
  if rt.prepares >= 20 then raise exception 'PREPARE_RATE_LIMIT'; end if;
  stamp := clock_timestamp();
  insert into opera_agent_tx_candidate.runs(tenant_id,actor_id,transaction_id,prepare_digest,fence_digest,target_digest,device_id,tab_id,payload_token,created_at,prepared_at,expires_at,commit_key)
    values(p_tenant,p_actor,p_tx,p_prepare,p_fence,p_target,p_device,p_tab,p_payload,stamp,p_prepared_at,p_expires_at,
      'tx1:'||encode(sha256(convert_to(format('{"prepareDigest":"%s","targetDigest":"%s","tenantId":"%s","transactionId":"%s"}',
        p_prepare,p_target,p_tenant,p_tx),'UTF8')),'hex')) returning * into r;
  update opera_agent_tx_candidate.rates set prepares=prepares+1 where tenant_id=p_tenant;
  return opera_agent_tx_candidate.snapshot(r);
end $$;
create function opera_agent_tx_candidate.read_run(p_tenant text,p_actor text,p_tx text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare r opera_agent_tx_candidate.runs;
begin
  select * into r from opera_agent_tx_candidate.runs where tenant_id=p_tenant and actor_id=p_actor and transaction_id=p_tx;
  if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  return opera_agent_tx_candidate.snapshot(r);
end $$;
create function opera_agent_tx_candidate.claim(p_tenant text,p_actor text,p_tx text,p_worker text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare r opera_agent_tx_candidate.runs; stamp timestamptz;
begin
  perform opera_agent_tx_candidate.assert_dark(p_tenant,p_actor);
  select * into r from opera_agent_tx_candidate.runs where tenant_id=p_tenant and actor_id=p_actor and transaction_id=p_tx for update;
  if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  stamp := clock_timestamp();
  if r.terminal_at is not null then return opera_agent_tx_candidate.snapshot(r,true); end if;
  if r.expires_at <= stamp then
    update opera_agent_tx_candidate.runs set status='EXPIRED',terminal_at=stamp,worker_id=null,lease_until=null,
      lease_epoch=lease_epoch+1,transition=transition+1 where tenant_id=p_tenant and transaction_id=p_tx returning * into r;
    insert into opera_agent_tx_candidate.journal values(p_tenant,p_tx,r.transition,'sha256:'||encode(sha256(convert_to('EXPIRED','UTF8')),'hex'),'EXPIRED',stamp);
    return opera_agent_tx_candidate.snapshot(r);
  end if;
  if r.lease_until > stamp then
    if r.worker_id is distinct from p_worker then raise exception 'LEASE_BUSY'; end if;
    return opera_agent_tx_candidate.snapshot(r,true);
  end if;
  update opera_agent_tx_candidate.runs set worker_id=p_worker,lease_until=least(stamp+interval '30 seconds',expires_at),lease_epoch=lease_epoch+1
    where tenant_id=p_tenant and transaction_id=p_tx returning * into r;
  return opera_agent_tx_candidate.snapshot(r);
end $$;
create function opera_agent_tx_candidate.await_approval(p_tenant text,p_actor text,p_tx text,p_epoch integer,p_fence text,p_material text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare r opera_agent_tx_candidate.runs; previous text;
begin
  perform opera_agent_tx_candidate.assert_dark(p_tenant,p_actor);
  select * into r from opera_agent_tx_candidate.runs where tenant_id=p_tenant and actor_id=p_actor and transaction_id=p_tx for update;
  if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  if r.fence_digest is distinct from p_fence then raise exception 'FENCE_MISMATCH'; end if;
  if r.terminal_at is not null then raise exception 'TRANSACTION_TERMINAL'; end if;
  select material_digest into previous from opera_agent_tx_candidate.journal where tenant_id=p_tenant and transaction_id=p_tx and transition=1;
  if found then
    if previous is distinct from p_material then raise exception 'IDEMPOTENCY_COLLISION'; end if;
    return opera_agent_tx_candidate.snapshot(r,true);
  end if;
  perform opera_agent_tx_candidate.assert_lease(r,p_epoch,p_fence);
  if r.status <> 'PREPARED' then raise exception 'INVALID_TRANSITION'; end if;
  update opera_agent_tx_candidate.runs set status='AWAITING_APPROVAL',transition=1 where tenant_id=p_tenant and transaction_id=p_tx returning * into r;
  insert into opera_agent_tx_candidate.journal(tenant_id,transaction_id,transition,material_digest,status) values(p_tenant,p_tx,1,p_material,r.status);
  return opera_agent_tx_candidate.snapshot(r);
end $$;
create function opera_agent_tx_candidate.issue_approval(p_tenant text,p_actor text,p_tx text,p_epoch integer,p_fence text,p_nonce text,p_approval text,p_ttl integer)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare r opera_agent_tx_candidate.runs; a opera_agent_tx_candidate.approvals; principal opera_agent_tx_candidate.principals; stamp timestamptz;
begin
  perform opera_agent_tx_candidate.assert_dark(p_tenant,p_actor);
  select * into r from opera_agent_tx_candidate.runs where tenant_id=p_tenant and actor_id=p_actor and transaction_id=p_tx for update;
  if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  perform opera_agent_tx_candidate.assert_lease(r,p_epoch,p_fence);
  if r.status <> 'AWAITING_APPROVAL' then raise exception 'INVALID_TRANSITION'; end if;
  if p_ttl is null or p_ttl < 1 or p_ttl > 120000 then raise exception 'APPROVAL_EXPIRED'; end if;
  select * into a from opera_agent_tx_candidate.approvals where tenant_id=p_tenant and transaction_id=p_tx;
  if found then
    if a.nonce_digest is distinct from p_nonce or a.approval_digest is distinct from p_approval
      or a.approval_ttl_ms is distinct from p_ttl then raise exception 'IDEMPOTENCY_COLLISION'; end if;
    return opera_agent_tx_candidate.snapshot(r,true);
  end if;
  select * into principal from opera_agent_tx_candidate.principals where tenant_id=p_tenant and actor_id=p_actor;
  stamp := clock_timestamp();
  insert into opera_agent_tx_candidate.approvals(tenant_id,transaction_id,nonce_digest,approval_digest,user_id,oauth_client_id,approval_ttl_ms,issued_at,expires_at)
    values(p_tenant,p_tx,p_nonce,p_approval,principal.user_id,principal.oauth_client_id,p_ttl,stamp,least(stamp+p_ttl*interval '1 millisecond',r.expires_at));
  return opera_agent_tx_candidate.snapshot(r);
end $$;
create function opera_agent_tx_candidate.consume_approval(p_tenant text,p_actor text,p_tx text,p_epoch integer,p_fence text,p_nonce text,p_approval text,p_consumption text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare r opera_agent_tx_candidate.runs; a opera_agent_tx_candidate.approvals;
begin
  perform opera_agent_tx_candidate.assert_dark(p_tenant,p_actor);
  select * into r from opera_agent_tx_candidate.runs where tenant_id=p_tenant and actor_id=p_actor and transaction_id=p_tx for update;
  if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  if r.fence_digest is distinct from p_fence then raise exception 'FENCE_MISMATCH'; end if;
  if r.terminal_at is not null then raise exception 'TRANSACTION_TERMINAL'; end if;
  select * into a from opera_agent_tx_candidate.approvals where tenant_id=p_tenant and transaction_id=p_tx for update;
  if not found or a.nonce_digest is distinct from p_nonce or a.approval_digest is distinct from p_approval then raise exception 'APPROVAL_MISMATCH'; end if;
  if a.consumed_at is not null then
    if a.consumption_digest is distinct from p_consumption then raise exception 'APPROVAL_ALREADY_CONSUMED'; end if;
    return opera_agent_tx_candidate.snapshot(r,true);
  end if;
  perform opera_agent_tx_candidate.assert_lease(r,p_epoch,p_fence);
  if r.status <> 'AWAITING_APPROVAL' then raise exception 'INVALID_TRANSITION'; end if;
  if a.expires_at <= clock_timestamp() then raise exception 'APPROVAL_EXPIRED'; end if;
  update opera_agent_tx_candidate.approvals set consumed_at=clock_timestamp(),consumption_digest=p_consumption where tenant_id=p_tenant and transaction_id=p_tx;
  update opera_agent_tx_candidate.runs set status='APPROVED',transition=2,validated_at=null where tenant_id=p_tenant and transaction_id=p_tx returning * into r;
  insert into opera_agent_tx_candidate.journal(tenant_id,transaction_id,transition,material_digest,status) values(p_tenant,p_tx,2,p_consumption,r.status);
  return opera_agent_tx_candidate.snapshot(r);
end $$;
create function opera_agent_tx_candidate.mark_validated(p_tenant text,p_actor text,p_tx text,p_epoch integer,p_fence text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare r opera_agent_tx_candidate.runs;
begin
  perform opera_agent_tx_candidate.assert_dark(p_tenant,p_actor);
  select * into r from opera_agent_tx_candidate.runs where tenant_id=p_tenant and actor_id=p_actor and transaction_id=p_tx for update;
  if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  perform opera_agent_tx_candidate.assert_lease(r,p_epoch,p_fence);
  if r.status <> 'APPROVED' then raise exception 'INVALID_TRANSITION'; end if;
  update opera_agent_tx_candidate.runs set validated_at=clock_timestamp() where tenant_id=p_tenant and transaction_id=p_tx returning * into r;
  return opera_agent_tx_candidate.snapshot(r);
end $$;
create function opera_agent_tx_candidate.reserve_slot(p_tenant text,p_actor text,p_tx text,p_epoch integer,p_fence text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare r opera_agent_tx_candidate.runs; a opera_agent_tx_candidate.approvals; rt opera_agent_tx_candidate.rates; stamp timestamptz;
begin
  perform opera_agent_tx_candidate.assert_dark(p_tenant,p_actor);
  select * into r from opera_agent_tx_candidate.runs where tenant_id=p_tenant and actor_id=p_actor and transaction_id=p_tx for update;
  if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  if r.fence_digest is distinct from p_fence then raise exception 'FENCE_MISMATCH'; end if;
  if r.terminal_at is not null then raise exception 'TRANSACTION_TERMINAL'; end if;
  perform 1 from opera_agent_tx_candidate.commit_slots where tenant_id=p_tenant and transaction_id=p_tx;
  if found then return opera_agent_tx_candidate.snapshot(r,true); end if;
  perform opera_agent_tx_candidate.assert_lease(r,p_epoch,p_fence);
  if r.status <> 'APPROVED' then raise exception 'INVALID_TRANSITION'; end if;
  stamp := clock_timestamp();
  select * into a from opera_agent_tx_candidate.approvals where tenant_id=p_tenant and transaction_id=p_tx;
  if not found or a.consumed_at is null or a.expires_at <= stamp or a.consumed_at+interval '15 seconds' <= stamp then raise exception 'APPROVAL_EXPIRED'; end if;
  if r.validated_at is null or r.validated_at < a.consumed_at or r.validated_at+interval '5 seconds' <= stamp then raise exception 'VALIDATION_EXPIRED'; end if;
  if (select count(*) from opera_agent_tx_candidate.runs where tenant_id=p_tenant and status='COMMITTING') >= 2 then raise exception 'COMMIT_CONCURRENCY_LIMIT'; end if;
  if exists(select 1 from opera_agent_tx_candidate.runs where tenant_id=p_tenant and status='COMMITTING' and device_id=r.device_id and tab_id=r.tab_id) then raise exception 'TARGET_COMMIT_LIMIT'; end if;
  select * into rt from opera_agent_tx_candidate.rates where tenant_id=p_tenant for update;
  if rt.window_start <> date_trunc('minute',stamp) then
    update opera_agent_tx_candidate.rates set window_start=date_trunc('minute',stamp),prepares=0,commits=0 where tenant_id=p_tenant;
    rt.commits := 0;
  end if;
  if rt.commits >= 10 then raise exception 'COMMIT_RATE_LIMIT'; end if;
  insert into opera_agent_tx_candidate.commit_slots(tenant_id,transaction_id,commit_key,fence_digest) values(p_tenant,p_tx,r.commit_key,r.fence_digest);
  update opera_agent_tx_candidate.rates set commits=commits+1 where tenant_id=p_tenant;
  update opera_agent_tx_candidate.runs set status='COMMITTING',transition=3 where tenant_id=p_tenant and transaction_id=p_tx returning * into r;
  insert into opera_agent_tx_candidate.journal(tenant_id,transaction_id,transition,material_digest,status) values(p_tenant,p_tx,3,r.fence_digest,r.status);
  return opera_agent_tx_candidate.snapshot(r);
end $$;
create function opera_agent_tx_candidate.cancel(p_tenant text,p_actor text,p_tx text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare r opera_agent_tx_candidate.runs; stamp timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant,814));
  select * into r from opera_agent_tx_candidate.runs where tenant_id=p_tenant and actor_id=p_actor and transaction_id=p_tx for update;
  if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  if r.terminal_at is not null then return opera_agent_tx_candidate.snapshot(r,true); end if;
  -- In 8D no slot can be dispatched. Post-dispatch cancellation is 8E scope.
  stamp := clock_timestamp();
  update opera_agent_tx_candidate.runs set status='CANCELLED',terminal_at=stamp,worker_id=null,lease_until=null,lease_epoch=lease_epoch+1,transition=transition+1
    where tenant_id=p_tenant and transaction_id=p_tx returning * into r;
  insert into opera_agent_tx_candidate.journal values(p_tenant,p_tx,r.transition,'sha256:'||encode(sha256(convert_to('CANCELLED','UTF8')),'hex'),'CANCELLED',stamp);
  return opera_agent_tx_candidate.snapshot(r);
end $$;
create function opera_agent_tx_candidate.cleanup(p_limit integer)
returns integer language plpgsql security invoker set search_path=pg_catalog as $$
declare count_deleted integer; rates_deleted integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'CLEANUP_LIMIT'; end if;
  with victims as (
    select tenant_id,transaction_id from opera_agent_tx_candidate.runs
    where (terminal_at is not null and terminal_at <= clock_timestamp()-interval '7 days')
      or (terminal_at is null and created_at <= clock_timestamp()-interval '24 hours')
    order by tenant_id,transaction_id limit p_limit for update skip locked
  ), removed as (
    delete from opera_agent_tx_candidate.runs r using victims v where r.tenant_id=v.tenant_id and r.transaction_id=v.transaction_id returning 1
  ) select count(*) into count_deleted from removed;
  with victims as (
    select rt.tenant_id from opera_agent_tx_candidate.rates rt where window_start <= clock_timestamp()-interval '7 days'
      and not exists(select 1 from opera_agent_tx_candidate.runs r where r.tenant_id=rt.tenant_id)
    order by rt.tenant_id limit (p_limit-count_deleted) for update skip locked
  ), removed as (
    delete from opera_agent_tx_candidate.rates rt using victims v where rt.tenant_id=v.tenant_id returning 1
  ) select count(*) into rates_deleted from removed;
  -- Bound root deletions; cascaded journal children are separately bounded by schema.
  return count_deleted+rates_deleted;
end $$;

alter table opera_agent_tx_candidate.policy enable row level security;
alter table opera_agent_tx_candidate.principals enable row level security;
alter table opera_agent_tx_candidate.rates enable row level security;
alter table opera_agent_tx_candidate.runs enable row level security;
alter table opera_agent_tx_candidate.journal enable row level security;
alter table opera_agent_tx_candidate.approvals enable row level security;
alter table opera_agent_tx_candidate.commit_slots enable row level security;
revoke all on all tables in schema opera_agent_tx_candidate from public,anon,authenticated;
revoke execute on all functions in schema opera_agent_tx_candidate from public,anon,authenticated;
grant select,insert,update,delete on all tables in schema opera_agent_tx_candidate to service_role;
grant execute on all functions in schema opera_agent_tx_candidate to service_role;
commit;
