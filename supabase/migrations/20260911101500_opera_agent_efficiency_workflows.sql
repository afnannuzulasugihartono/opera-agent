-- Opera Agent server-side efficiency improvements.
-- This migration intentionally leaves the MV3 extension and legacy FINAL2 fallback untouched.
-- The goal is to reduce browser round-trips while preserving generic primitives and workflow rollback.

select public.opera_register_workflow(
  'browser.ensure_tab',
  '{
    "steps":[
      {"type":"set","id":"default_active","name":"active","value":false},
      {"type":"if","id":"active_override","condition":{"left":{"$ref":"input.active"},"op":"exists"},"then":[
        {"type":"set","name":"active","value":{"$ref":"input.active"}}
      ],"else":[]},
      {"type":"command","id":"find","method":"tabs.find","params":{"urlContains":{"$ref":"input.urlContains"},"limit":20}},
      {"type":"if","id":"reuse_or_open","condition":{"left":{"$ref":"steps.find.result.tab"},"op":"exists"},"then":[
        {"type":"set","name":"tabId","value":{"$ref":"steps.find.result.tab.id"}},
        {"type":"if","condition":{"left":{"$ref":"vars.active"},"op":"eq","right":true},"then":[
          {"type":"command","id":"activate","method":"tabs.activate","params":{"tabId":{"$ref":"vars.tabId"},"focusWindow":true}}
        ],"else":[]}
      ],"else":[
        {"type":"command","id":"open","method":"tabs.open","params":{"url":{"$ref":"input.url"},"active":{"$ref":"vars.active"},"wait":false}},
        {"type":"set","name":"tabId","value":{"$ref":"steps.open.result.tab.id"}}
      ]},
      {"type":"if","id":"optional_wait","condition":{"left":{"$ref":"input.readySelector"},"op":"exists"},"then":[
        {"type":"command","id":"ready","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":{"$ref":"input.readySelector"},"timeoutMs":{"$ref":"input.waitTimeoutMs"}}}
      ],"else":[]},
      {"type":"command","id":"tab","method":"tabs.get","params":{"tabId":{"$ref":"vars.tabId"}}}
    ],
    "output":{"tab":{"$ref":"steps.tab.result.tab"},"reused":{"$ref":"steps.find.result.tab"}}
  }'::jsonb,
  'Reuse a matching tab when possible, otherwise open one without waiting for full page completion. Optionally wait for a caller-supplied readiness selector.',
  true
);

select public.opera_register_workflow(
  'page.read_all',
  '{
    "steps":[
      {"type":"set","id":"default_limit","name":"limit","value":12000},
      {"type":"set","id":"default_elements","name":"maxElements","value":1},
      {"type":"set","id":"default_offset","name":"offset","value":0},
      {"type":"set","id":"default_text","name":"text","value":""},
      {"type":"if","id":"limit_override","condition":{"left":{"$ref":"input.limit"},"op":"exists"},"then":[
        {"type":"set","name":"limit","value":{"$ref":"input.limit"}}
      ],"else":[]},
      {"type":"if","id":"elements_override","condition":{"left":{"$ref":"input.maxElements"},"op":"exists"},"then":[
        {"type":"set","name":"maxElements","value":{"$ref":"input.maxElements"}}
      ],"else":[]},
      {"type":"if","id":"offset_override","condition":{"left":{"$ref":"input.offset"},"op":"exists"},"then":[
        {"type":"set","name":"offset","value":{"$ref":"input.offset"}}
      ],"else":[]},
      {"type":"repeat","id":"chunks","maxIterations":20,"failOnLimit":false,"steps":[
        {"type":"command","id":"read","method":"page.read","params":{"tabId":{"$ref":"input.tabId"},"offset":{"$ref":"vars.offset"},"limit":{"$ref":"vars.limit"},"maxElements":{"$ref":"vars.maxElements"}}},
        {"type":"set","name":"text","value":{"$concat":[{"$ref":"vars.text"},{"$ref":"steps.read.result.page.text"}]}},
        {"type":"set","name":"offset","value":{"$ref":"steps.read.result.page.nextOffset"}}
      ],"until":{"left":{"$ref":"steps.read.result.page.hasMore"},"op":"eq","right":false}}
    ],
    "output":{
      "documentId":{"$ref":"steps.read.result.page.documentId"},
      "title":{"$ref":"steps.read.result.page.title"},
      "url":{"$ref":"steps.read.result.page.url"},
      "text":{"$ref":"vars.text"},
      "totalTextChars":{"$ref":"steps.read.result.page.totalTextChars"},
      "nextOffset":{"$ref":"steps.read.result.page.nextOffset"},
      "hasMore":{"$ref":"steps.read.result.page.hasMore"},
      "chunkSize":{"$ref":"vars.limit"}
    }
  }'::jsonb,
  'Read a page adaptively in up to 20 bounded chunks. Defaults to 12,000 characters and one interactive element per chunk to minimize payload overhead while remaining caller-configurable.',
  true
);

select public.opera_register_workflow(
  'research.read_url_fast',
  '{
    "steps":[
      {"type":"command","id":"open","method":"tabs.open","params":{"url":{"$ref":"input.url"},"active":false,"wait":false}},
      {"type":"if","id":"optional_wait","condition":{"left":{"$ref":"input.readySelector"},"op":"exists"},"then":[
        {"type":"command","id":"ready","method":"page.wait_for","params":{"tabId":{"$ref":"steps.open.result.tab.id"},"selector":{"$ref":"input.readySelector"},"timeoutMs":{"$ref":"input.waitTimeoutMs"}}}
      ],"else":[]},
      {"type":"set","name":"limit","value":12000},
      {"type":"set","name":"offset","value":0},
      {"type":"set","name":"text","value":""},
      {"type":"if","condition":{"left":{"$ref":"input.limit"},"op":"exists"},"then":[
        {"type":"set","name":"limit","value":{"$ref":"input.limit"}}
      ],"else":[]},
      {"type":"repeat","id":"chunks","maxIterations":20,"failOnLimit":false,"steps":[
        {"type":"command","id":"read","method":"page.read","params":{"tabId":{"$ref":"steps.open.result.tab.id"},"offset":{"$ref":"vars.offset"},"limit":{"$ref":"vars.limit"},"maxElements":1}},
        {"type":"set","name":"text","value":{"$concat":[{"$ref":"vars.text"},{"$ref":"steps.read.result.page.text"}]}},
        {"type":"set","name":"offset","value":{"$ref":"steps.read.result.page.nextOffset"}}
      ],"until":{"left":{"$ref":"steps.read.result.page.hasMore"},"op":"eq","right":false}},
      {"type":"command","id":"close","method":"tabs.close","params":{"tabId":{"$ref":"steps.open.result.tab.id"}},"continueOnError":true}
    ],
    "output":{
      "title":{"$ref":"steps.read.result.page.title"},
      "url":{"$ref":"steps.read.result.page.url"},
      "text":{"$ref":"vars.text"},
      "totalTextChars":{"$ref":"steps.read.result.page.totalTextChars"},
      "nextOffset":{"$ref":"steps.read.result.page.nextOffset"},
      "hasMore":{"$ref":"steps.read.result.page.hasMore"}
    }
  }'::jsonb,
  'Open a background URL without waiting for full network-idle completion, optionally wait for a useful selector, then read adaptive 12k chunks and close the tab.',
  true
);

-- YouTube remains a server-side workflow only. The extension stays site-agnostic.
-- This replaces the old unconditional ad polling loop with an immediate fast path when no ad is present.
select public.opera_register_workflow(
  'youtube.play_recommendation',
  '{
    "steps":[
      {"type":"command","id":"find","method":"tabs.find","params":{"urlContains":"youtube.com","limit":10}},
      {"type":"if","condition":{"left":{"$ref":"steps.find.result.tab"},"op":"exists"},"then":[
        {"type":"set","name":"tabId","value":{"$ref":"steps.find.result.tab.id"}},
        {"type":"command","id":"activate","method":"tabs.activate","params":{"tabId":{"$ref":"vars.tabId"}}}
      ],"else":[
        {"type":"command","id":"openyt","method":"tabs.open","params":{"url":"https://www.youtube.com/","active":true,"wait":false}},
        {"type":"set","name":"tabId","value":{"$ref":"steps.openyt.result.tab.id"}}
      ]},
      {"type":"command","id":"home","method":"tabs.navigate","params":{"tabId":{"$ref":"vars.tabId"},"url":"https://www.youtube.com/","wait":false}},
      {"type":"command","id":"waitrecs","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"a#thumbnail[href*=\"watch\"], a.yt-lockup-view-model__content-image[href*=\"watch\"]","timeoutMs":10000}},
      {"type":"command","id":"rec","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":"a#thumbnail[href*=\"watch\"], a.yt-lockup-view-model__content-image[href*=\"watch\"]","index":{"$ref":"input.index"},"limit":30}},
      {"type":"if","condition":{"left":{"$ref":"steps.rec.result.item.href"},"op":"exists"},"then":[],"else":[{"type":"fail","code":"RECOMMENDATION_NOT_FOUND","message":"No recommendation URL was found."}]},
      {"type":"command","id":"openrec","method":"tabs.navigate","params":{"tabId":{"$ref":"vars.tabId"},"url":{"$ref":"steps.rec.result.item.href"},"wait":false}},
      {"type":"command","id":"waitvideo","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"video","timeoutMs":10000}},
      {"type":"command","id":"adinitial","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":".ad-showing, .ytp-ad-player-overlay","index":0,"limit":5},"continueOnError":true},
      {"type":"if","id":"ads_if_present","condition":{"left":{"$ref":"steps.adinitial.result.item"},"op":"exists"},"then":[
        {"type":"repeat","id":"ads","maxIterations":12,"failOnLimit":false,"steps":[
          {"type":"command","id":"skip","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":".ytp-ad-skip-button-modern, .ytp-ad-skip-button, button.ytp-skip-ad-button","index":0,"limit":5}},
          {"type":"if","condition":{"left":{"$ref":"steps.skip.result.item"},"op":"exists"},"then":[
            {"type":"command","id":"skipclick","method":"page.click","params":{"tabId":{"$ref":"vars.tabId"},"ref":{"$ref":"steps.skip.result.item.ref"},"trusted":true},"continueOnError":true}
          ],"else":[]},
          {"type":"wait","ms":250},
          {"type":"command","id":"adstate","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":".ad-showing, .ytp-ad-player-overlay","index":0,"limit":5},"continueOnError":true}
        ],"until":{"left":{"$ref":"steps.adstate.result.item"},"op":"not_exists"}}
      ],"else":[
        {"type":"set","name":"noAdFastPath","value":true}
      ]},
      {"type":"command","id":"play","method":"media.play","params":{"tabId":{"$ref":"vars.tabId"},"index":0},"continueOnError":true},
      {"type":"command","id":"media","method":"media.state","params":{"tabId":{"$ref":"vars.tabId"},"index":0}},
      {"type":"command","id":"tab","method":"tabs.get","params":{"tabId":{"$ref":"vars.tabId"}}}
    ],
    "output":{"tab":{"$ref":"steps.tab.result.tab"},"recommendation":{"$ref":"steps.rec.result.item"},"media":{"$ref":"steps.media.result.media"},"ad":{"$ref":"steps.adstate.result.item"},"noAdFastPath":{"$ref":"vars.noAdFastPath"}}
  }'::jsonb,
  'Open a YouTube recommendation with SPA-aware waits and an immediate no-ad fast path; ad polling only runs when an ad is actually detected.',
  true
);
