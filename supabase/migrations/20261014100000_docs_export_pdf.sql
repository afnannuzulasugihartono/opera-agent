-- docs.export_pdf v1: File > Download > PDF, then wait for the download feedback signal.
-- Proof is UI feedback, never the filesystem: the download API sits outside the primitives.

DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.opera_workflows WHERE name = 'docs.export_pdf') THEN
    select public.opera_register_workflow(
      'docs.export_pdf',
      $wf${"steps":[{"id":"dlBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"find","text":"File"},{"action":"hover","refFromStep":0},{"action":"find","text":"Download"},{"action":"hover","refFromStep":2},{"action":"find","text":"PDF"},{"action":"click","refFromStep":4}]}},{"id":"dlFeedback","type":"command","method":"page.wait_for","params":{"tabId":{"$ref":"input.tabId"},"text":"Download","timeoutMs":8000}}],"output":{"downloaded":true}}$wf$,
      'Download the document as PDF and prove the feedback signal.',
      true
);
  END IF;
END
$body$;
