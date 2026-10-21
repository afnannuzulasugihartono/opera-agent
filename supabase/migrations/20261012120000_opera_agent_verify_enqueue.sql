-- Verify and enqueue in one round trip (2026-10-12).

-- WHY THIS FILE EXISTS

-- The gateway verified the device token and enqueued the command as two sequential RPCs: two edge-to-database round trips on every single command.
-- Each hop measures tens of milliseconds same-region, so the split costs roughly a hundred milliseconds per command for no behavioral reason.
-- This function does both checks and the enqueue in one call.

-- WHY it delegates instead of duplicating.
-- The allowlist check, the timeout clamp, the request-id dedup, and the audit write already exist inside opera_enqueue, tested and pinned.
-- Authentication already exists inside opera_verify_device — including the seven-day idle expiry, which the older opera_auth_device does not enforce.
-- Copying any of that logic here would create places for it to drift, so this function authenticates, checks freshness, and hands off.
-- opera_enqueue itself is untouched and still serves the OAuth path, which has no device token to verify.

-- WHY the offline check lives inside rather than with the caller.
-- An offline device must never produce a row: the bridge would claim it, push to a dead socket, and strand it as claimed until expiry.
-- Returning before the enqueue keeps that invariant exactly where the gateway kept it.

-- Error shapes mirror what the gateway produced from the split calls, so the only observable change is one fewer round trip.

create or replace function public.opera_verify_enqueue(
  p_token_hash text,
  p_device_name text,
  p_method text,
  p_params jsonb default '{}'::jsonb,
  p_timeout_ms integer default null,
  p_request_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth jsonb;
  v_seen timestamptz;
begin
  v_auth := public.opera_verify_device(p_device_name, p_token_hash);
  if coalesce((v_auth->>'ok')::boolean, false) = false then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized device.');
  end if;

  v_seen := (v_auth->>'last_seen_at')::timestamptz;
  if v_seen is null or v_seen < now() - interval '90 seconds' then
    return jsonb_build_object('ok', false, 'error', 'Device is offline.', 'lastSeenAt', v_seen);
  end if;

  return public.opera_enqueue(p_method, p_params, p_timeout_ms, p_device_name, p_request_id);
end;
$$;

revoke all on function public.opera_verify_enqueue(text, text, text, jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.opera_verify_enqueue(text, text, text, jsonb, integer, text) to service_role;

comment on function public.opera_verify_enqueue(text, text, text, jsonb, integer, text) is
  'Authenticated enqueue in one round trip: token check, 90-second freshness check, then opera_enqueue. Error shapes match what the gateway produced from the split calls.';
