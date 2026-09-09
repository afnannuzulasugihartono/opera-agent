-- The production database briefly contained an experimental browser.plan method
-- and four v2 workflows. Stable Opera Agent 1.0.1 does not advertise or execute
-- browser.plan, so keep the experiment in history but disable it until a future
-- same-signing-key extension release actually implements and verifies the method.

do $$
declare
  r record;
begin
  for r in
    select name, definition
    from public.opera_workflows
    where name in (
      'browser.v2_status',
      'research.v2_crawl_urls',
      'research.v2_read_current_full',
      'research.v2_read_url_full'
    )
  loop
    perform public.opera_register_workflow(
      r.name,
      r.definition,
      'Quarantined experimental v2 workflow: requires browser.plan, which is not advertised by the stable Opera Agent 1.0.1 extension. Kept in workflow history for future same-key extension work.',
      false
    );
  end loop;

  update public.opera_methods
  set enabled = false
  where method = 'browser.plan';

  insert into public.opera_audit(event_type, details)
  values(
    'experimental_v2.quarantined',
    jsonb_build_object(
      'reason', 'Stable extension 1.0.1 advertises 23 primitives and does not advertise browser.plan',
      'workflows', jsonb_build_array(
        'browser.v2_status',
        'research.v2_crawl_urls',
        'research.v2_read_current_full',
        'research.v2_read_url_full'
      )
    )
  );
end $$;
