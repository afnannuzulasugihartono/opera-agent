create schema if not exists opera_agent_private;
revoke all on schema opera_agent_private from public, anon, authenticated;

create table opera_agent_private.goal_heads (
  tenant_id uuid not null,
  goal_id text not null,
  head_revision integer not null,
  head_digest text not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (tenant_id, goal_id),
  constraint goal_heads_goal_id_format check (goal_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  constraint goal_heads_revision_bound check (head_revision between 1 and 2147483647),
  constraint goal_heads_digest_format check (head_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint goal_heads_status check (status in ('OPEN', 'PARTIAL', 'SATISFIED', 'BLOCKED', 'CANCELLED', 'EXPIRED')),
  constraint goal_heads_expiry_bound check (expires_at > created_at and expires_at <= created_at + interval '7 days'),
  constraint goal_heads_updated_order check (updated_at >= created_at)
);

alter table opera_agent_private.goal_heads enable row level security;
revoke all on table opera_agent_private.goal_heads from public, anon, authenticated;
grant usage on schema opera_agent_private to service_role;
grant select, insert, update, delete on table opera_agent_private.goal_heads to service_role;

create index goal_heads_cleanup_idx
  on opera_agent_private.goal_heads (expires_at, updated_at)
  where status in ('CANCELLED', 'EXPIRED');

insert into public.loa_v3_config (key, value)
values ('milestone6_ledger_enabled', 'false')
on conflict (key) do nothing;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'opera_agent_ledger_token_v1') then
    perform vault.create_secret(
      rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '='),
      'opera_agent_ledger_token_v1',
      'AES-256-GCM key for opaque Opera Agent goal-ledger tokens'
    );
  end if;
end
$$;

create or replace function public.opera_goal_crypto_key()
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
   where key = 'milestone6_ledger_enabled';

  if not coalesce(v_enabled, false) then
    return jsonb_build_object('enabled', false);
  end if;

  select decrypted_secret
    into v_key
    from vault.decrypted_secrets
   where name = 'opera_agent_ledger_token_v1'
   order by created_at desc
   limit 1;

  if v_key is null then
    raise exception using errcode = '55000', message = 'ledger key is unavailable';
  end if;

  return jsonb_build_object('enabled', true, 'key', v_key);
end
$$;

create or replace function public.opera_goal_head_get(p_tenant_id uuid, p_goal_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, opera_agent_private
as $$
declare
  v_enabled boolean;
  v_head opera_agent_private.goal_heads%rowtype;
begin
  select coalesce(value = 'true', false)
    into v_enabled
    from public.loa_v3_config
   where key = 'milestone6_ledger_enabled';
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('ok', false, 'code', 'FEATURE_DISABLED', 'error', 'Milestone 6 ledger is disabled.');
  end if;

  select * into v_head
    from opera_agent_private.goal_heads
   where tenant_id = p_tenant_id and goal_id = p_goal_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'HEAD_NOT_FOUND', 'error', 'Ledger head was not found.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'goalId', v_head.goal_id,
    'headRevision', v_head.head_revision,
    'headDigest', v_head.head_digest,
    'status', v_head.status,
    'createdAt', v_head.created_at,
    'updatedAt', v_head.updated_at,
    'expiresAt', v_head.expires_at
  );
end
$$;

create or replace function public.opera_goal_head_apply(
  p_tenant_id uuid,
  p_goal_id text,
  p_expected_revision integer,
  p_expected_digest text,
  p_new_revision integer,
  p_new_digest text,
  p_new_status text,
  p_created_at timestamptz,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, opera_agent_private
as $$
declare
  v_enabled boolean;
  v_head opera_agent_private.goal_heads%rowtype;
begin
  select coalesce(value = 'true', false)
    into v_enabled
    from public.loa_v3_config
   where key = 'milestone6_ledger_enabled';
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('ok', false, 'code', 'FEATURE_DISABLED', 'error', 'Milestone 6 ledger is disabled.');
  end if;

  if p_goal_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     or p_new_digest !~ '^sha256:[0-9a-f]{64}$'
     or p_new_status not in ('OPEN', 'PARTIAL', 'SATISFIED', 'BLOCKED', 'CANCELLED', 'EXPIRED')
     or p_new_revision < 1
     or p_new_revision > 2147483647
     or p_expires_at <= p_created_at
     or p_expires_at > p_created_at + interval '7 days' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_HEAD', 'error', 'Ledger head metadata is invalid.');
  end if;

  if p_expected_revision = 0 then
    if p_expected_digest is not null or p_new_revision <> 1 or p_new_status <> 'OPEN' or p_expires_at <= now() then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INITIAL_HEAD', 'error', 'Initial ledger head metadata is invalid.');
    end if;
    insert into opera_agent_private.goal_heads (
      tenant_id, goal_id, head_revision, head_digest, status, created_at, updated_at, expires_at
    ) values (
      p_tenant_id, p_goal_id, p_new_revision, p_new_digest, p_new_status, p_created_at, now(), p_expires_at
    ) on conflict (tenant_id, goal_id) do nothing;
  end if;

  select * into v_head
    from opera_agent_private.goal_heads
   where tenant_id = p_tenant_id and goal_id = p_goal_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'HEAD_NOT_FOUND', 'error', 'Ledger head was not found.');
  end if;

  if v_head.head_revision = p_new_revision
     and v_head.head_digest = p_new_digest
     and v_head.status = p_new_status
     and v_head.created_at = p_created_at
     and v_head.expires_at = p_expires_at then
    if v_head.expires_at <= now() and v_head.status not in ('CANCELLED', 'EXPIRED') then
      return jsonb_build_object('ok', false, 'code', 'LEDGER_EXPIRED', 'error', 'Ledger head has expired.');
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'headRevision', v_head.head_revision, 'headDigest', v_head.head_digest, 'status', v_head.status);
  end if;

  if p_expected_revision = 0 then
    return jsonb_build_object('ok', false, 'code', 'GOAL_EXISTS', 'error', 'A different ledger already exists for this goal.');
  end if;
  if v_head.expires_at <= now() and p_new_status <> 'EXPIRED' then
    return jsonb_build_object('ok', false, 'code', 'LEDGER_EXPIRED', 'error', 'Ledger head has expired.');
  end if;
  if v_head.status in ('CANCELLED', 'EXPIRED') then
    return jsonb_build_object('ok', false, 'code', 'TERMINAL_LEDGER', 'error', 'A terminal ledger cannot be changed.');
  end if;
  if v_head.head_revision <> p_expected_revision or v_head.head_digest <> p_expected_digest then
    return jsonb_build_object('ok', false, 'code', 'STALE_HEAD', 'error', 'Expected revision and digest do not match the current head.');
  end if;
  if p_new_revision <> p_expected_revision + 1 or p_created_at <> v_head.created_at then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION', 'error', 'Ledger revision transition is invalid.');
  end if;

  update opera_agent_private.goal_heads
     set head_revision = p_new_revision,
         head_digest = p_new_digest,
         status = p_new_status,
         updated_at = now(),
         expires_at = p_expires_at
   where tenant_id = p_tenant_id and goal_id = p_goal_id;

  return jsonb_build_object('ok', true, 'replayed', false, 'headRevision', p_new_revision, 'headDigest', p_new_digest, 'status', p_new_status);
end
$$;

create or replace function public.opera_goal_cleanup(p_retention_seconds integer default 86400)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, opera_agent_private
as $$
declare
  v_deleted integer;
begin
  if p_retention_seconds < 3600 or p_retention_seconds > 604800 then
    raise exception using errcode = '22023', message = 'retention must be between 3600 and 604800 seconds';
  end if;
  delete from opera_agent_private.goal_heads
   where expires_at < now() - make_interval(secs => p_retention_seconds)
      or (status in ('CANCELLED', 'EXPIRED') and updated_at < now() - make_interval(secs => p_retention_seconds));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;

revoke all on function public.opera_goal_crypto_key() from public, anon, authenticated;
revoke all on function public.opera_goal_head_get(uuid, text) from public, anon, authenticated;
revoke all on function public.opera_goal_head_apply(uuid, text, integer, text, integer, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.opera_goal_cleanup(integer) from public, anon, authenticated;
grant execute on function public.opera_goal_crypto_key() to service_role;
grant execute on function public.opera_goal_head_get(uuid, text) to service_role;
grant execute on function public.opera_goal_head_apply(uuid, text, integer, text, integer, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.opera_goal_cleanup(integer) to service_role;
