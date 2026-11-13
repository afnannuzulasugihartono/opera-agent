-- Local sense-act loop methods (MCP loop_start/loop_read/loop_stop).

INSERT INTO public.opera_methods(method, default_timeout_ms, description) VALUES
  ('loop.start', 15000, 'Start a device-local sense-act loop; returns a loopId immediately.'),
  ('loop.read', 15000, 'Read a sense-act loop trace and state.'),
  ('loop.stop', 15000, 'Stop a sense-act loop and return its final trace.')
ON CONFLICT (method) DO NOTHING;
