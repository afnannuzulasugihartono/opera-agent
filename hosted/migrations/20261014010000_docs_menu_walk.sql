-- docs.menu_walk v1: keyboard channel probe, then a hover chain that walks every level of input.path with proof.
-- The walk OPENS the path; the caller acts on the opened menu with a fresh ref.
-- No raw coordinates anywhere.

DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.opera_workflows WHERE name = 'docs.menu_walk') THEN
    select public.opera_register_workflow(
      'docs.menu_walk',
      $wf${"steps":[{"id":"compactCheck","type":"command","method":"page.query","params":{"tabId":{"$ref":"input.tabId"},"selector":"[aria-label='Show menus'], [aria-label='Tampilkan menu']","limit":1},"continueOnError":true},{"id":"expandCompact","type":"if","condition":{"op":"exists","left":{"$ref":"steps.compactCheck.result.item"}},"then":[{"id":"expandIt","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"key","key":"F","modifiers":["control","shift"]}]}}],"else":[]},{"id":"keyboardRoad","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"key","key":"F","modifiers":["alt"]}]},"continueOnError":true},{"id":"keyboardOk","type":"command","method":"page.wait_for","params":{"tabId":{"$ref":"input.tabId"},"selector":"[role='menu'][aria-expanded='true'], [role='menubar'] [aria-expanded='true']","timeoutMs":1500},"continueOnError":true},{"id":"keyboardClose","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"key","key":"Escape"}]},"continueOnError":true},{"id":"hoverRoad","type":"foreach","items":{"$ref":"input.path"},"itemVar":"level","steps":[{"id":"levelBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"find","text":{"$ref":"vars.level"}},{"action":"hover","refFromStep":0}]}},{"id":"levelProve","type":"command","method":"page.wait_for","params":{"tabId":{"$ref":"input.tabId"},"selector":"[role='menu']","timeoutMs":2000}}]},{"name":"walkMethod","type":"set","value":"hover"}],"output":{"walked":{"$ref":"input.path"},"method":{"$ref":"vars.walkMethod"},"labelsTried":{"$ref":"input.labels"}}}$wf$,
      'Walk a menu path by keyboard first, hover chain fallback, with proof at each level.',
      true
);
  END IF;
END
$body$;
