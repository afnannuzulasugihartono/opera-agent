-- Opera Agent efficiency pass.
--
-- Goals:
-- 1. Keep the extension generic and stable.
-- 2. Move site-specific acceleration into versioned server workflows.
-- 3. Prefer readiness conditions over fixed sleeps/full-page waits.
-- 4. Read large text in 12k chunks with minimal DOM payload.
-- 5. Preserve rollback through opera_workflow_versions.

select public.opera_register_workflow(
  'research.read_full',
  $$
  {
    "steps":[
      {"type":"if","condition":{"left":{"$ref":"input.limit"},"op":"exists"},"then":[
        {"type":"set","name":"readLimit","value":{"$ref":"input.limit"}}
      ],"else":[
        {"type":"set","name":"readLimit","value":12000}
      ]},
      {"type":"if","condition":{"left":{"$ref":"input.maxElements"},"op":"exists"},"then":[
        {"type":"set","name":"maxElements","value":{"$ref":"input.maxElements"}}
      ],"else":[
        {"type":"set","name":"maxElements","value":1}
      ]},
      {"type":"if","condition":{"left":{"$ref":"input.offset"},"op":"exists"},"then":[
        {"type":"set","name":"offset","value":{"$ref":"input.offset"}}
      ],"else":[
        {"type":"set","name":"offset","value":0}
      ]},
      {"type":"set","name":"text","value":""},
      {"type":"repeat","id":"chunks","maxIterations":30,"failOnLimit":false,"steps":[
        {"type":"command","id":"chunk","method":"page.read","params":{
          "tabId":{"$ref":"input.tabId"},
          "offset":{"$ref":"vars.offset"},
          "limit":{"$ref":"vars.readLimit"},
          "maxElements":{"$ref":"vars.maxElements"}
        }},
        {"type":"set","name":"text","value":{"$concat":[
          {"$ref":"vars.text"},{"$ref":"steps.chunk.result.page.text"}
        ]}},
        {"type":"set","name":"offset","value":{"$ref":"steps.chunk.result.page.nextOffset"}}
      ],"until":{"left":{"$ref":"steps.chunk.result.page.hasMore"},"op":"eq","right":false}}
    ],
    "output":{
      "text":{"$ref":"vars.text"},
      "title":{"$ref":"steps.chunk.result.page.title"},
      "url":{"$ref":"steps.chunk.result.page.url"},
      "documentId":{"$ref":"steps.chunk.result.page.documentId"},
      "totalTextChars":{"$ref":"steps.chunk.result.page.totalTextChars"},
      "nextOffset":{"$ref":"steps.chunk.result.page.nextOffset"},
      "hasMore":{"$ref":"steps.chunk.result.page.hasMore"}
    }
  }
  $$::jsonb,
  'Read the active or supplied tab adaptively in large chunks. Defaults to 12k text chunks and one interactive element to minimize payload; callers can override limit/maxElements.',
  true
);

select public.opera_register_workflow(
  'research.read_url',
  $$
  {
    "steps":[
      {"type":"if","condition":{"left":{"$ref":"input.limit"},"op":"exists"},"then":[
        {"type":"set","name":"readLimit","value":{"$ref":"input.limit"}}
      ],"else":[
        {"type":"set","name":"readLimit","value":12000}
      ]},
      {"type":"if","condition":{"left":{"$ref":"input.maxElements"},"op":"exists"},"then":[
        {"type":"set","name":"maxElements","value":{"$ref":"input.maxElements"}}
      ],"else":[
        {"type":"set","name":"maxElements","value":1}
      ]},
      {"type":"command","id":"open","method":"tabs.open","params":{"url":{"$ref":"input.url"},"active":false,"wait":false}},
      {"type":"command","id":"ready","method":"page.wait_for","params":{"tabId":{"$ref":"steps.open.result.tab.id"},"selector":"body","timeoutMs":4000,"intervalMs":50},"continueOnError":true},
      {"type":"command","id":"read","method":"page.read","params":{
        "tabId":{"$ref":"steps.open.result.tab.id"},
        "offset":{"$ref":"input.offset"},
        "limit":{"$ref":"vars.readLimit"},
        "maxElements":{"$ref":"vars.maxElements"}
      }},
      {"type":"command","id":"close","method":"tabs.close","params":{"tabId":{"$ref":"steps.open.result.tab.id"}},"continueOnError":true}
    ],
    "output":{"page":{"$ref":"steps.read.result.page"}}
  }
  $$::jsonb,
  'Fast generic URL read: open in background, wait for document body rather than full resource completion, then return a bounded semantic chunk.',
  true
);

select public.opera_register_workflow(
  'youtube.search',
  $$
  {
    "steps":[
      {"type":"command","id":"find","method":"tabs.find","params":{"urlContains":"youtube.com","limit":10}},
      {"type":"if","condition":{"left":{"$ref":"steps.find.result.tab"},"op":"exists"},"then":[
        {"type":"set","name":"tabId","value":{"$ref":"steps.find.result.tab.id"}}
      ],"else":[
        {"type":"command","id":"openyt","method":"tabs.open","params":{"url":"https://www.youtube.com/","active":false,"wait":false}},
        {"type":"set","name":"tabId","value":{"$ref":"steps.openyt.result.tab.id"}}
      ]},
      {"type":"if","condition":{"left":{"$ref":"input.foreground"},"op":"truthy"},"then":[
        {"type":"command","id":"activate","method":"tabs.activate","params":{"tabId":{"$ref":"vars.tabId"}}}
      ],"else":[]},
      {"type":"command","id":"home","method":"tabs.navigate","params":{"tabId":{"$ref":"vars.tabId"},"url":"https://www.youtube.com/","wait":false}},
      {"type":"command","id":"searchbox","method":"page.wait_for","params":{
        "tabId":{"$ref":"vars.tabId"},
        "selector":"input#search, input.ytSearchboxComponentInput, input[name=\"search_query\"]",
        "timeoutMs":7000,
        "intervalMs":50
      }},
      {"type":"command","id":"fill","method":"page.fill","params":{"tabId":{"$ref":"vars.tabId"},"ref":{"$ref":"steps.searchbox.result.item.ref"},"value":{"$ref":"input.query"}}},
      {"type":"command","id":"enter","method":"page.key","params":{"tabId":{"$ref":"vars.tabId"},"key":"Enter","trusted":true}},
      {"type":"command","id":"results","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"ytd-search","timeoutMs":8000,"intervalMs":50}},
      {"type":"command","id":"tab","method":"tabs.get","params":{"tabId":{"$ref":"vars.tabId"}}}
    ],
    "output":{"tab":{"$ref":"steps.tab.result.tab"},"query":{"$ref":"input.query"}}
  }
  $$::jsonb,
  'Search YouTube with condition-based readiness and Enter submission. Runs in background unless input.foreground is true.',
  true
);

select public.opera_register_workflow(
  'youtube.play_recommendation',
  $$
  {
    "steps":[
      {"type":"command","id":"find","method":"tabs.find","params":{"urlContains":"youtube.com","limit":10}},
      {"type":"if","condition":{"left":{"$ref":"steps.find.result.tab"},"op":"exists"},"then":[
        {"type":"set","name":"tabId","value":{"$ref":"steps.find.result.tab.id"}}
      ],"else":[
        {"type":"command","id":"openyt","method":"tabs.open","params":{"url":"https://www.youtube.com/","active":false,"wait":false}},
        {"type":"set","name":"tabId","value":{"$ref":"steps.openyt.result.tab.id"}}
      ]},
      {"type":"if","condition":{"left":{"$ref":"input.foreground"},"op":"truthy"},"then":[
        {"type":"command","id":"activate","method":"tabs.activate","params":{"tabId":{"$ref":"vars.tabId"}}}
      ],"else":[]},
      {"type":"command","id":"home","method":"tabs.navigate","params":{"tabId":{"$ref":"vars.tabId"},"url":"https://www.youtube.com/","wait":false}},
      {"type":"command","id":"waitrecs","method":"page.wait_for","params":{
        "tabId":{"$ref":"vars.tabId"},
        "selector":"a#thumbnail[href*=\"watch\"], a.yt-lockup-view-model__content-image[href*=\"watch\"]",
        "timeoutMs":8000,
        "intervalMs":50
      }},
      {"type":"command","id":"rec","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":"a#thumbnail[href*=\"watch\"], a.yt-lockup-view-model__content-image[href*=\"watch\"]","index":{"$ref":"input.index"},"limit":30}},
      {"type":"if","condition":{"left":{"$ref":"steps.rec.result.item.href"},"op":"exists"},"then":[],"else":[
        {"type":"fail","code":"RECOMMENDATION_NOT_FOUND","message":"No recommendation URL was found."}
      ]},
      {"type":"command","id":"openrec","method":"tabs.navigate","params":{"tabId":{"$ref":"vars.tabId"},"url":{"$ref":"steps.rec.result.item.href"},"wait":false}},
      {"type":"command","id":"waitvideo","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"video","timeoutMs":8000,"intervalMs":50}},
      {"type":"command","id":"adstate","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":".ad-showing, .ytp-ad-player-overlay","index":0,"limit":5},"continueOnError":true},
      {"type":"if","condition":{"left":{"$ref":"steps.adstate.result.item"},"op":"exists"},"then":[
        {"type":"repeat","id":"ads","maxIterations":16,"failOnLimit":false,"steps":[
          {"type":"command","id":"skip","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":".ytp-ad-skip-button-modern, .ytp-ad-skip-button, button.ytp-skip-ad-button","index":0,"limit":5},"continueOnError":true},
          {"type":"if","condition":{"left":{"$ref":"steps.skip.result.item"},"op":"exists"},"then":[
            {"type":"command","id":"skipclick","method":"page.click","params":{"tabId":{"$ref":"vars.tabId"},"ref":{"$ref":"steps.skip.result.item.ref"},"trusted":true},"continueOnError":true}
          ],"else":[]},
          {"type":"command","id":"adstate","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":".ad-showing, .ytp-ad-player-overlay","index":0,"limit":5},"continueOnError":true},
          {"type":"if","condition":{"left":{"$ref":"steps.adstate.result.item"},"op":"exists"},"then":[
            {"type":"wait","ms":250}
          ],"else":[]}
        ],"until":{"left":{"$ref":"steps.adstate.result.item"},"op":"not_exists"}}
      ],"else":[]},
      {"type":"command","id":"play","method":"media.play","params":{"tabId":{"$ref":"vars.tabId"},"index":0},"continueOnError":true},
      {"type":"command","id":"media","method":"media.state","params":{"tabId":{"$ref":"vars.tabId"},"index":0}},
      {"type":"command","id":"tab","method":"tabs.get","params":{"tabId":{"$ref":"vars.tabId"}}}
    ],
    "output":{"tab":{"$ref":"steps.tab.result.tab"},"recommendation":{"$ref":"steps.rec.result.item"},"media":{"$ref":"steps.media.result.media"},"ad":{"$ref":"steps.adstate.result.item"}}
  }
  $$::jsonb,
  'Open a YouTube recommendation with selector readiness instead of full-page waits. Ad handling is skipped entirely when no ad is present and uses a short bounded retry only when needed.',
  true
);

select public.opera_register_workflow(
  'youtube.captions_on',
  $$
  {
    "steps":[
      {"type":"command","id":"yt","method":"tabs.find","params":{"urlContains":"youtube.com/watch","limit":10}},
      {"type":"if","id":"hasyt","condition":{"left":{"$ref":"steps.yt.result.tab"},"op":"exists"},"then":[
        {"type":"command","id":"cc","method":"page.query","params":{"tabId":{"$ref":"steps.yt.result.tab.id"},"selector":".ytp-subtitles-button","index":0,"limit":5}},
        {"type":"if","id":"already","condition":{"left":{"$ref":"steps.cc.result.item.ariaPressed"},"op":"eq","right":"true"},"then":[
          {"type":"set","name":"captions","value":true}
        ],"else":[
          {"type":"if","condition":{"left":{"$ref":"steps.cc.result.item"},"op":"exists"},"then":[
            {"type":"command","id":"clickcc","method":"page.click","params":{"tabId":{"$ref":"steps.yt.result.tab.id"},"ref":{"$ref":"steps.cc.result.item.ref"},"trusted":true}},
            {"type":"command","id":"verifycc","method":"page.wait_for","params":{
              "tabId":{"$ref":"steps.yt.result.tab.id"},
              "selector":".ytp-subtitles-button",
              "state":{"ariaPressed":"true"},
              "timeoutMs":2000,
              "intervalMs":50
            }},
            {"type":"set","name":"captions","value":true}
          ],"else":[
            {"type":"fail","code":"CAPTIONS_BUTTON_NOT_FOUND","message":"Closed captions button was not found."}
          ]}
        ]}
      ],"else":[
        {"type":"fail","code":"YOUTUBE_TAB_NOT_FOUND","message":"No YouTube watch tab is open."}
      ]}
    ],
    "output":{"captionsOn":{"$ref":"vars.captions"},"tab":{"$ref":"steps.yt.result.tab"}}
  }
  $$::jsonb,
  'Enable YouTube closed captions and verify the actual ARIA state without a fixed sleep.',
  true
);
