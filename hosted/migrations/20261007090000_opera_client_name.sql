-- Resolve an OAuth client's display name for provider stamping.
-- The edge functions call this with the client_id claim from an already-verified JWT; it reveals nothing beyond the name, and only for a client that exists.

create or replace function public.opera_client_name(p_client_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if p_client_id is null then return null; end if;
  select client_name into v_name from auth.oauth_clients where id = p_client_id;
  return v_name;
end $$;

revoke execute on function public.opera_client_name(uuid) from public, anon;
grant execute on function public.opera_client_name(uuid) to authenticated;
