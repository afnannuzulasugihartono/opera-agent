-- Preserve the goal_heads updated_at >= created_at invariant when an Edge Function timestamp is a few milliseconds newer than the transaction start.

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
  v_inserted integer := 0;
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
    if p_expected_digest is not null or p_new_revision <> 1 or p_new_status <> 'OPEN' or p_expires_at <= clock_timestamp() then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INITIAL_HEAD', 'error', 'Initial ledger head metadata is invalid.');
    end if;
    insert into opera_agent_private.goal_heads (
      tenant_id, goal_id, head_revision, head_digest, status, created_at, updated_at, expires_at
    ) values (
      p_tenant_id, p_goal_id, p_new_revision, p_new_digest, p_new_status,
      p_created_at, greatest(clock_timestamp(), p_created_at), p_expires_at
    ) on conflict (tenant_id, goal_id) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then
      return jsonb_build_object('ok', true, 'replayed', false, 'headRevision', p_new_revision, 'headDigest', p_new_digest, 'status', p_new_status);
    end if;
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
    if v_head.expires_at <= clock_timestamp() and v_head.status not in ('CANCELLED', 'EXPIRED') then
      return jsonb_build_object('ok', false, 'code', 'LEDGER_EXPIRED', 'error', 'Ledger head has expired.');
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'headRevision', v_head.head_revision, 'headDigest', v_head.head_digest, 'status', v_head.status);
  end if;

  if p_expected_revision = 0 then
    return jsonb_build_object('ok', false, 'code', 'GOAL_EXISTS', 'error', 'A different ledger already exists for this goal.');
  end if;
  if v_head.expires_at <= clock_timestamp() and p_new_status <> 'EXPIRED' then
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
         updated_at = greatest(clock_timestamp(), v_head.created_at),
         expires_at = p_expires_at
   where tenant_id = p_tenant_id and goal_id = p_goal_id;

  return jsonb_build_object('ok', true, 'replayed', false, 'headRevision', p_new_revision, 'headDigest', p_new_digest, 'status', p_new_status);
end
$$;

revoke all on function public.opera_goal_head_apply(uuid, text, integer, text, integer, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.opera_goal_head_apply(uuid, text, integer, text, integer, text, text, timestamptz, timestamptz) to service_role;
