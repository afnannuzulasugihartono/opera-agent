-- Two guards for the automatic QRIS detector: one transaction may close one invoice, and the operator token may live in vault without a human paste.

-- WHY THE INDEX EXISTS.
-- The detector matches money by amount and first-in-first-out, so a bug in that matcher could let one payment close two invoices and credit the wallet twice.
-- The index makes that impossible in the database: a provider transaction id can sit on one invoice only.

create unique index if not exists opera_invoices_provider_transaction_id_idx
  on public.opera_invoices (provider_transaction_id)
  where provider_transaction_id is not null;

-- WHY THIS FUNCTION EXISTS.
-- The scheduled detector runs inside Postgres, and Postgres must prove it is the cron with a secret it can read.
-- The billing function already holds that secret in its environment, so it publishes a copy into vault on its first request instead of asking a human to paste it.

create or replace function public.opera_vault_put(
  p_name text,
  p_secret text,
  p_description text default ''
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
begin
  if p_name is null or btrim(p_name) = '' or p_secret is null or p_secret = '' then
    raise exception 'a secret needs a name and a value';
  end if;
  select id into v_id from vault.decrypted_secrets where name = p_name limit 1;
  if v_id is null then
    perform vault.create_secret(p_secret, p_name, p_description);
  else
    perform vault.update_secret(v_id, p_secret, p_name, p_description);
  end if;
end $$;

-- WHY IT IS CLOSED TO BROWSERS.
-- This writes secrets.
-- Only the server role may call it, and the browser roles may not even see it.

revoke all on function public.opera_vault_put(text, text, text) from public, anon, authenticated;
grant execute on function public.opera_vault_put(text, text, text) to service_role;
