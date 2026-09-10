-- Register the bounded, linear same-tab burst primitive shipped by Opera Agent 1.2.0.
-- The extension performs its own independent action/shape validation. This row only
-- allows the durable command queue to accept the named primitive.

insert into public.opera_methods(method, default_timeout_ms, enabled, description)
values (
  'browser.burst',
  12000,
  true,
  'Execute 1-8 validated page actions sequentially on one tab with no loops, branches, navigation, or arbitrary code.'
)
on conflict (method) do update
set default_timeout_ms = excluded.default_timeout_ms,
    enabled = excluded.enabled,
    description = excluded.description;

insert into public.opera_audit(event_type, details)
values (
  'browser.burst.registered',
  jsonb_build_object(
    'extensionVersion', '1.2.0',
    'protocolVersion', 1,
    'maxSteps', 8,
    'maxTimeoutMs', 12000,
    'sameTabOnly', true
  )
);
