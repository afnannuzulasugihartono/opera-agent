-- A table this function writes is not a table anyone with the publishable key may write.

-- WHY THIS MIGRATION EXISTS.
-- The log that tells a real notification from a forged one was created with a grant for service_role, and nothing took back the grant a new table gets for anon and authenticated.
-- Measured on 2026-11-03: opera_notification_log carried INSERT, SELECT, UPDATE and DELETE for anon and authenticated, with RLS off and no policy.
-- The publishable key ships in the extension, so anyone could write a row about a payment that never came, or erase the row about one that did.
-- The function writes and reads with service_role, which keeps its grant, so nothing the product does changes.

revoke all on public.opera_notification_log from anon, authenticated;

-- WHY THE ROW IS WRITTEN HERE TOO.
-- This repository applies its migrations by hand, so the file that a reader can re-run is also the file that records the apply.
-- The row is the same one the ledger reads, and it is written once: a second apply finds it already there.

insert into supabase_migrations.schema_migrations(version, statements)
values ('20261103120000', ARRAY['revoke all on opera_notification_log from anon, authenticated'])
on conflict (version) do nothing;
