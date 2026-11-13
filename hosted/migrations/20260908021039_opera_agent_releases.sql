-- Opera Agent signed extension release registry.
-- CRX payloads are stored privately and served only through the public update Edge function.

create table if not exists public.opera_releases (
  version text primary key check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  extension_id text not null check (extension_id ~ '^[a-p]{32}$'),
  crx_base64 text not null check (char_length(crx_base64) between 100 and 5000000),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists opera_releases_one_active_idx
  on public.opera_releases ((active)) where active = true;

alter table public.opera_releases enable row level security;
revoke all on public.opera_releases from public, anon, authenticated;

grant select on public.opera_releases to service_role;
