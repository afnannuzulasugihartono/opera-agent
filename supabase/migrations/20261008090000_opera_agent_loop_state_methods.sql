-- MAIN-world frame-rate state loop methods (MCP loop_state_start/read/stop).
INSERT INTO public.opera_methods(method, default_timeout_ms, description) VALUES
  ('loop.state_start', 15000, 'Start a MAIN-world frame-rate state loop; returns a loopId immediately.'),
  ('loop.state_read', 15000, 'Read a state loop trace and counters.'),
  ('loop.state_stop', 15000, 'Stop a state loop and return its final trace.')
ON CONFLICT (method) DO NOTHING;
