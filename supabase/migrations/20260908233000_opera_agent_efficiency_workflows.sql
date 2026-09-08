-- Opera Agent efficiency pass.
-- Extension 1.0.1 and all legacy loa_v3_* objects remain untouched.
-- Existing workflow definitions are preserved automatically in opera_workflow_versions.

select public.opera_register_workflow(
  'page.read_complete',
  $wf$
  {
    "steps": [
      {"type":"set","name":"text","value":""},
      {"type":"set","name":"offset","value":0},
      {"type":"repeat","id":"chunks","maxIterations":30,"failOnLimit":false,"steps":[
        {"type":"command","id":"chunk","method":"page.read","params":{"tabId":{"$ref":"input.tabId"},"offset":{"$ref":"vars.offset"},"limit":12000,"maxElements":1}},
        {"type":"set","name":"text","value":{"$concat":[{"$ref":"vars.text"},{"$ref":"steps.chunk.result.page.text"}]}},
        {"type":"set","name":"offset","value":{"$ref":"steps.chunk.result.page.nextOffset"}}
      ],"until":{"left":{"$ref":"steps.chunk.result.page.hasMore"},"op":"falsey"}}
    ],
    "output": {
      "tabId":{"$ref":"input.tabId"},
      "documentId":{"$ref":"steps.chunk.result.page.documentId"},
      "title":{"$ref":"steps.chunk.result.page.title"},
      "url":{"$ref":"steps.chunk.result.page.url"},
      "text":{"$ref":"vars.text"},
      "totalTextChars":{"$ref":"steps.chunk.result.page.totalTextChars"},
      "nextOffset":{"$ref":"steps.chunk.result.page.nextOffset"},
      "hasMore":{"$ref":"steps.chunk.result.page.hasMore"}
    }
  }
  $wf$::jsonb,
  'Read the current document in adaptive 12k semantic chunks with a single external workflow call.',
  true
);

select public.opera_register_workflow(
  'research.read_url',
  $wf$
  {
    "steps": [
      {"type":"set","name":"limit","value":12000},
      {"type":"set","name":"maxElements","value":1},
      {"type":"if","condition":{"left":{"$ref":"input.limit"},"op":"exists"},"then":[{"type":"set","name":"limit","value":{"$ref":"input.limit"}}],"else":[]},
      {"type":"if","condition":{"left":{"$ref":"input.maxElements"},"op":"exists"},"then":[{"type":"set","name":"maxElements","value":{"$ref":"input.maxElements"}}],"else":[]},
      {"type":"command","id":"open","method":"tabs.open","params":{"url":{"$ref":"input.url"},"active":false,"wait":false}},
      {"type":"command","id":"ready","method":"page.wait_for","params":{"tabId":{"$ref":"steps.open.result.tab.id"},"selector":"body","visibleOnly":false,"timeoutMs":8000},"continueOnError":true},
      {"type":"command","id":"read","method":"page.read","params":{"tabId":{"$ref":"steps.open.result.tab.id"},"offset":{"$ref":"input.offset"},"limit":{"$ref":"vars.limit"},"maxElements":{"$ref":"vars.maxElements"}},"continueOnError":true},
      {"type":"command","id":"close","method":"tabs.close","params":{"tabId":{"$ref":"steps.open.result.tab.id"}},"continueOnError":true},
      {"type":"if","condition":{"left":{"$ref":"steps.read.ok"},"op":"falsey"},"then":[{"type":"fail","code":"READ_URL_FAILED","message":"Page read failed after the temporary tab was closed."}],"else":[]}
    ],
    "output":{"page":{"$ref":"steps.read.result.page"}}
  }
  $wf$::jsonb,
  'Open a URL without waiting for every subresource, wait for document readiness, read a bounded semantic chunk, then close the tab.',
  true
);

select public.opera_register_workflow(
  'research.read_url_full',
  $wf$
  {
    "steps": [
      {"type":"command","id":"open","method":"tabs.open","params":{"url":{"$ref":"input.url"},"active":false,"wait":false}},
      {"type":"command","id":"ready","method":"page.wait_for","params":{"tabId":{"$ref":"steps.open.result.tab.id"},"selector":"body","visibleOnly":false,"timeoutMs":8000},"continueOnError":true},
      {"type":"set","name":"text","value":""},
      {"type":"set","name":"offset","value":0},
      {"type":"set","name":"done","value":false},
      {"type":"set","name":"readFailed","value":false},
      {"type":"repeat","id":"chunks","maxIterations":30,"failOnLimit":false,"steps":[
        {"type":"command","id":"chunk","method":"page.read","params":{"tabId":{"$ref":"steps.open.result.tab.id"},"offset":{"$ref":"vars.offset"},"limit":12000,"maxElements":1},"continueOnError":true},
        {"type":"if","condition":{"left":{"$ref":"steps.chunk.ok"},"op":"truthy"},"then":[
          {"type":"set","name":"text","value":{"$concat":[{"$ref":"vars.text"},{"$ref":"steps.chunk.result.page.text"}]}},
          {"type":"set","name":"offset","value":{"$ref":"steps.chunk.result.page.nextOffset"}},
          {"type":"if","condition":{"left":{"$ref":"steps.chunk.result.page.hasMore"},"op":"falsey"},"then":[{"type":"set","name":"done","value":true}],"else":[]}
        ],"else":[
          {"type":"set","name":"readFailed","value":true},
          {"type":"set","name":"done","value":true}
        ]}
      ],"until":{"left":{"$ref":"vars.done"},"op":"truthy"}},
      {"type":"command","id":"close","method":"tabs.close","params":{"tabId":{"$ref":"steps.open.result.tab.id"}},"continueOnError":true},
      {"type":"if","condition":{"left":{"$ref":"vars.readFailed"},"op":"truthy"},"then":[{"type":"fail","code":"READ_URL_FULL_FAILED","message":"Full page read failed after the temporary tab was closed."}],"else":[]}
    ],
    "output": {
      "title":{"$ref":"steps.chunk.result.page.title"},
      "url":{"$ref":"steps.chunk.result.page.url"},
      "text":{"$ref":"vars.text"},
      "totalTextChars":{"$ref":"steps.chunk.result.page.totalTextChars"},
      "nextOffset":{"$ref":"steps.chunk.result.page.nextOffset"},
      "hasMore":{"$ref":"steps.chunk.result.page.hasMore"}
    }
  }
  $wf$::jsonb,
  'Open a URL, read up to 30 adaptive 12k chunks, and close the temporary tab while keeping one external workflow round trip.',
  true
);

select public.opera_register_workflow(
  'research.crawl_urls',
  $wf$
  {
    "steps": [
      {"type":"foreach","id":"crawl","items":{"$ref":"input.urls"},"itemVar":"url","maxItems":20,"parallel":true,"maxConcurrency":4,"collectVar":"pages","steps":[
        {"type":"command","id":"open","method":"tabs.open","params":{"url":{"$ref":"vars.url"},"active":false,"wait":false}},
        {"type":"command","id":"ready","method":"page.wait_for","params":{"tabId":{"$ref":"steps.open.result.tab.id"},"selector":"body","visibleOnly":false,"timeoutMs":8000},"continueOnError":true},
        {"type":"command","id":"read","method":"page.read","params":{"tabId":{"$ref":"steps.open.result.tab.id"},"limit":12000,"maxElements":1},"continueOnError":true},
        {"type":"command","id":"close","method":"tabs.close","params":{"tabId":{"$ref":"steps.open.result.tab.id"}},"continueOnError":true},
        {"type":"if","condition":{"left":{"$ref":"steps.read.ok"},"op":"falsey"},"then":[{"type":"fail","code":"CRAWL_READ_FAILED","message":"A crawl item failed after its temporary tab was closed."}],"else":[]}
      ],"collect":{"$ref":"steps.read.result.page"}}
    ],
    "output":{"pages":{"$ref":"vars.pages"}}
  }
  $wf$::jsonb,
  'Read up to 20 supplied URLs with bounded four-way orchestration, concurrent page loading, and the same output shape as earlier versions.',
  true
);

select public.opera_register_workflow(
  'youtube.search',
  $wf$
  {
    "steps": [
      {"type":"command","id":"find","method":"tabs.find","params":{"urlContains":"youtube.com","limit":10}},
      {"type":"if","condition":{"left":{"$ref":"steps.find.result.tab"},"op":"exists"},"then":[
        {"type":"set","name":"tabId","value":{"$ref":"steps.find.result.tab.id"}},
        {"type":"if","condition":{"left":{"$ref":"steps.find.result.tab.active"},"op":"falsey"},"then":[{"type":"command","id":"activate","method":"tabs.activate","params":{"tabId":{"$ref":"vars.tabId"}}}],"else":[]}
      ],"else":[
        {"type":"command","id":"openyt","method":"tabs.open","params":{"url":"https://www.youtube.com/","active":true,"wait":false}},
        {"type":"set","name":"tabId","value":{"$ref":"steps.openyt.result.tab.id"}}
      ]},
      {"type":"command","id":"searchbox","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"input#search, input.ytSearchboxComponentInput, input[name=\"search_query\"]","timeoutMs":8000}},
      {"type":"command","id":"fill","method":"page.fill","params":{"tabId":{"$ref":"vars.tabId"},"ref":{"$ref":"steps.searchbox.result.item.ref"},"value":{"$ref":"input.query"}}},
      {"type":"command","id":"submit","method":"page.key","params":{"tabId":{"$ref":"vars.tabId"},"key":"Enter","trusted":true}},
      {"type":"command","id":"results","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"ytd-search","timeoutMs":10000}},
      {"type":"command","id":"tab","method":"tabs.get","params":{"tabId":{"$ref":"vars.tabId"}}}
    ],
    "output":{"tab":{"$ref":"steps.tab.result.tab"},"query":{"$ref":"input.query"}}
  }
  $wf$::jsonb,
  'Search YouTube using the existing tab when possible, condition-driven waits, and Enter submission instead of unnecessary navigation and button lookup.',
  true
);

select public.opera_register_workflow(
  'youtube.play_recommendation',
  $wf$
  {
    "steps": [
      {"type":"command","id":"find","method":"tabs.find","params":{"urlContains":"youtube.com","limit":10}},
      {"type":"if","condition":{"left":{"$ref":"steps.find.result.tab"},"op":"exists"},"then":[
        {"type":"set","name":"tabId","value":{"$ref":"steps.find.result.tab.id"}},
        {"type":"if","condition":{"left":{"$ref":"steps.find.result.tab.active"},"op":"falsey"},"then":[{"type":"command","id":"activate","method":"tabs.activate","params":{"tabId":{"$ref":"vars.tabId"}}}],"else":[]},
        {"type":"if","condition":{"left":{"$ref":"steps.find.result.tab.url"},"op":"contains","right":"/results"},"then":[{"type":"command","id":"home","method":"tabs.navigate","params":{"tabId":{"$ref":"vars.tabId"},"url":"https://www.youtube.com/","wait":false}}],"else":[]}
      ],"else":[
        {"type":"command","id":"openyt","method":"tabs.open","params":{"url":"https://www.youtube.com/","active":true,"wait":false}},
        {"type":"set","name":"tabId","value":{"$ref":"steps.openyt.result.tab.id"}}
      ]},
      {"type":"command","id":"waitrecs","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"a#thumbnail[href*=\"watch\"], a.yt-lockup-view-model__content-image[href*=\"watch\"]","timeoutMs":10000}},
      {"type":"command","id":"rec","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":"a#thumbnail[href*=\"watch\"], a.yt-lockup-view-model__content-image[href*=\"watch\"]","index":{"$ref":"input.index"},"limit":30}},
      {"type":"if","condition":{"left":{"$ref":"steps.rec.result.item.href"},"op":"exists"},"then":[],"else":[{"type":"fail","code":"RECOMMENDATION_NOT_FOUND","message":"No recommendation URL was found."}]},
      {"type":"command","id":"openrec","method":"tabs.navigate","params":{"tabId":{"$ref":"vars.tabId"},"url":{"$ref":"steps.rec.result.item.href"},"wait":false}},
      {"type":"command","id":"waitvideo","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"video","timeoutMs":10000}},
      {"type":"command","id":"adstate","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":".ad-showing, .ytp-ad-player-overlay","index":0,"limit":5},"continueOnError":true},
      {"type":"if","condition":{"left":{"$ref":"steps.adstate.result.item"},"op":"exists"},"then":[
        {"type":"repeat","id":"ads","maxIterations":24,"failOnLimit":false,"steps":[
          {"type":"command","id":"skipwait","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":".ytp-ad-skip-button-modern, .ytp-ad-skip-button, button.ytp-skip-ad-button","timeoutMs":250},"continueOnError":true},
          {"type":"if","condition":{"left":{"$ref":"steps.skipwait.result.item"},"op":"exists"},"then":[{"type":"command","id":"skipclick","method":"page.click","params":{"tabId":{"$ref":"vars.tabId"},"ref":{"$ref":"steps.skipwait.result.item.ref"},"trusted":true},"continueOnError":true}],"else":[]},
          {"type":"command","id":"adstate","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":".ad-showing, .ytp-ad-player-overlay","index":0,"limit":5},"continueOnError":true}
        ],"until":{"left":{"$ref":"steps.adstate.result.item"},"op":"not_exists"}}
      ],"else":[]},
      {"type":"command","id":"play","method":"media.play","params":{"tabId":{"$ref":"vars.tabId"},"index":0},"continueOnError":true},
      {"type":"command","id":"media","method":"media.state","params":{"tabId":{"$ref":"vars.tabId"},"index":0}},
      {"type":"command","id":"tab","method":"tabs.get","params":{"tabId":{"$ref":"vars.tabId"}}}
    ],
    "output":{"tab":{"$ref":"steps.tab.result.tab"},"recommendation":{"$ref":"steps.rec.result.item"},"media":{"$ref":"steps.media.result.media"},"ad":{"$ref":"steps.adstate.result.item"}}
  }
  $wf$::jsonb,
  'Open a YouTube recommendation with fast-path tab reuse, selector-driven readiness, and ad polling only when an ad is actually present.',
  true
);

select public.opera_register_workflow(
  'youtube.captions_on',
  $wf$
  {
    "steps": [
      {"type":"command","id":"yt","method":"tabs.find","params":{"urlContains":"youtube.com/watch","limit":10}},
      {"type":"if","condition":{"left":{"$ref":"steps.yt.result.tab"},"op":"exists"},"then":[
        {"type":"command","id":"cc","method":"page.query","params":{"tabId":{"$ref":"steps.yt.result.tab.id"},"selector":".ytp-subtitles-button","index":0,"limit":5}},
        {"type":"if","condition":{"left":{"$ref":"steps.cc.result.item.ariaPressed"},"op":"eq","right":"true"},"then":[
          {"type":"set","name":"captions","value":true}
        ],"else":[
          {"type":"if","condition":{"left":{"$ref":"steps.cc.result.item"},"op":"exists"},"then":[
            {"type":"command","id":"clickcc","method":"page.click","params":{"tabId":{"$ref":"steps.yt.result.tab.id"},"ref":{"$ref":"steps.cc.result.item.ref"},"trusted":true}},
            {"type":"command","id":"verifycc","method":"page.wait_for","params":{"tabId":{"$ref":"steps.yt.result.tab.id"},"selector":".ytp-subtitles-button","state":{"ariaPressed":"true"},"timeoutMs":1500},"continueOnError":true},
            {"type":"if","condition":{"left":{"$ref":"steps.verifycc.result.item.ariaPressed"},"op":"eq","right":"true"},"then":[{"type":"set","name":"captions","value":true}],"else":[{"type":"fail","code":"CAPTIONS_VERIFY_FAILED","message":"Closed captions did not report aria-pressed=true after click."}]}
          ],"else":[{"type":"fail","code":"CAPTIONS_BUTTON_NOT_FOUND","message":"Closed captions button was not found."}]}
        ]}
      ],"else":[{"type":"fail","code":"YOUTUBE_TAB_NOT_FOUND","message":"No YouTube watch tab is open."}]}
    ],
    "output":{"captionsOn":{"$ref":"vars.captions"},"tab":{"$ref":"steps.yt.result.tab"}}
  }
  $wf$::jsonb,
  'Enable YouTube closed captions and verify the actual ARIA state without a fixed sleep.',
  true
);
