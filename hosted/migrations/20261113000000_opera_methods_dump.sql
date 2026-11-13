-- The contract gained one more read-only method for the agent: page.dump.
-- It answers the whole page as one structured object (text, headings, links, scripts, styles), not a viewport and not a downloaded file.
-- WHY A NEW MIGRATION AND NOT AN EDIT OF THE SEEDS: the seeds were applied; editing an applied migration corrupts its checksum.
-- The contract lives in extension/lib/protocol.js, and tests/relay-method-contract.test.mjs pins the seeds against it.

insert into public.opera_methods (method, default_timeout_ms, enabled) values
  ('page.dump', 20000, true)
on conflict (method) do update set default_timeout_ms = excluded.default_timeout_ms, enabled = excluded.enabled;
