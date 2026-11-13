-- The relay keeps its own list of the methods it may run, and it had drifted from the extension's.
-- Two methods the extension serves were missing from it, so the hosted tools that call them were refused by name for as long as the list was short - "Method is not allowlisted" - and two that were listed carried a shorter budget than the extension's own, so a slow read was cut short by the server rather than by the page.

-- WHY THE LIST IS SEEDED FROM THE CONTRACT INSTEAD OF PATCHED BY HAND.
-- The contract lives in one file, extension/lib/protocol.js, and a list kept somewhere else can only drift.
-- Every method of that contract is written here with the timeout the contract gives it, so the two cannot disagree about which methods exist.

-- WHY THE LOCAL LOOP AND THE PLAN METHOD ARE LEFT ALONE.
-- The loop methods are the device's own, never enqueued by the relay, and the plan method is switched off on purpose.

insert into public.opera_methods (method, default_timeout_ms, enabled) values
  ('browser.ping', 3000, true),
  ('browser.burst', 12000, true),
  ('tabs.list', 5000, true),
  ('tabs.get', 5000, true),
  ('tabs.find', 5000, true),
  ('tabs.open', 10000, true),
  ('tabs.activate', 5000, true),
  ('tabs.close', 5000, true),
  ('tabs.navigate', 15000, true),
  ('tabs.reload', 15000, true),
  ('page.read', 30000, true),
  ('page.query', 8000, true),
  ('page.find', 8000, true),
  ('page.collect_links', 10000, true),
  ('page.click', 8000, true),
  ('page.pointer', 8000, true),
  ('page.capture', 30000, true),
  ('page.fill', 8000, true),
  ('page.focus', 5000, true),
  ('page.scroll', 5000, true),
  ('page.key', 5000, true),
  ('page.stream', 30000, true),
  ('page.wait_for', 15000, true),
  ('media.state', 5000, true),
  ('media.play', 5000, true),
  ('media.pause', 5000, true),
  ('media.seek', 5000, true),
  ('media.stream_start', 15000, true),
  ('media.stream_stop', 15000, true),
  ('statement.download', 55000, true),
  ('statement.manifest', 5000, true),
  ('extension.update', 55000, true)
on conflict (method) do update set default_timeout_ms = excluded.default_timeout_ms, enabled = excluded.enabled;

-- WHY THE OLD ROWS THAT BELONG TO NOBODY ARE NOT TOUCHED.
-- The device's own loop methods and the disabled plan method are not part of the contract, so they keep the state they were given.
