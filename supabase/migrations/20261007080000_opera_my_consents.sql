-- Let a signed-in account see and revoke the OAuth consents it granted, so an
-- approved application can be cut off without asking the owner.
--
-- WHY revoke is three writes, not one: marking oauth_consents.revoked_at stops
-- future refreshes from being treated as consented, but live sessions and their
-- refresh tokens keep working until they are gone. All three are scoped by
-- auth.uid(), so one account cannot list or cut another account's access.
--
-- APPLY: paste into the Supabase dashboard SQL editor. CI never applies
-- migrations, and the dashboard is the only writer that matters here.

create or replace function public.opera_my_consents()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  return jsonb_build_object('ok', true, 'consents', coalesce((
    select jsonb_agg(jsonb_build_object(
      'clientId', c.client_id, 'clientName', cl.client_name,
      'scopes', c.scopes, 'grantedAt', c.granted_at
    ) order by c.granted_at desc)
    from auth.oauth_consents c join auth.oauth_clients cl on cl.id = c.client_id
    where c.user_id = v_uid and c.revoked_at is null
  ), '[]'::jsonb));
end $$;

create or replace function public.opera_revoke_consent(p_client_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  if p_client_id is null then return jsonb_build_object('ok', false, 'error', 'No such consent on this account.'); end if;
  update auth.refresh_tokens set revoked = true
  where session_id in (select id from auth.sessions where user_id = v_uid and oauth_client_id = p_client_id);
  delete from auth.sessions where user_id = v_uid and oauth_client_id = p_client_id;
  update auth.oauth_consents set revoked_at = now()
  where user_id = v_uid and client_id = p_client_id and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'No such consent on this account.'); end if;
  insert into public.opera_audit(event_type, details) values ('consent.revoked', jsonb_build_object('clientId', p_client_id));
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.opera_my_consents() from public, anon;
revoke execute on function public.opera_revoke_consent(uuid) from public, anon;
grant execute on function public.opera_my_consents() to authenticated;
grant execute on function public.opera_revoke_consent(uuid) to authenticated;
