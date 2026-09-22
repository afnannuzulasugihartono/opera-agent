create table if not exists public.opera_update_events (
  id bigint generated always as identity primary key,
  requested_at timestamptz not null default now(),
  request_kind text not null check (request_kind in ('update_xml', 'crx')),
  method text not null check (method in ('GET', 'HEAD')),
  path text not null,
  query_string text not null default '',
  served_version text not null,
  release_sha256 text not null,
  user_agent text,
  accept_header text
);

alter table public.opera_update_events enable row level security;

revoke all on table public.opera_update_events from anon, authenticated;
revoke all on sequence public.opera_update_events_id_seq from anon, authenticated;

create index if not exists opera_update_events_requested_at_idx
  on public.opera_update_events (requested_at desc);

create index if not exists opera_update_events_kind_requested_at_idx
  on public.opera_update_events (request_kind, requested_at desc);

comment on table public.opera_update_events is
  'Minimal request telemetry for validating passive Opera extension update polling. No IP address is stored.';
