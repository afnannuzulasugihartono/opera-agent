-- Docs append flow v1 (2026-10-08): open a Google Doc and type text into its canvas editor, verified by screenshot-hash change instead of vision.
-- Click-then-type through the trusted path; the fixed canvas point is a v1 limitation.

-- No public MCP tool/schema, protocol, primitive, VM, signing, auth, or transport boundary changes are introduced here.

select public.opera_register_workflow(
  'docs.append_text',
  $wf${"steps":[{"id":"open","type":"command","method":"tabs.open","params":{"url":{"$ref":"input.url"},"active":false,"wait":true}},{"name":"tabId","type":"set","value":{"$ref":"steps.open.result.tab.id"}},{"id":"canvas","type":"command","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"canvas","timeoutMs":15000}},{"id":"capBefore","type":"command","method":"page.capture","params":{"tabId":{"$ref":"vars.tabId"},"quality":40,"maxWidth":800},"continueOnError":true},{"id":"focus","type":"command","method":"page.pointer","params":{"tabId":{"$ref":"vars.tabId"},"action":"click","x":750,"y":400}},{"id":"type","type":"command","method":"page.key","params":{"tabId":{"$ref":"vars.tabId"},"text":{"$ref":"input.text"},"trusted":true}},{"id":"capAfter","type":"command","method":"page.capture","params":{"tabId":{"$ref":"vars.tabId"},"quality":40,"maxWidth":800},"continueOnError":true},{"id":"changed","type":"if","condition":{"op":"ne","left":{"$ref":"steps.capAfter.result.screenshot.sha256"},"right":{"$ref":"steps.capBefore.result.screenshot.sha256"}},"then":[{"name":"verified","type":"set","value":true}],"else":[{"id":"nochange","type":"fail","code":"NO_CHANGE_DETECTED","message":"Canvas pixels unchanged after typing."}]},{"id":"tab","type":"command","method":"tabs.get","params":{"tabId":{"$ref":"vars.tabId"}}}],"output":{"verified":{"$ref":"vars.verified"},"before":{"$ref":"steps.capBefore.result.screenshot.sha256"},"after":{"$ref":"steps.capAfter.result.screenshot.sha256"},"title":{"$ref":"steps.tab.result.tab.title"},"url":{"$ref":"steps.tab.result.tab.url"}}}$wf$,
  'Open a Google Doc in a background tab and append text to its canvas editor via trusted input, verified by pixel change.',
  true
);
