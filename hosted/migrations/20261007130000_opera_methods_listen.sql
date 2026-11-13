-- Register the listening primitives in the method allowlist so opera_enqueue accepts them.
-- Same timeout class as the other media primitives.

insert into public.opera_methods(method, default_timeout_ms, enabled, description) values
  ('media.stream_start', 15000, true, 'Start a tab audio listening session.'),
  ('media.stream_stop', 15000, true, 'Stop the live listening session.')
on conflict (method) do update set default_timeout_ms = excluded.default_timeout_ms,
  enabled = excluded.enabled, description = excluded.description;
