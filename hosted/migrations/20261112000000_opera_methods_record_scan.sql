-- The contract gained three methods the relay must be allowed to run: page.record_start, page.record_stop (a tab recorded to a webm in Downloads while the agent drives it - clicks, fills, scrolls, whatever the task needs) and page.scan (one self-contained html of the page in Downloads).
-- WHY A NEW MIGRATION AND NOT AN EDIT OF THE SEED: the seed was applied; editing an applied migration corrupts its checksum.
-- This one adds exactly the methods that file names, nothing else, on conflict do update.
-- The contract lives in extension/lib/protocol.js, and tests/relay-method-contract.test.mjs pins this file against it.

insert into public.opera_methods (method, default_timeout_ms, enabled) values
  ('page.record_start', 10000, true),
  ('page.record_stop', 30000, true),
  ('page.scan', 55000, true)
on conflict (method) do update set default_timeout_ms = excluded.default_timeout_ms, enabled = excluded.enabled;
