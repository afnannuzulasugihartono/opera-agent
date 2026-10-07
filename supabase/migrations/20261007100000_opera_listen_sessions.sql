-- Live audio listening sessions and their transcript segments.
--
-- WHY two tables and not columns on opera_commands: a listening session outlives
-- any single command (tens of minutes, hundreds of segments), and the model polls
-- segments by cursor. Burying that in command rows would mix a stream with a queue.
--
-- WHY no table grants, like opera_devices: owners read their own rows through
-- policies; writers are service_role edge functions. The dashboard gets its own
-- RPC when its UI lands (phase 4), not a grant.
--
-- Privacy: raw audio is never stored here — only transcripts. The ingest path
-- deletes each chunk after transcription (retention 0 for voice).

create table if not exists public.opera_listen_sessions (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.opera_devices(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  tab_id integer,
  status text not null default 'live' check (status in ('live', 'ended')),
  language text not null default 'id',
  window_secs integer not null default 10 check (window_secs between 5 and 60),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.opera_listen_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.opera_listen_sessions(id) on delete cascade,
  seq integer not null,
  start_s numeric not null,
  end_s numeric not null,
  text text not null default '',
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);

create index if not exists opera_listen_segments_session_seq_idx
  on public.opera_listen_segments(session_id, seq);
create index if not exists opera_listen_sessions_device_idx
  on public.opera_listen_sessions(device_id) where status = 'live';

alter table public.opera_listen_sessions enable row level security;
alter table public.opera_listen_segments enable row level security;

create policy opera_listen_sessions_owner_read on public.opera_listen_sessions
  for select to authenticated using (user_id = auth.uid());

create policy opera_listen_segments_owner_read on public.opera_listen_segments
  for select to authenticated using (
    exists (select 1 from public.opera_listen_sessions s where s.id = session_id and s.user_id = auth.uid())
  );
