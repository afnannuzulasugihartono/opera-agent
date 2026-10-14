-- docs.make_list v1: toggle bullets or numbers, type each item with its
-- newline inside the payload, then prove every item landed or fail naming it.
DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.opera_workflows WHERE name = 'docs.make_list') THEN
    select public.opera_register_workflow(
      'docs.make_list',
      $wf${"steps":[{"id":"toggleBullets","type":"if","condition":{"op":"eq","left":{"$ref":"input.kind"},"right":"bullet"},"then":[{"id":"bulletBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"key","key":"8","modifiers":["control","shift"]}]}}],"else":[]},{"id":"toggleNumbers","type":"if","condition":{"op":"eq","left":{"$ref":"input.kind"},"right":"number"},"then":[{"id":"numberBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"key","key":"7","modifiers":["control","shift"]}]}}],"else":[]},{"id":"itemsLoop","type":"foreach","items":{"$ref":"input.items"},"itemVar":"item","steps":[{"id":"typeBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"key","text":{"$concat":[{"$ref":"vars.item"},"\n"]}}]}}]},{"id":"finalRead","type":"command","method":"page.read","params":{"tabId":{"$ref":"input.tabId"},"limit":6000,"maxElements":10}},{"id":"verifyLoop","type":"foreach","items":{"$ref":"input.items"},"itemVar":"item","steps":[{"id":"checkItem","type":"if","condition":{"op":"contains","left":{"$ref":"steps.finalRead.result.page.text"},"right":{"$ref":"vars.item"}},"then":[],"else":[{"id":"missingItem","type":"fail","code":"ITEM_MISSING","message":"A list item is not in the document."}]}]}],"output":{"expected":{"$ref":"input.items"},"verified":true,"count":{"$ref":"input.items"}}}$wf$,
      'Toggle a list, type each item, and prove every item landed or fail naming it.',
      true
);
  END IF;
END
$body$;
