-- docs.insert_table v3: split menu hover and grid into separate bursts to avoid long single command.

select public.opera_register_workflow(
  'docs.insert_table',
  $wf${"steps":[{"id":"openMenu","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"find","text":"Insert"},{"action":"hover","refFromStep":0},{"action":"find","text":"Table"},{"action":"hover","refFromStep":2}]}},{"id":"pickGrid","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"grid","rows":{"$ref":"input.rows"},"cols":{"$ref":"input.cols"}}]}},{"id":"tableCheck","type":"command","method":"page.read","params":{"tabId":{"$ref":"input.tabId"},"limit":2000,"maxElements":10}},{"id":"tableProved","type":"if","condition":{"op":"contains","left":{"$ref":"steps.tableCheck.result.page.axSummary"},"right":"table"},"then":[{"name":"verified","type":"set","value":true}],"else":[{"id":"noTable","type":"fail","code":"TABLE_MISSING","message":"No table in the document after insert."}]}],"output":{"rows":{"$ref":"input.rows"},"cols":{"$ref":"input.cols"},"verified":{"$ref":"vars.verified"}}}$wf$,
  'Insert a rows-by-cols table through the Insert menu grid in two bursts, and prove it exists.',
  true
);