-- One live listening session per device, enforced by the database.
--
-- WHY a partial unique index and not application logic: opera-agent-listen
-- checked for a live session then inserted, so two concurrent starts both
-- passed the check and inserted duplicates. The extension runs a single
-- in-flight command loop, but any second holder of the device token (a second
-- extension instance, a retry storm) could still double-insert. The index
-- makes the loser fail with unique_violation, and the start path answers the
-- same 409 carrying the live session id instead of a duplicate row.
--
-- WHY partial and not full: ended sessions accumulate per device and must
-- never collide; only one row with status = 'live' may exist per device.
-- Index-only change: no grant, no revoke, no function touched.

create unique index if not exists opera_listen_sessions_device_live_uniq
  on public.opera_listen_sessions(device_id) where status = 'live';
