-- docs.insert_image v1: By-URL road through Insert > Image, or upload road that sets the hidden file input from bytes.
-- Caption paragraph after.

DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.opera_workflows WHERE name = 'docs.insert_image') THEN
    select public.opera_register_workflow(
      'docs.insert_image',
      $wf${"steps":[{"name":"placed","type":"set","value":false},{"id":"urlRoad","type":"if","condition":{"op":"eq","left":{"$ref":"input.source"},"right":"url"},"then":[{"id":"urlOpenBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"find","text":"Insert"},{"action":"hover","refFromStep":0},{"action":"find","text":"Image"},{"action":"hover","refFromStep":2},{"action":"find","text":"By URL"},{"action":"click","refFromStep":4}]}},{"id":"urlFillBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"find","role":"textbox"},{"action":"fill","refFromStep":0,"value":{"$ref":"input.imageUrl"}},{"action":"find","text":"Insert"},{"action":"click","refFromStep":2}]}},{"name":"placed","type":"set","value":true}],"else":[]},{"id":"uploadRoad","type":"if","condition":{"op":"eq","left":{"$ref":"input.source"},"right":"upload"},"then":[{"id":"fileBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"file","filename":{"$ref":"input.filename"},"data":{"$ref":"input.data"}}]}},{"name":"placed","type":"set","value":true}],"else":[]},{"id":"blockCheck","type":"command","method":"page.read","params":{"tabId":{"$ref":"input.tabId"},"limit":2000,"maxElements":10}},{"id":"imageProved","type":"if","condition":{"op":"contains","left":{"$ref":"steps.blockCheck.result.page.axSummary"},"right":"image"},"then":[],"else":[{"id":"noImage","type":"fail","code":"IMAGE_MISSING","message":"No image in the document after insert."}]},{"id":"captionPara","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"key","text":"\n"}]}}],"output":{"placed":{"$ref":"vars.placed"},"captionReady":true}}$wf$,
      'Insert an image by URL or upload bytes, prove the block, ready the caption paragraph.',
      true
);
  END IF;
END
$body$;
