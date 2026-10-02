-- Gateway offline check folded into the auth call (2026-10-03).
--
-- The gateway issued two round trips before enqueue: opera_verify_device for
-- the token, then a REST read of opera_devices.last_seen_at for the 90s
-- offline rule. Both hit the same row, so the second trip is pure overhead:
-- verify already selects the whole device row and discards everything but the
-- name. Returning last_seen_at with the auth answer removes one HTTP round
-- trip per command (4 -> 3: verify, enqueue, await) with identical reachable
-- behavior: bad token still 401s at auth, a stale or missing last_seen_at
-- still refuses before enqueue, and the offline error keeps its lastSeenAt
-- field. Same signature, so the existing service_role grant is retained and
-- the old gateway (which ignores the extra key) keeps working until deploy.
-- Additive only: no rows touched, no grants changed.

create or replace function public.opera_verify_device(p_device_name text, p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_device public.opera_devices%rowtype;
begin
  select * into v_device from public.opera_devices
    where device_name = trim(p_device_name) and token_hash = p_token_hash and status <> 'disabled';
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'deviceName', v_device.device_name, 'last_seen_at', v_device.last_seen_at);
end $$;
