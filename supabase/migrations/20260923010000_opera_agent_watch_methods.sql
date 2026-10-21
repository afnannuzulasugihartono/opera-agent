-- U-T follow-up (2026-09-23): seed the internal watch command family into the opera_methods enqueue allowlist.
-- The watch.start/stop/stop_all methods are internal (protocol stays frozen at 26 browser primitives), but the MCP start_watch/stop_watch tools enqueue through opera_enqueue, whose allowlist is this table.
-- The ETW migration shipped the engine and the MCP tools without these rows, so arming failed live with "Method is not allowlisted." (2026-09-23).
-- watch.list stays extension-internal: no MCP tool needs it.

insert into public.opera_methods (method, default_timeout_ms, enabled, description) values
  ('watch.start', 15000, true, 'Arm a device-local watch rule (MCP start_watch).'),
  ('watch.stop', 5000, true, 'Disarm one watch rule (MCP stop_watch).'),
  ('watch.stop_all', 5000, true, 'Disarm every active watch rule (MCP stop_watch stopAll).')
on conflict (method) do update
  set enabled = excluded.enabled,
      default_timeout_ms = excluded.default_timeout_ms,
      description = excluded.description;
