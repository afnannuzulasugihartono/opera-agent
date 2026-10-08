-- Browse find flow v2 (2026-10-08): exact matching only; live evidence showed fuzzy fallback returning an unrelated filter button as found. Bounded crawler over any scrollable list. Checks before scrolling so visible targets are never skipped, then scrolls and re-finds until the item appears or the iteration budget runs out, reporting found honestly instead of failing. Generic across sites: Docs lists, Maps results, YouTube comments.
--
-- No public MCP tool/schema, protocol, primitive, VM, signing, auth, or
-- transport boundary changes are introduced here.

select public.opera_register_workflow(
  'browse.find_in_list',
  $wf${"steps":[{"id":"findFirst","type":"command","method":"page.find","params":{"text":{"$ref":"input.text"},"exact":true,"limit":10,"tabId":{"$ref":"input.tabId"}}},{"id":"crawl","type":"repeat","steps":[{"id":"scrollStep","type":"command","method":"page.scroll","params":{"tabId":{"$ref":"input.tabId"},"y":800},"continueOnError":true},{"id":"findN","type":"command","method":"page.find","params":{"text":{"$ref":"input.text"},"exact":true,"limit":10,"tabId":{"$ref":"input.tabId"}}}],"until":{"op":"exists","left":{"$ref":"steps.findN.result.item"}},"failOnLimit":false,"maxIterations":6},{"id":"pick","type":"if","condition":{"op":"exists","left":{"$ref":"steps.findFirst.result.item"}},"then":[{"name":"hit","type":"set","value":{"$ref":"steps.findFirst.result.item"}}],"else":[{"name":"hit","type":"set","value":{"$ref":"steps.findN.result.item"}}]},{"id":"flag","type":"if","condition":{"op":"exists","left":{"$ref":"vars.hit"}},"then":[{"name":"found","type":"set","value":true}],"else":[{"name":"found","type":"set","value":false}]}],"output":{"found":{"$ref":"vars.found"},"ref":{"$ref":"vars.hit.ref"},"label":{"$ref":"vars.hit.label"},"tag":{"$ref":"vars.hit.tag"}}}$wf$,
  'Crawl a scrollable list for text: check first, then scroll and re-find until found or the budget runs out.',
  true
);
