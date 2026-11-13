-- Opera Agent v2 release registry.

-- WHY this file exists at all: migration 20261010090000 builds a policy on public.opera_v2_releases, and that table was created in the live project without ever being written down here.
-- The tree therefore could not rebuild the database it claimed to describe, and the policy migration could not be applied to a fresh project at all — it would stop on a relation that did not exist.
-- This file states the table so the migrations are the whole truth.
-- It is timestamped BEFORE 20261010090000 because that migration depends on it.

-- WHY create if not exists: the live table is already correct, so re-running this must not touch it.
-- The definition below is what the live table already is, read from information_schema rather than guessed.

create table if not exists public.opera_v2_releases (
  version text primary key,
  extension_id text not null,
  crx_base64 text not null,
  sha256 text not null,
  size_bytes integer not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  notes text not null default ''
);

create unique index if not exists opera_v2_releases_one_active_idx
  on public.opera_v2_releases ((active)) where active = true;

alter table public.opera_v2_releases enable row level security;
revoke all on public.opera_v2_releases from public, anon, authenticated;

grant select on public.opera_v2_releases to service_role;