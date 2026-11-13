-- Drop legacy tables from previous products that ran in the same Supabase project.
-- All tables are unused, have no rows, and have no references in the current codebase.

drop table if exists public._oa_wprobe cascade;
drop table if exists public.indomaret_location_offer_drafts cascade;
drop table if exists public.browser_relay_commands cascade;
drop table if exists public.browser_relay_auth cascade;
drop table if exists public.browser_relay_devices cascade;
drop table if exists public.loa_v3_commands cascade;
drop table if exists public.loa_v3_config cascade;
drop table if exists public.loa_v3_devices cascade;
