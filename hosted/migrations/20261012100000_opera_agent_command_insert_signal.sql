-- Signal the device channel from the insert itself, so every writer is fast (2026-10-12).

-- WHY THIS FILE EXISTS

-- The bridge learns about new work through postgres_changes, measured 650-1000 ms from insert to claim.
-- A broadcast on the device channel lands in tens of milliseconds, but signalling from the enqueue caller costs that caller a round trip and only covers callers that were taught to signal.
-- The insert is the one thing every writer has in common — gateway, MCP, consoles, dashboards — so the signal is emitted here, once, for all of them.

-- pg_net posts asynchronously: http_post queues and returns immediately, adding single-digit milliseconds to the insert, and a background worker delivers it.
-- Measured after applying: direct SQL inserts claim in ~200-300 ms instead of ~700 ms.

-- WHY failures are swallowed.
-- The broadcast is an optimization, not the source of truth: the row already exists, and the bridge still listens to postgres_changes as backup.
-- A trigger that threw would break every insert in the product, so any failure returns NEW unchanged.
-- Slow and correct always beats fast and broken.

-- WHY the publishable key.
-- The broadcast endpoint authenticates on apikey alone, and this key is public by design — it already ships in landing/*.html.
-- No secret lives in this function.
-- A forged signal can only trigger an extra empty claim, because claiming still requires the device token the bridge holds.

-- WHY the device name is validated.
-- It becomes a URL path segment verbatim, and the row reaching this trigger was written by pairing code, not by this function.
-- Anything outside the expected shape skips the signal rather than addressing a channel the bridge never subscribed to.

create or replace function public.opera_signal_device()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device_name text;
  v_request_id bigint;
begin
  select d.device_name into v_device_name
  from public.opera_devices d
  where d.id = NEW.device_id;

  if v_device_name is null or v_device_name !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' then
    return NEW;
  end if;

  begin
    select net.http_post(
      url := 'https://nenmkmtvjremqphfqnfw.supabase.co/realtime/v1/api/broadcast/opera-commands-' || v_device_name || '/events/new-command',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'sb_publishable_jAbS_QIQsmXQA-Rj8RWPcg_JVeBedJ6'
      ),
      body := jsonb_build_object('commandId', NEW.id)
    ) into v_request_id;
  exception when others then
    return NEW;
  end;

  return NEW;
end;
$$;

drop trigger if exists opera_commands_signal on public.opera_commands;

create trigger opera_commands_signal
  after insert on public.opera_commands
  for each row
  execute function public.opera_signal_device();

comment on function public.opera_signal_device() is
  'Best-effort broadcast on command insert so the bridge learns in milliseconds. Failures return NEW: postgres_changes is the backup.';
