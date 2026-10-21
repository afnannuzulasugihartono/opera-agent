-- docs.menu_walk v2: level one clicks the menubar (hover never opens it), deeper levels hover, every find exact.
-- Each level is proven by the next level's find; the final submenu is proven by the caller's next find.

select public.opera_register_workflow(
  'docs.menu_walk',
  $wf${"steps":[{"id":"compactCheck","type":"command","method":"page.query","params":{"tabId":{"$ref":"input.tabId"},"selector":"[aria-label='Show menus'], [aria-label='Tampilkan menu']","limit":1},"continueOnError":true},{"id":"expandCompact","type":"if","condition":{"op":"exists","left":{"$ref":"steps.compactCheck.result.item"}},"then":[{"id":"expandIt","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"key","key":"F","modifiers":["control","shift"]}]}}],"else":[]},{"id":"hoverRoad","type":"foreach","items":{"$ref":"input.path"},"itemVar":"level","steps":[{"id":"levelOpen","type":"if","condition":{"op":"eq","left":{"$ref":"vars.index"},"right":0},"then":[{"id":"topClick","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"find","text":{"$ref":"vars.level"},"exact":true},{"action":"click","refFromStep":0}]}}],"else":[{"id":"subHover","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"find","text":{"$ref":"vars.level"},"exact":true},{"action":"hover","refFromStep":0}]}}]}]},{"name":"walkMethod","type":"set","value":"hover"}],"output":{"walked":{"$ref":"input.path"},"method":{"$ref":"vars.walkMethod"},"labelsTried":{"$ref":"input.labels"}}}$wf$,
  'Walk a menu path clicking level one and hovering deeper, every find exact, each level proven by the next find.',
  true
);
