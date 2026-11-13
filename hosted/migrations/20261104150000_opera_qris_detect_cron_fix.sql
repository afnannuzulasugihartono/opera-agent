-- The scheduled detector asks pg_net for a request, not for an answer.

-- WHY THE FIRST VERSION WAS WRONG.
-- net.http_post returns the id of the request it queued, not the response, so reading the HTTP status off its result raised a column error on every run and the schedule moved nothing.
-- The response arrives in net._http_response under that id, and the operator reads it there.

create or replace function public.opera_qris_detect_cron()
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_token text;
  v_request_id bigint;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'opera_billing_token' limit 1;
  if v_token is null or v_token = '' then
    return jsonb_build_object('ok', false, 'why', 'opera_billing_token is not in vault');
  end if;
  v_request_id := net.http_post(
    url := 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-billing',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || v_token),
    body := jsonb_build_object('action', 'qris-detect')
  );
  return jsonb_build_object('ok', true, 'request_id', v_request_id);
end $$;

revoke all on function public.opera_qris_detect_cron() from public, anon, authenticated;
grant execute on function public.opera_qris_detect_cron() to service_role;
