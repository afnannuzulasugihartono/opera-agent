-- docs.insert_table v3: split menu hover and grid into separate bursts to avoid long single command.
-- The guard keeps a replay quiet: when the workflow already holds this exact definition, registering it again would only bump the version and add an audit row.

DO $body$
DECLARE
  def jsonb := $wf${"steps":[{"id":"openMenu","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"find","text":"Insert"},{"action":"hover","refFromStep":0},{"action":"find","text":"Table"},{"action":"hover","refFromStep":2}]}},{"id":"pickGrid","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"grid","rows":{"$ref":"input.rows"},"cols":{"$ref":"input.cols"}}]}},{"id":"tableCheck","type":"command","method":"page.read","params":{"tabId":{"$ref":"input.tabId"},"limit":2000,"maxElements":10}},{"id":"tableProved","type":"if","condition":{"op":"contains","left":{"$ref":"steps.tableCheck.result.page.axSummary"},"right":"table"},"then":[{"name":"verified","type":"set","value":true}],"else":[{"id":"noTable","type":"fail","code":"TABLE_MISSING","message":"No table in the document after insert."}]}],"output":{"rows":{"$ref":"input.rows"},"cols":{"$ref":"input.cols"},"verified":{"$ref":"vars.verified"}}}$wf$::jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.opera_workflows WHERE name = 'docs.insert_table' AND definition = def
  ) THEN
    PERFORM public.opera_register_workflow(
      'docs.insert_table',
      def,
      'Insert a rows-by-cols table through the Insert menu grid in two bursts, and prove it exists.',
      true
    );
  END IF;
END
$body$;
