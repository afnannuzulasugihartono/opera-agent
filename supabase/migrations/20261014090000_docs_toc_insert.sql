-- docs.toc_insert v1: Insert > Table of contents, pick the numbered style,
-- then prove entries rendered or fail naming the miss.
select public.opera_register_workflow(
  'docs.toc_insert',
  $wf${"steps":[{"id":"tocBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"find","text":"Insert"},{"action":"hover","refFromStep":0},{"action":"find","text":"Table of contents"},{"action":"hover","refFromStep":2},{"action":"find","text":"page numbers"},{"action":"click","refFromStep":4}]}},{"id":"tocCheck","type":"command","method":"page.read","params":{"tabId":{"$ref":"input.tabId"},"limit":2000,"maxElements":30}},{"id":"tocProved","type":"if","condition":{"op":"exists","left":{"$ref":"steps.tocCheck.result.page.elements.0"}},"then":[],"else":[{"id":"noToc","type":"fail","code":"TOC_MISSING","message":"No table of contents rendered after insert."}]}],"output":{"entries":{"$ref":"steps.tocCheck.result.page.elements"}}}$wf$,
  'Insert a table of contents and prove entries rendered.',
  true
);
