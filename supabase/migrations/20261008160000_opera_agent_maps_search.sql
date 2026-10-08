-- Maps search flow v1 (2026-10-08): open a Maps search URL and return the results-list text in one run, so restaurant search costs a single model round trip. Same resilient shape as youtube.watch_summarize (open, tolerant wait, bounded chunked read, tab metadata); the model ranks and summarizes from the text payload.
--
-- No public MCP tool/schema, protocol, primitive, VM, signing, auth, or
-- transport boundary changes are introduced here.

select public.opera_register_workflow(
  'maps.search',
  $wf${"steps":[{"id":"open","type":"command","method":"tabs.open","params":{"url":{"$concat":["https://www.google.com/maps/search/",{"$ref":"input.query"}]},"active":false,"wait":true}},{"name":"tabId","type":"set","value":{"$ref":"steps.open.result.tab.id"}},{"id":"resultsFirst","type":"command","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"text":"Results","timeoutMs":15000},"continueOnError":true},{"id":"resultsAgain","type":"command","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"text":"Results","timeoutMs":15000}},{"name":"text","type":"set","value":""},{"name":"offset","type":"set","value":0},{"id":"chunks","type":"repeat","steps":[{"id":"read","type":"command","method":"page.read","params":{"limit":6000,"tabId":{"$ref":"vars.tabId"},"offset":{"$ref":"vars.offset"},"maxElements":1,"includeElements":false}},{"name":"text","type":"set","value":{"$concat":[{"$ref":"vars.text"},{"$ref":"steps.read.result.page.text"}]}},{"name":"offset","type":"set","value":{"$ref":"steps.read.result.page.nextOffset"}}],"until":{"op":"falsey","left":{"$ref":"steps.read.result.page.hasMore"}},"failOnLimit":false,"maxIterations":3},{"id":"tab","type":"command","method":"tabs.get","params":{"tabId":{"$ref":"vars.tabId"}}}],"output":{"title":{"$ref":"steps.tab.result.tab.title"},"url":{"$ref":"steps.tab.result.tab.url"},"text":{"$ref":"vars.text"}}}$wf$,
  'Open a Google Maps search URL in a background tab and return the results-list text plus title and url, in one supervised run.',
  true
);
