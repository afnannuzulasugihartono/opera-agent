-- docs.page_setup v1: File > Page setup dialog, margins and orientation filled by label, OK, dialog-gone proof.
-- Margins travel as strings.

DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.opera_workflows WHERE name = 'docs.page_setup') THEN
    select public.opera_register_workflow(
      'docs.page_setup',
      $wf${"steps":[{"id":"dialogBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"find","text":"File"},{"action":"hover","refFromStep":0},{"action":"find","text":"Page setup"},{"action":"click","refFromStep":2}]}},{"id":"dialogOpen","type":"command","method":"page.wait_for","params":{"tabId":{"$ref":"input.tabId"},"selector":"[role='dialog']","timeoutMs":5000}},{"id":"marginsBlock","type":"if","condition":{"op":"exists","left":{"$ref":"input.margins"}},"then":[{"id":"fillMargins","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"find","text":"Top"},{"action":"fill","refFromStep":0,"value":{"$ref":"input.margins.top"}},{"action":"find","text":"Bottom"},{"action":"fill","refFromStep":2,"value":{"$ref":"input.margins.bottom"}},{"action":"find","text":"Left"},{"action":"fill","refFromStep":4,"value":{"$ref":"input.margins.left"}},{"action":"find","text":"Right"},{"action":"fill","refFromStep":6,"value":{"$ref":"input.margins.right"}}]}}],"else":[]},{"id":"orientBlock","type":"if","condition":{"op":"exists","left":{"$ref":"input.orientation"}},"then":[{"id":"orientBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"find","text":{"$ref":"input.orientation"}},{"action":"click","refFromStep":0}]}}],"else":[]},{"id":"okBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"find","text":"OK"},{"action":"click","refFromStep":0}]}},{"id":"dialogGone","type":"command","method":"page.query","params":{"tabId":{"$ref":"input.tabId"},"selector":"[role='dialog']","limit":1}},{"id":"stuckCheck","type":"if","condition":{"op":"exists","left":{"$ref":"steps.dialogGone.result.item"}},"then":[{"id":"dialogStuck","type":"fail","code":"DIALOG_STUCK","message":"Page setup dialog did not close."}],"else":[]}],"output":{"applied":true}}$wf$,
      'Apply page setup margins and orientation through the dialog, proved closed.',
      true
);
  END IF;
END
$body$;
