-- docs.apply_heading v1: style the current paragraph via Ctrl+Alt+level, type optional text on the styled-empty paragraph, break, reset to Normal, then prove a heading role in the snapshot; menu fallback on mismatch.

DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.opera_workflows WHERE name = 'docs.apply_heading') THEN
    select public.opera_register_workflow(
      'docs.apply_heading',
      $wf${"steps":[{"id":"styleBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"key","key":{"$ref":"input.level"},"modifiers":["control","alt"]}]}},{"id":"writeBlock","type":"if","condition":{"op":"exists","left":{"$ref":"input.text"}},"then":[{"id":"typeBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"key","text":{"$ref":"input.text"}}]}},{"id":"breakBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"key","text":"\n"}]}},{"id":"resetBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"key","key":"0","modifiers":["control","alt"]}]}}],"else":[]},{"id":"styleCheck","type":"command","method":"page.read","params":{"tabId":{"$ref":"input.tabId"},"limit":2000,"maxElements":10}},{"id":"appliedYes","type":"if","condition":{"op":"contains","left":{"$ref":"steps.styleCheck.result.page.axSummary"},"right":"heading"},"then":[{"name":"applied","type":"set","value":true}],"else":[{"id":"menuFallback","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"find","text":"Format"},{"action":"hover","refFromStep":0},{"action":"find","text":"Paragraph styles"},{"action":"hover","refFromStep":2},{"action":"find","text":{"$concat":["Heading ",{"$ref":"input.level"}]}},{"action":"click","refFromStep":4}]}},{"id":"styleRecheck","type":"command","method":"page.read","params":{"tabId":{"$ref":"input.tabId"},"limit":2000,"maxElements":10}},{"id":"appliedAgain","type":"if","condition":{"op":"contains","left":{"$ref":"steps.styleRecheck.result.page.axSummary"},"right":"heading"},"then":[{"name":"applied","type":"set","value":true}],"else":[{"name":"applied","type":"set","value":false}]}]}],"output":{"applied":{"$ref":"vars.applied"},"style":{"$concat":["heading",{"$ref":"input.level"}]}}}$wf$,
      'Style the current paragraph as a heading by shortcut with a menu fallback, and prove the style.',
      true
);
  END IF;
END
$body$;
