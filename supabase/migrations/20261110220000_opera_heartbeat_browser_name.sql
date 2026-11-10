-- The browser chip on the dashboard was written once, at pairing, and never again.
-- A browser that changed since then, or a browser whose own name the user agent string hides, kept the name it was paired with, so the list showed the same word for browsers that are not the same.
-- The heartbeat already comes every thirty seconds, so it is the honest place to say which browser is talking, and the name it writes is the one the dashboard reads.

-- WHY THE BEAT TAKES A NEW ARGUMENT AND THE OLD ONE IS DROPPED.
-- Postgres keeps an overload with the old signature when a function is replaced under a new one, and two candidates for the same call are ambiguous.
-- The new beat carries the browser name with a default, so every older caller still works, and the old signature is dropped so there is exactly one beat.

create or replace function public.opera_heartbeat(p_device_name text, p_token_hash text, p_extension_version text, p_protocol_version integer, p_capabilities jsonb default '[]'::jsonb, p_browser_name text default '')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare v_id uuid;
begin
  v_id:=public.opera_auth_device(p_device_name,p_token_hash); if v_id is null then return jsonb_build_object('ok',false,'error','Unauthorized device.'); end if;
  update public.opera_devices set
    status='online',
    extension_version=left(coalesce(p_extension_version,''),64),
    protocol_version=coalesce(p_protocol_version,protocol_version),
    capabilities=coalesce(p_capabilities,capabilities),
    -- WHY AN EMPTY NAME LEAVES THE LAST ONE ALONE: a beat from a build that does not know its browser must not erase what the browser already said.
    browser_name=case when trim(coalesce(p_browser_name,'')) = '' then browser_name else left(trim(p_browser_name), 64) end,
    last_seen_at=now(),
    updated_at=now()
  where id=v_id;
  return jsonb_build_object('ok',true,'deviceId',v_id,'serverTime',now());
end $$;

drop function if exists public.opera_heartbeat(text, text, text, integer, jsonb);

revoke all on function public.opera_heartbeat(text, text, text, integer, jsonb, text) from public;
grant execute on function public.opera_heartbeat(text, text, text, integer, jsonb, text) to service_role;
