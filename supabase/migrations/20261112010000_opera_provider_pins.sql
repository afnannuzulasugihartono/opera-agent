-- One row per (account, provider) picks the browser this provider drives.
-- A pin is what turns "opencode" and "claude" into "the Brave profile" and "the Chrome profile" without changing either client's config.
-- Without a pin, routing is the server's: the X-Opera-Device header chooses, falling back to the freshest awake browser - exactly what happened before this table existed.
-- A header pin explicitly sent for a call still wins over the stored pin, because a caller who writes the header asked for that browser by name and naming one browser is a stronger ask than remembering a past one.

create table if not exists public.opera_provider_pins (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  device_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

comment on table public.opera_provider_pins is 'Per (account, provider) pin naming the browser this provider drives. Read at device resolution time; written by the switch_device MCP tool. Never exposed to or readable by any role other than the service role.';

alter table public.opera_provider_pins enable row level security;

-- WHY THERE IS NO POLICY AND THE ROW STAYS SERVICE-ROLE.
-- The pin is hidden by construction: the service role reads it, nothing else can.
-- An anonymous or authenticated select would leak which browser a given provider is allowed to drive, which is not the caller's information.

create index if not exists opera_provider_pins_user_idx on public.opera_provider_pins (user_id);
