-- Remove the insert trigger: the bridge polls instead of subscribing (2026-10-12).

-- WHY THIS FILE EXISTS

-- The trigger broadcast every insert so the bridge would learn in milliseconds.
-- Measured live, the broadcast was accepted in 46 ms but the claim still landed anywhere between 200 and 1300 ms, because the Realtime subscriber websocket held by the edge isolate proved flaky in exactly the same way postgres_changes was: sometimes fast, sometimes silent.
-- Signalling faster into an unreliable subscriber does not make anything reliable.

-- The bridge now claims on a 200 ms interval instead.
-- That is deterministic where the subscriber was not, costs four trivial indexed RPCs per second per connected device, and has no connection to go stale.
-- With nothing left to notify, the trigger is dead weight, and dead weight that fires an HTTP POST on every insert is worse than ordinary dead weight.

-- Forward migration rather than history rewrite: 20261012100000 stays as the record of what was tried and measured.

drop trigger if exists opera_commands_signal on public.opera_commands;

drop function if exists public.opera_signal_device();

insert into supabase_migrations.schema_migrations(version, statements)
values ('20261012110000', ARRAY['drop insert broadcast trigger'])
on conflict (version) do nothing;
