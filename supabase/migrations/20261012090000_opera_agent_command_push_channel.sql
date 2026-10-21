-- Put opera_commands in the realtime publication, so a device socket can be told about work instead of asking for it (2026-10-12).

-- WHY THIS FILE EXISTS

-- The device used to POST /pull every 500 ms to learn whether work existed.
-- The push transport replaces that with one held socket and a database change channel, which only works if the table is actually in the publication.
-- It was not: supabase_realtime existed and was empty of tables, so a deployed socket would have connected, completed its handshake, and then sat silent forever while looking perfectly healthy.

-- That failure mode is the reason this is stated rather than discovered.
-- A socket that never receives a command is indistinguishable from an idle device unless someone checks the publication.

-- WHY only opera_commands, and only INSERT

-- The publication is the blast radius.
-- Every table added to it is replicated to every subscriber of every channel on it, so the list is kept to the one table a device acts on.
-- Updates and deletes stay enabled on the publication because that is a property of the publication itself and the subscriber filter is what narrows delivery to the INSERT the bridge needs.

-- Replica identity stays default.
-- A subscriber reading only the INSERT needs the new row in full, which the default identity already provides; FULL identity would add a replica per update for no reader that asks for one.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'opera_commands'
  ) then
    alter publication supabase_realtime add table public.opera_commands;
  end if;
end $$;

comment on table public.opera_commands is
  'Queued device work. In supabase_realtime so the bridge can push a command to the device socket the moment a row appears, instead of the device polling for it.';
