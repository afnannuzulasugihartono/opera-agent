-- docs.footnote v1: Insert > Footnote, type the note, prove the marker ref.
select public.opera_register_workflow(
  'docs.footnote',
  $wf${"steps":[{"id":"footBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"find","text":"Insert"},{"action":"hover","refFromStep":0},{"action":"find","text":"Footnote"},{"action":"click","refFromStep":2},{"action":"key","text":{"$ref":"input.text"}}]}},{"id":"noteFind","type":"command","method":"page.find","params":{"tabId":{"$ref":"input.tabId"},"text":{"$ref":"input.text"}}}],"output":{"noteId":{"$ref":"steps.noteFind.result.item.ref"}}}$wf$,
  'Insert a footnote, type its text, and prove the note marker ref.',
  true
);
