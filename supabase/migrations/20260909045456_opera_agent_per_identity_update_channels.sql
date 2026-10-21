-- Allow the legacy and replacement signing identities to publish independently.
-- A browser update request is always resolved by its extension ID; one identity must never receive another identity's CRX.

drop index if exists public.opera_releases_one_active_idx;

alter table public.opera_releases
  drop constraint if exists opera_releases_pkey;

alter table public.opera_releases
  add primary key (extension_id, version);

create unique index opera_releases_one_active_per_identity_idx
  on public.opera_releases (extension_id)
  where active = true;
