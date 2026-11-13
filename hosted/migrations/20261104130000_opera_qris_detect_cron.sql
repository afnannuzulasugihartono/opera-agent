-- The automatic detector: pg_cron calls the billing function every five minutes.

-- WHY THE TOKEN LIVES IN VAULT AND NOT IN THIS FILE.
-- The operator token closes invoices, so it is a secret, and a migration file is in git forever.
-- The cron function reads it from vault.decrypted_secrets; until the owner puts it there, the job answers "no token" and moves nothing.

create or replace function public.opera_qris_detect_cron()
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_token text;
  v_response record;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'opera_billing_token' limit 1;
  if v_token is null or v_token = '' then
    return jsonb_build_object('ok', false, 'why', 'opera_billing_token is not in vault');
  end if;
  select * into v_response from net.http_post(
    url := 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-billing',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || v_token),
    body := jsonb_build_object('action', 'qris-detect')
  );
  return jsonb_build_object('ok', true, 'status_code', v_response.status_code, 'body', v_response.body);
end $$;

revoke all on function public.opera_qris_detect_cron() from public, anon, authenticated;
grant execute on function public.opera_qris_detect_cron() to service_role;

-- WHY EVERY FIVE MINUTES.
-- A payment that is noticed five minutes late is not lost, it is late; the invoice stays open until the next run.
-- Shorter than that and the feed's rate limits become the bottleneck, which the 2026-11-02 probe warned about.

select cron.schedule('opera-qris-detect', '*/5 * * * *', 'select public.opera_qris_detect_cron()');
