-- Staging for raw audio windows awaiting transcription.
-- Rows live only between chunk upload and window transcription; the transcribe step deletes what it consumed (retention 0 for voice).
-- No grants and no policies: only service_role edge code touches this table, never a signed-in account directly.

create table if not exists public.opera_listen_chunks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.opera_listen_sessions(id) on delete cascade,
  seq integer not null,
  audio_base64 text not null,
  mime text not null default 'audio/webm',
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);

create index if not exists opera_listen_chunks_session_seq_idx
  on public.opera_listen_chunks(session_id, seq);

alter table public.opera_listen_chunks enable row level security;
