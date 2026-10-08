-- Docs read flow v1 (2026-10-08): open a Google Doc and return one bounded canvas screenshot for the MODEL to read. The device captures (cheap, local); interpretation spends the caller model tokens, never server vision budget. Canvas body text is invisible to DOM and AX by construction.
--
-- No public MCP tool/schema, protocol, primitive, VM, signing, auth, or
-- transport boundary changes are introduced here.

select public.opera_register_workflow(
  'docs.read_page',
  $wf${"steps":[{"id":"open","type":"command","method":"tabs.open","params":{"url":{"$ref":"input.url"},"active":false,"wait":true}},{"name":"tabId","type":"set","value":{"$ref":"steps.open.result.tab.id"}},{"id":"canvas","type":"command","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"canvas","timeoutMs":15000}},{"id":"shot","type":"command","method":"page.capture","params":{"tabId":{"$ref":"vars.tabId"},"quality":40,"maxWidth":800}},{"id":"tab","type":"command","method":"tabs.get","params":{"tabId":{"$ref":"vars.tabId"}}}],"output":{"title":{"$ref":"steps.tab.result.tab.title"},"url":{"$ref":"steps.tab.result.tab.url"},"screenshot":{"$ref":"steps.shot.result.screenshot"}}}$wf$,
  'Open a Google Doc in a background tab and return one bounded screenshot of its canvas for the calling model to read.',
  true
);
