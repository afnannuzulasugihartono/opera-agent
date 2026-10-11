-- Audited 8D additive dark journal. Default OFF; no browser dispatch.
-- CLI generated initial version 20260913143147; filename aligned to actual
-- MCP-applied migration history version 20260913143306. SQL body unchanged.
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

create table opera_agent_tx_candidate.acceptance_bindings (
  tenant_id text not null,
  actor_id text not null,
  transaction_id text not null check (transaction_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  goal_id text not null,
  goal_revision integer not null check (goal_revision between 1 and 2147483647),
  ledger_digest text not null check (ledger_digest ~ '^sha256:[0-9a-f]{64}$'),
  metadata jsonb not null check (jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=131072),
  primary key(tenant_id,actor_id,transaction_id),
  foreign key(tenant_id,actor_id) references opera_agent_tx_candidate.principals on delete cascade
);
create function opera_agent_tx_candidate.binding_immutable()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception 'IMMUTABLE_ACCEPTANCE_BINDING'; end $$;
create trigger immutable_binding before update on opera_agent_tx_candidate.acceptance_bindings
for each row execute function opera_agent_tx_candidate.binding_immutable();
create table opera_agent_tx_candidate.runs (
  tenant_id text not null,
  actor_id text not null,
  transaction_id text not null check (transaction_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  prepare_digest text not null check (prepare_digest ~ '^sha256:[0-9a-f]{64}$'),
  fence_digest text not null check (fence_digest ~ '^sha256:[0-9a-f]{64}$'),
  target_digest text not null check (target_digest ~ '^sha256:[0-9a-f]{64}$'),
  device_id text not null check (device_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  tab_id bigint not null check (tab_id between 0 and 9007199254740991),
  payload_token text check (octet_length(payload_token) <= 196608 and payload_token ~ '^oatx1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  payload_digest text not null check (payload_digest ~ '^sha256:[0-9a-f]{64}$'),
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
  check ((terminal_at is null) = (payload_token is not null)),
  check (payload_token is null or payload_digest='sha256:'||encode(sha256(convert_to(payload_token,'UTF8')),'hex')),
  check ((status in ('VERIFIED','REJECTED','CANCELLED','EXPIRED','FAILED')) = (terminal_at is not null))
);
create index tx_candidate_pending on opera_agent_tx_candidate.runs(tenant_id,status);
create index tx_candidate_retention on opera_agent_tx_candidate.runs(terminal_at,expires_at);

create table opera_agent_tx_candidate.run_identities (
  tenant_id text not null,
  transaction_id text not null,
  identity jsonb not null check (jsonb_typeof(identity)='object' and octet_length(identity::text)<=2048),
  primary key(tenant_id,transaction_id),
  foreign key(tenant_id,transaction_id) references opera_agent_tx_candidate.runs on delete cascade
);
create trigger immutable_run_identity before update on opera_agent_tx_candidate.run_identities
for each row execute function opera_agent_tx_candidate.binding_immutable();

create table opera_agent_tx_candidate.run_limits (
  tenant_id text not null,
  transaction_id text not null,
  budgets jsonb not null check(jsonb_typeof(budgets)='object' and octet_length(budgets::text)<=4096),
  primary key(tenant_id,transaction_id),
  foreign key(tenant_id,transaction_id) references opera_agent_tx_candidate.runs on delete cascade
);
create trigger immutable_run_limits before update on opera_agent_tx_candidate.run_limits
for each row execute function opera_agent_tx_candidate.binding_immutable();
create function opera_agent_tx_candidate.tx_limit(p_tenant text,p_tx text,p_key text,p_global integer)
returns integer language plpgsql security invoker set search_path=pg_catalog as $$
declare value jsonb;
begin
  select budgets->p_key into value from opera_agent_tx_candidate.run_limits where tenant_id=p_tenant and transaction_id=p_tx;
  if not found then return p_global; end if;
  if value is null or jsonb_typeof(value)<>'number' or value::text !~ '^[0-9]{1,9}$'
    or value::text::integer<1 or value::text::integer>p_global then raise exception 'LIMIT_REACHED'; end if;
  return value::text::integer;
end $$;

create function opera_agent_tx_candidate.canonical_metadata(value jsonb,depth integer default 0)
returns text language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare result text;
begin
  if value is null or depth<0 or depth>8 or octet_length(value::text)>131072 then raise exception 'LIMIT_REACHED'; end if;
  if jsonb_typeof(value)='object' then
    select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||opera_agent_tx_candidate.canonical_metadata(child,depth+1),',' order by key collate "C"),'')||'}'
      into result from jsonb_each(value) as entry(key,child);
  elsif jsonb_typeof(value)='array' then
    select '['||coalesce(string_agg(opera_agent_tx_candidate.canonical_metadata(child,depth+1),',' order by position),'')||']'
      into result from jsonb_array_elements(value) with ordinality as entry(child,position);
  else result:=value::text; end if;
  return result;
end $$;
create function opera_agent_tx_candidate.metadata_digest(value jsonb)
returns text language sql immutable security invoker set search_path=pg_catalog as $$
  select 'sha256:'||encode(sha256(convert_to(opera_agent_tx_candidate.canonical_metadata(value),'UTF8')),'hex')
$$;
create function opera_agent_tx_candidate.preview_digest(p_prepared jsonb)
returns text language sql immutable security invoker set search_path=pg_catalog as $$
  select opera_agent_tx_candidate.metadata_digest(jsonb_build_object(
    'schemaVersion','OA_TRANSACTION_PREVIEW_8B_V1','transactionId',p_prepared->'transactionId',
    'goalId',p_prepared->'goalId','goalRevision',p_prepared->'goalRevision','target',p_prepared->'target',
    'effectClass',p_prepared->'effectClass','action',p_prepared->'action',
    'expectedPostconditionDigests',p_prepared->'expectedPostconditions',
    'provenanceValueDigests',(select coalesce(jsonb_agg(child->'valueDigest' order by position),'[]'::jsonb) from jsonb_array_elements(p_prepared->'provenance') with ordinality as item(child,position)),
    'prepareDigest',p_prepared->'prepareDigest','expiresAt',p_prepared->'expiresAt'))
$$;
create table opera_agent_tx_candidate.run_previews (
  tenant_id text not null, transaction_id text not null,
  metadata jsonb not null check(jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=2048),
  primary key(tenant_id,transaction_id),
  foreign key(tenant_id,transaction_id) references opera_agent_tx_candidate.runs on delete cascade
);
create trigger immutable_run_preview before update on opera_agent_tx_candidate.run_previews
for each row execute function opera_agent_tx_candidate.binding_immutable();
create table opera_agent_tx_candidate.run_challenges (
  tenant_id text not null, transaction_id text not null,
  challenge jsonb not null check(jsonb_typeof(challenge)='object' and octet_length(challenge::text)<=4096),
  primary key(tenant_id,transaction_id),
  foreign key(tenant_id,transaction_id) references opera_agent_tx_candidate.runs on delete cascade
);
create trigger immutable_run_challenge before update on opera_agent_tx_candidate.run_challenges
for each row execute function opera_agent_tx_candidate.binding_immutable();
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

grant usage on schema auth to service_role;
grant select(id,user_id,oauth_client_id,not_after) on auth.sessions to service_role;
create function public.opera_tx_identity_read(p_user_id text,p_client_id text,p_session_id text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare result jsonb; matches integer; v_session_id auth.sessions.id%type; v_auth_user_id auth.sessions.user_id%type; v_auth_client_id auth.sessions.oauth_client_id%type;
begin
  v_session_id:=p_session_id;v_auth_user_id:=p_user_id;v_auth_client_id:=p_client_id;
  select count(*),min(jsonb_build_object('tenant_id',p.tenant_id,'actor_id',p.actor_id,
    'user_id',p.user_id,'oauth_client_id',p.oauth_client_id)::text)::jsonb into matches,result
  from opera_agent_tx_candidate.principals p join auth.sessions s
    on s.user_id::text=p.user_id and s.oauth_client_id::text=p.oauth_client_id
  where p.user_id=p_user_id and p.oauth_client_id=p_client_id and s.id=v_session_id and s.user_id=v_auth_user_id and s.oauth_client_id=v_auth_client_id
    and (s.not_after is null or s.not_after>clock_timestamp());
  if matches<>1 then return null; end if;
  return result;
end $$;
revoke execute on function public.opera_tx_identity_read(text,text,text) from public,anon,authenticated;
grant execute on function public.opera_tx_identity_read(text,text,text) to service_role;

create function opera_agent_tx_candidate.assert_live_identity(p_tenant text,p_actor text,p_identity jsonb)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare principal opera_agent_tx_candidate.principals; session_found boolean; session_expiry timestamptz; stamp timestamptz;
  v_session_id auth.sessions.id%type; v_auth_user_id auth.sessions.user_id%type; v_auth_client_id auth.sessions.oauth_client_id%type;
begin
  if p_identity is null or jsonb_typeof(p_identity)<>'object'
    or (select array_agg(k order by k) from jsonb_object_keys(p_identity) k)
      is distinct from array['acceptanceIdentity','accessExpiresAt','oauthClientId','sessionId','tenantId','userId']::text[]
    or p_identity->>'tenantId' is distinct from p_tenant or p_identity->>'acceptanceIdentity' is distinct from p_actor
    or jsonb_typeof(p_identity->'accessExpiresAt') is distinct from 'number'
    or p_identity->>'accessExpiresAt' !~ '^[0-9]{1,12}$' then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  select * into principal from opera_agent_tx_candidate.principals where tenant_id=p_tenant and actor_id=p_actor for share;
  if not found or principal.user_id is distinct from p_identity->>'userId'
    or principal.oauth_client_id is distinct from p_identity->>'oauthClientId' then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  v_session_id:=p_identity->>'sessionId';v_auth_user_id:=principal.user_id;v_auth_client_id:=principal.oauth_client_id;

  select true,not_after into session_found,session_expiry from auth.sessions where id=v_session_id
    and user_id=v_auth_user_id and oauth_client_id=v_auth_client_id
    and (not_after is null or not_after>clock_timestamp()) for share;
  stamp:=clock_timestamp();
  if session_found is distinct from true or (session_expiry is not null and session_expiry<=stamp)
    or to_timestamp((p_identity->>'accessExpiresAt')::double precision)<=stamp
    then raise exception 'AUTHENTICATION_REQUIRED'; end if;
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
      or r.target_digest is distinct from p_target
      or r.payload_digest is distinct from 'sha256:'||encode(sha256(convert_to(p_payload,'UTF8')),'hex')
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
  insert into opera_agent_tx_candidate.runs(tenant_id,actor_id,transaction_id,prepare_digest,fence_digest,target_digest,device_id,tab_id,payload_token,payload_digest,created_at,prepared_at,expires_at,commit_key)
    values(p_tenant,p_actor,p_tx,p_prepare,p_fence,p_target,p_device,p_tab,p_payload,'sha256:'||encode(sha256(convert_to(p_payload,'UTF8')),'hex'),stamp,p_prepared_at,p_expires_at,
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
    update opera_agent_tx_candidate.runs set status='EXPIRED',terminal_at=stamp,payload_token=null,worker_id=null,lease_until=null,
      lease_epoch=lease_epoch+1,transition=transition+1 where tenant_id=p_tenant and transaction_id=p_tx returning * into r;
    insert into opera_agent_tx_candidate.journal values(p_tenant,p_tx,r.transition,'sha256:'||encode(sha256(convert_to('EXPIRED','UTF8')),'hex'),'EXPIRED',stamp);
    return opera_agent_tx_candidate.snapshot(r);
  end if;
  if r.lease_until > stamp then
    if r.worker_id is distinct from p_worker then raise exception 'LEASE_BUSY'; end if;
    return opera_agent_tx_candidate.snapshot(r,true);
  end if;
  update opera_agent_tx_candidate.runs set worker_id=p_worker,lease_until=least(stamp+opera_agent_tx_candidate.tx_limit(p_tenant,p_tx,'commitCommandTimeoutMs',30000)*interval '1 millisecond',expires_at),lease_epoch=lease_epoch+1
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
  if p_ttl is null or p_ttl < 1 or p_ttl > opera_agent_tx_candidate.tx_limit(p_tenant,p_tx,'approvalLifetimeMs',120000) then raise exception 'APPROVAL_EXPIRED'; end if;
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
  if not found or a.consumed_at is null or a.expires_at <= stamp or a.consumed_at+opera_agent_tx_candidate.tx_limit(p_tenant,p_tx,'approvalToDispatchMs',15000)*interval '1 millisecond' <= stamp then raise exception 'APPROVAL_EXPIRED'; end if;
  if r.validated_at is null or r.validated_at < a.consumed_at or r.validated_at+opera_agent_tx_candidate.tx_limit(p_tenant,p_tx,'finalValidationToDispatchMs',5000)*interval '1 millisecond' <= stamp then raise exception 'VALIDATION_EXPIRED'; end if;
  if (select count(*) from opera_agent_tx_candidate.runs where tenant_id=p_tenant and status='COMMITTING') >= opera_agent_tx_candidate.tx_limit(p_tenant,p_tx,'concurrentCommittingPerTenant',2) then raise exception 'COMMIT_CONCURRENCY_LIMIT'; end if;
  if exists(select 1 from opera_agent_tx_candidate.runs where tenant_id=p_tenant and status='COMMITTING' and device_id=r.device_id and tab_id=r.tab_id) then raise exception 'TARGET_COMMIT_LIMIT'; end if;
  select * into rt from opera_agent_tx_candidate.rates where tenant_id=p_tenant for update;
  if rt.window_start <> date_trunc('minute',stamp) then
    update opera_agent_tx_candidate.rates set window_start=date_trunc('minute',stamp),prepares=0,commits=0 where tenant_id=p_tenant;
    rt.commits := 0;
  end if;
  if rt.commits >= opera_agent_tx_candidate.tx_limit(p_tenant,p_tx,'commitRatePerTenantPerMinute',10) then raise exception 'COMMIT_RATE_LIMIT'; end if;
  insert into opera_agent_tx_candidate.commit_slots(tenant_id,transaction_id,commit_key,fence_digest) values(p_tenant,p_tx,r.commit_key,r.fence_digest);
  update opera_agent_tx_candidate.rates set commits=commits+1 where tenant_id=p_tenant;
  update opera_agent_tx_candidate.runs set status='COMMITTING',transition=3 where tenant_id=p_tenant and transaction_id=p_tx returning * into r;
  insert into opera_agent_tx_candidate.journal(tenant_id,transaction_id,transition,material_digest,status) values(p_tenant,p_tx,3,r.fence_digest,r.status);
  return opera_agent_tx_candidate.snapshot(r);
end $$;

create function opera_agent_tx_candidate.finalize_dark(p_tenant text,p_actor text,p_tx text,p_epoch integer,p_fence text,p_nonce text,p_approval text,p_consumption text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform opera_agent_tx_candidate.consume_approval(p_tenant,p_actor,p_tx,p_epoch,p_fence,p_nonce,p_approval,p_consumption);
  if exists(select 1 from opera_agent_tx_candidate.commit_slots where tenant_id=p_tenant and transaction_id=p_tx) then
    return opera_agent_tx_candidate.reserve_slot(p_tenant,p_actor,p_tx,p_epoch,p_fence);
  end if;
  perform opera_agent_tx_candidate.mark_validated(p_tenant,p_actor,p_tx,p_epoch,p_fence);
  return opera_agent_tx_candidate.reserve_slot(p_tenant,p_actor,p_tx,p_epoch,p_fence);
end $$;
create function opera_agent_tx_candidate.cancel(p_tenant text,p_actor text,p_tx text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare r opera_agent_tx_candidate.runs; stamp timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant,814));
  select * into r from opera_agent_tx_candidate.runs where tenant_id=p_tenant and actor_id=p_actor and transaction_id=p_tx for update;
  if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  if r.terminal_at is not null then return opera_agent_tx_candidate.snapshot(r,true); end if;

  stamp := clock_timestamp();
  update opera_agent_tx_candidate.runs set status='CANCELLED',terminal_at=stamp,payload_token=null,worker_id=null,lease_until=null,lease_epoch=lease_epoch+1,transition=transition+1
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
    where (terminal_at is not null and terminal_at <= clock_timestamp()-opera_agent_tx_candidate.tx_limit(tenant_id,transaction_id,'terminalRetentionDays',7)*interval '1 day')
      or (terminal_at is null and created_at <= clock_timestamp()-opera_agent_tx_candidate.tx_limit(tenant_id,transaction_id,'nonterminalRetentionHours',24)*interval '1 hour')
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

  return count_deleted+rates_deleted;
end $$;

create function public.opera_tx_binding_read(p_tenant text,p_actor text,p_tx text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare result jsonb;
begin
  perform opera_agent_tx_candidate.assert_dark(p_tenant,p_actor);
  select metadata||jsonb_build_object('mode','DARK') into result from opera_agent_tx_candidate.acceptance_bindings
    where tenant_id=p_tenant and actor_id=p_actor and transaction_id=p_tx;
  return result;
end $$;
create function public.opera_tx_prepare_bound(p_tenant text,p_actor text,p_identity jsonb,p_prepared jsonb,p_ledger_digest text,p_fence text,p_payload text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare b opera_agent_tx_candidate.acceptance_bindings; h record; r opera_agent_tx_candidate.runs; tx text; limits jsonb; pending integer; rate integer; has_run boolean;
begin
  perform opera_agent_tx_candidate.assert_dark(p_tenant,p_actor);
  perform opera_agent_tx_candidate.assert_live_identity(p_tenant,p_actor,p_identity);
  tx:=p_prepared->>'transactionId';
  select * into b from opera_agent_tx_candidate.acceptance_bindings where tenant_id=p_tenant and actor_id=p_actor and transaction_id=tx for share;
  if not found then raise exception 'AUTHORITY_NOT_RESOLVED'; end if;
  select * into h from opera_agent_private.goal_heads where tenant_id::text=p_tenant and goal_id=b.goal_id for share;
  if not found or h.head_revision<>b.goal_revision or h.head_digest<>b.ledger_digest or h.status not in ('OPEN','PARTIAL') or h.expires_at<=clock_timestamp()
    then raise exception 'AUTHORITY_NOT_RESOLVED'; end if;
  if b.ledger_digest is distinct from p_ledger_digest or b.metadata->>'preparedDigest' is distinct from p_prepared->>'prepareDigest'
    or p_prepared->>'tenantId' is distinct from p_tenant or p_prepared->>'goalId' is distinct from b.goal_id
    or (p_prepared->>'goalRevision')::integer is distinct from b.goal_revision
    or b.metadata->'target' is distinct from p_prepared->'target' then raise exception 'AUTHORITY_NOT_RESOLVED'; end if;
  select * into r from opera_agent_tx_candidate.runs where tenant_id=p_tenant and transaction_id=tx for update;
  has_run:=found;

  perform opera_agent_tx_candidate.assert_live_identity(p_tenant,p_actor,p_identity);
  if h.expires_at<=clock_timestamp() then raise exception 'AUTHORITY_NOT_RESOLVED'; end if;
  if has_run then

    if r.actor_id is distinct from p_actor or r.prepare_digest is distinct from p_prepared->>'prepareDigest'
      or r.fence_digest is distinct from p_fence then raise exception 'IDEMPOTENCY_COLLISION'; end if;
    return opera_agent_tx_candidate.snapshot(r,true);
  end if;
  limits:=p_prepared->'budgets';
  if limits is null or jsonb_typeof(limits)<>'object' or octet_length(limits::text)>4096 then raise exception 'LIMIT_REACHED'; end if;
  if (p_prepared->>'expiresAt')::timestamptz>(p_prepared->>'preparedAt')::timestamptz
      +least((limits->>'prepareLifetimeMs')::integer,(limits->>'totalTransactionLifetimeMs')::integer)*interval '1 millisecond'
    then raise exception 'LIMIT_REACHED'; end if;
  select count(*) into pending from opera_agent_tx_candidate.runs where tenant_id=p_tenant and terminal_at is null and status<>'COMMITTING' and expires_at>clock_timestamp();
  select prepares into rate from opera_agent_tx_candidate.rates where tenant_id=p_tenant and window_start=date_trunc('minute',clock_timestamp());
  if pending>=(limits->>'pendingPerTenant')::integer then raise exception 'PENDING_LIMIT'; end if;
  if coalesce(rate,0)>=(limits->>'prepareRatePerTenantPerMinute')::integer then raise exception 'PREPARE_RATE_LIMIT'; end if;
  perform opera_agent_tx_candidate.prepare(p_tenant,p_actor,tx,p_prepared->>'prepareDigest',p_fence,
    p_prepared->'target'->>'targetDigest',p_prepared->'target'->>'deviceId',(p_prepared->'target'->>'tabId')::bigint,
    p_payload,(p_prepared->>'preparedAt')::timestamptz,(p_prepared->>'expiresAt')::timestamptz);
  insert into opera_agent_tx_candidate.run_identities values(p_tenant,tx,p_identity);
  insert into opera_agent_tx_candidate.run_limits values(p_tenant,tx,limits);
  insert into opera_agent_tx_candidate.run_previews values(p_tenant,tx,jsonb_build_object(
    'previewDigest',opera_agent_tx_candidate.preview_digest(p_prepared),'goalRevision',p_prepared->'goalRevision','effectClass',p_prepared->'effectClass'));

  perform opera_agent_tx_candidate.tx_limit(p_tenant,tx,key,cap) from (values
    ('prepareLifetimeMs',600000),('totalTransactionLifetimeMs',600000),('approvalLifetimeMs',120000),
    ('approvalToDispatchMs',15000),('finalValidationToDispatchMs',5000),('commitCommandTimeoutMs',30000),
    ('concurrentCommittingPerTenant',2),('concurrentCommitPerTargetTab',1),('pendingPerTenant',8),
    ('prepareRatePerTenantPerMinute',20),('commitRatePerTenantPerMinute',10),('nonterminalRetentionHours',24),('terminalRetentionDays',7)
  ) as applicable(key,cap);
  return opera_agent_tx_candidate.read_run(p_tenant,p_actor,tx);
end $$;
revoke execute on function public.opera_tx_binding_read(text,text,text) from public,anon,authenticated;
revoke execute on function public.opera_tx_prepare_bound(text,text,jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.opera_tx_binding_read(text,text,text) to service_role;
grant execute on function public.opera_tx_prepare_bound(text,text,jsonb,jsonb,text,text,text) to service_role;

create function public.opera_tx_issue_bound(p_tenant text,p_actor text,p_tx text,p_epoch integer,p_fence text,p_challenge jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare r opera_agent_tx_candidate.runs; identity jsonb; preview jsonb; prior jsonb; h record; b opera_agent_tx_candidate.acceptance_bindings;
  issued timestamptz; expiry timestamptz; stamp timestamptz; ttl integer; key text;
begin
  perform opera_agent_tx_candidate.assert_dark(p_tenant,p_actor);
  select i.identity into identity from opera_agent_tx_candidate.run_identities i where tenant_id=p_tenant and transaction_id=p_tx;
  perform opera_agent_tx_candidate.assert_live_identity(p_tenant,p_actor,identity);
  select * into b from opera_agent_tx_candidate.acceptance_bindings where tenant_id=p_tenant and actor_id=p_actor and transaction_id=p_tx for share;
  if not found then raise exception 'AUTHORITY_NOT_RESOLVED'; end if;
  select * into h from opera_agent_private.goal_heads where tenant_id::text=p_tenant and goal_id=b.goal_id for share;
  if not found or h.head_revision<>b.goal_revision or h.head_digest<>b.ledger_digest or h.status not in ('OPEN','PARTIAL') then raise exception 'AUTHORITY_NOT_RESOLVED'; end if;
  select * into r from opera_agent_tx_candidate.runs where tenant_id=p_tenant and actor_id=p_actor and transaction_id=p_tx for update;
  if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  perform opera_agent_tx_candidate.assert_lease(r,p_epoch,p_fence);
  select metadata into preview from opera_agent_tx_candidate.run_previews where tenant_id=p_tenant and transaction_id=p_tx;
  if not found or p_challenge is null or jsonb_typeof(p_challenge)<>'object' or octet_length(p_challenge::text)>4096
    or (select array_agg(k order by k) from jsonb_object_keys(p_challenge) k) is distinct from
      array['approvalChallengeId','approvalDigest','authenticatedOAuthClientId','authenticatedUserId','effectClass','expiresAt','goalRevision','issuedAt','nonceDigest','prepareDigest','previewDigest','protocolEra','schemaVersion','targetDigest','tenantId','transactionId']::text[]
    then raise exception 'APPROVAL_MISMATCH'; end if;
  foreach key in array array['approvalChallengeId','authenticatedOAuthClientId','authenticatedUserId','tenantId','transactionId'] loop
    if jsonb_typeof(p_challenge->key) is distinct from 'string' or p_challenge->>key !~ '^[A-Za-z0-9_-]{1,128}$' then raise exception 'APPROVAL_MISMATCH'; end if;
  end loop;
  foreach key in array array['approvalDigest','nonceDigest','prepareDigest','previewDigest','targetDigest'] loop
    if jsonb_typeof(p_challenge->key) is distinct from 'string' or p_challenge->>key !~ '^sha256:[0-9a-f]{64}$' then raise exception 'APPROVAL_MISMATCH'; end if;
  end loop;
  if p_challenge->>'schemaVersion' is distinct from 'OA_APPROVAL_V1' or p_challenge->>'protocolEra' is distinct from 'MCP_2026_07_28'
    or p_challenge->>'approvalDigest' is distinct from opera_agent_tx_candidate.metadata_digest(p_challenge-'approvalDigest')
    or p_challenge->>'tenantId' is distinct from p_tenant or p_challenge->>'transactionId' is distinct from p_tx
    or p_challenge->>'authenticatedUserId' is distinct from identity->>'userId'
    or p_challenge->>'authenticatedOAuthClientId' is distinct from identity->>'oauthClientId'
    or p_challenge->>'prepareDigest' is distinct from r.prepare_digest or p_challenge->>'targetDigest' is distinct from r.target_digest
    or p_challenge->'goalRevision' is distinct from preview->'goalRevision' or p_challenge->'effectClass' is distinct from preview->'effectClass'
    or p_challenge->>'previewDigest' is distinct from preview->>'previewDigest'
    or p_challenge->>'issuedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$'
    or p_challenge->>'expiresAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$'
    then raise exception 'APPROVAL_MISMATCH'; end if;
  issued:=(p_challenge->>'issuedAt')::timestamptz; expiry:=(p_challenge->>'expiresAt')::timestamptz;
  perform opera_agent_tx_candidate.assert_live_identity(p_tenant,p_actor,identity);
  stamp:=clock_timestamp();
  if h.expires_at<=stamp then raise exception 'AUTHORITY_NOT_RESOLVED'; end if;
  ttl:=(extract(epoch from expiry-issued)*1000)::integer;
  if issued<r.prepared_at or issued>stamp or expiry<=stamp or expiry>r.expires_at or ttl<1
    or ttl>opera_agent_tx_candidate.tx_limit(p_tenant,p_tx,'approvalLifetimeMs',120000) then raise exception 'APPROVAL_EXPIRED'; end if;
  select challenge into prior from opera_agent_tx_candidate.run_challenges where tenant_id=p_tenant and transaction_id=p_tx;
  if found then
    if prior is distinct from p_challenge then raise exception 'IDEMPOTENCY_COLLISION'; end if;
    return opera_agent_tx_candidate.snapshot(r,true);
  end if;
  if r.status<>'AWAITING_APPROVAL' then raise exception 'INVALID_TRANSITION'; end if;
  insert into opera_agent_tx_candidate.run_challenges values(p_tenant,p_tx,p_challenge);
  insert into opera_agent_tx_candidate.approvals(tenant_id,transaction_id,nonce_digest,approval_digest,user_id,oauth_client_id,approval_ttl_ms,issued_at,expires_at)
    values(p_tenant,p_tx,p_challenge->>'nonceDigest',p_challenge->>'approvalDigest',identity->>'userId',identity->>'oauthClientId',ttl,issued,expiry);
  return opera_agent_tx_candidate.snapshot(r);
end $$;
revoke execute on function public.opera_tx_issue_bound(text,text,text,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.opera_tx_issue_bound(text,text,text,integer,text,jsonb) to service_role;

create function public.opera_tx_finalize_bound(p_tenant text,p_actor text,p_tx text,p_epoch integer,p_fence text,p_nonce text,p_approval text,p_consumption text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare b opera_agent_tx_candidate.acceptance_bindings; identity jsonb; h record; r opera_agent_tx_candidate.runs; challenge jsonb;
begin
  perform opera_agent_tx_candidate.assert_dark(p_tenant,p_actor);
  select i.identity into identity from opera_agent_tx_candidate.run_identities i where tenant_id=p_tenant and transaction_id=p_tx;
  perform opera_agent_tx_candidate.assert_live_identity(p_tenant,p_actor,identity);
  select * into b from opera_agent_tx_candidate.acceptance_bindings where tenant_id=p_tenant and actor_id=p_actor and transaction_id=p_tx for share;
  if not found then raise exception 'AUTHORITY_NOT_RESOLVED'; end if;
  select * into h from opera_agent_private.goal_heads where tenant_id::text=p_tenant and goal_id=b.goal_id for share;
  if not found or h.head_revision<>b.goal_revision or h.head_digest<>b.ledger_digest or h.status not in ('OPEN','PARTIAL')
    or h.expires_at<=clock_timestamp() then raise exception 'AUTHORITY_NOT_RESOLVED'; end if;
  select * into r from opera_agent_tx_candidate.runs where tenant_id=p_tenant and actor_id=p_actor and transaction_id=p_tx for update;
  if not found or r.prepare_digest is distinct from b.metadata->>'preparedDigest' or r.target_digest is distinct from b.metadata->'target'->>'targetDigest'
    then raise exception 'AUTHORITY_NOT_RESOLVED'; end if;
  perform opera_agent_tx_candidate.assert_live_identity(p_tenant,p_actor,identity);
  if h.expires_at<=clock_timestamp() then raise exception 'AUTHORITY_NOT_RESOLVED'; end if;
  select c.challenge into challenge from opera_agent_tx_candidate.run_challenges c where tenant_id=p_tenant and transaction_id=p_tx;
  if not found or challenge->>'nonceDigest' is distinct from p_nonce or challenge->>'approvalDigest' is distinct from p_approval
    or p_consumption is distinct from opera_agent_tx_candidate.metadata_digest(jsonb_build_object(
      'approvalDigest',p_approval,'nonceDigest',p_nonce,'transactionId',p_tx,'prepareDigest',r.prepare_digest))
    then raise exception 'APPROVAL_MISMATCH'; end if;
  return opera_agent_tx_candidate.finalize_dark(p_tenant,p_actor,p_tx,p_epoch,p_fence,p_nonce,p_approval,p_consumption);
end $$;
revoke execute on function public.opera_tx_finalize_bound(text,text,text,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.opera_tx_finalize_bound(text,text,text,integer,text,text,text,text) to service_role;
create function public.opera_tx_metadata(p_operation text,p_tenant text,p_actor text,p_identity jsonb,p_tx text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if p_operation='status' then
    perform opera_agent_tx_candidate.assert_live_identity(p_tenant,p_actor,p_identity);
    return opera_agent_tx_candidate.read_run(p_tenant,p_actor,p_tx);
  end if;
  if p_operation='cancel' then

    perform pg_advisory_xact_lock(hashtextextended(p_tenant,814));
    perform 1 from opera_agent_tx_candidate.runs where tenant_id=p_tenant and actor_id=p_actor and transaction_id=p_tx for update;
    perform opera_agent_tx_candidate.assert_live_identity(p_tenant,p_actor,p_identity);
    return opera_agent_tx_candidate.cancel(p_tenant,p_actor,p_tx);
  end if;
  raise exception 'INVALID_REQUEST';
end $$;
revoke execute on function public.opera_tx_metadata(text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.opera_tx_metadata(text,text,text,jsonb,text) to service_role;
alter table opera_agent_tx_candidate.policy enable row level security;
alter table opera_agent_tx_candidate.acceptance_bindings enable row level security;
alter table opera_agent_tx_candidate.principals enable row level security;
alter table opera_agent_tx_candidate.rates enable row level security;
alter table opera_agent_tx_candidate.runs enable row level security;
alter table opera_agent_tx_candidate.run_identities enable row level security;
alter table opera_agent_tx_candidate.run_limits enable row level security;
alter table opera_agent_tx_candidate.run_previews enable row level security;
alter table opera_agent_tx_candidate.run_challenges enable row level security;
alter table opera_agent_tx_candidate.journal enable row level security;
alter table opera_agent_tx_candidate.approvals enable row level security;
alter table opera_agent_tx_candidate.commit_slots enable row level security;
revoke all on all tables in schema opera_agent_tx_candidate from public,anon,authenticated;
revoke execute on all functions in schema opera_agent_tx_candidate from public,anon,authenticated;
grant select,insert,update,delete on all tables in schema opera_agent_tx_candidate to service_role;
grant execute on all functions in schema opera_agent_tx_candidate to service_role;
commit;
