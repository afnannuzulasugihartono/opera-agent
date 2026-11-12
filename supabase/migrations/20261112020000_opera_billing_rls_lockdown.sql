-- The billing tables are the product's money trail, and they sat in schema public with RLS disabled.
-- PostgREST exposes public to the internet, and the anon key is embedded in the site by design, so anyone who knew the tables existed could read invoices and rewrite the price list.
-- The billing edge function reads and writes these tables as the service role, which bypasses RLS, so enabling it with no policies changes nothing for the one legitimate client and closes every other door.
-- No policies exist on purpose: nothing else is meant to query these tables, from any role, ever.

alter table public.opera_price_list enable row level security;
alter table public.opera_invoices enable row level security;
alter table public.opera_notification_log enable row level security;
