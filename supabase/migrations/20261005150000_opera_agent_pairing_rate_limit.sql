-- Rate-limit pairing code issuance per account.
--
-- WHY this file: ROADMAP lists a pairing rate limit as a precondition for mass
-- distribution. Without it, anyone with an account can mint codes as fast as the
-- endpoint allows, and every code invalidates the previous one, so a hostile
-- account can lock a legitimate user out of pairing by racing them.
--
-- The cap is per issuing account over a rolling window, measured in the same
-- table the codes already live in, so it needs no new table and no scheduler.
--
-- APPLY: paste into the Supabase dashboard SQL editor.

create or replace function public.opera_create_pairing_code(
  p_device_name text default 'opera',
  p_ttl_minutes integer default 10,
  p_issued_by uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_code text; v_expires timestamptz; v_issuer uuid; v_recent integer;
begin
  if p_device_name is null or char_length(trim(p_device_name)) not between 1 and 64 then return jsonb_build_object('ok', false, 'error', 'Invalid device name.'); end if;
  p_ttl_minutes := least(greatest(coalesce(p_ttl_minutes, 10), 1), 60);
  v_issuer := coalesce(p_issued_by, auth.uid());

  if v_issuer is not null then
    select count(*) into v_recent
    from public.opera_pairing_codes
    where issued_by = v_issuer and created_at > now() - interval '1 hour';
    if v_recent >= 5 then
      insert into public.opera_audit(event_type, details) values ('pairing_code.rate_limited', jsonb_build_object('issuer', v_issuer, 'recent', v_recent));
      return jsonb_build_object('ok', false, 'error', 'Too many pairing codes this hour. Try again later.');
    end if;
  end if;

  update public.opera_pairing_codes set consumed_at = now() where device_name = trim(p_device_name) and consumed_at is null;
  v_code := upper(substr(encode(gen_random_bytes(12), 'hex'), 1, 16));
  v_expires := now() + make_interval(mins => p_ttl_minutes);
  insert into public.opera_pairing_codes(code_hash, device_name, expires_at, issued_by)
  values (public.opera_sha256(v_code), trim(p_device_name), v_expires, v_issuer);
  insert into public.opera_audit(event_type, details) values ('pairing_code.created', jsonb_build_object('deviceName', trim(p_device_name)));
  return jsonb_build_object('ok', true, 'deviceName', trim(p_device_name), 'code', v_code, 'expiresAt', v_expires);
end $$;

grant execute on function public.opera_create_pairing_code(text, integer, uuid) to authenticated;
revoke execute on function public.opera_create_pairing_code(text, integer, uuid) from public, anon;