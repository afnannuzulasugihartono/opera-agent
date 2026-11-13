select public.opera_register_workflow(
  'system.self_test',
  jsonb_build_object(
    'steps', jsonb_build_array(
      jsonb_build_object('type','set','id','set','name','marker','value','cloud-ok'),
      jsonb_build_object('type','if','id','check','condition',jsonb_build_object('left',jsonb_build_object('$ref','vars.marker'),'op','eq','right','cloud-ok'),
        'then',jsonb_build_array(jsonb_build_object('type','set','name','passed','value',true)),
        'else',jsonb_build_array(jsonb_build_object('type','fail','code','SELF_TEST_FAILED','message','Workflow resolver/condition engine failed.'))
    ),
    'output', jsonb_build_object('passed',jsonb_build_object('$ref','vars.passed'),'marker',jsonb_build_object('$ref','vars.marker'))
  ),
  'Cloud-only self-test for the Opera Agent workflow DSL.',
  true
);

select public.opera_register_workflow(
  'browser.status',
  '{"steps":[{"type":"command","id":"ping","method":"browser.ping","params":{}}],"output":{"ping":{"$ref":"steps.ping"}}}'::jsonb,
  'Return the connected Opera Agent bridge status.',
  true
);

select public.opera_register_workflow(
  'research.read_url',
  '{
    "steps":[
      {"type":"command","id":"open","method":"tabs.open","params":{"url":{"$ref":"input.url"},"active":false,"wait":true}},
      {"type":"command","id":"read","method":"page.read","params":{"tabId":{"$ref":"steps.open.result.tab.id"},"offset":{"$ref":"input.offset"},"limit":{"$ref":"input.limit"},"maxElements":80}},
      {"type":"command","id":"close","method":"tabs.close","params":{"tabId":{"$ref":"steps.open.result.tab.id"}},"continueOnError":true}
    ],
    "output":{"page":{"$ref":"steps.read.result.page"}}
  }'::jsonb,
  'Open one URL in a background tab, read a bounded semantic chunk, then close the tab.',
  true
);

select public.opera_register_workflow(
  'research.crawl_urls',
  '{
    "steps":[
      {"type":"foreach","id":"crawl","items":{"$ref":"input.urls"},"itemVar":"url","maxItems":20,"collectVar":"pages","steps":[
        {"type":"command","id":"open","method":"tabs.open","params":{"url":{"$ref":"vars.url"},"active":false,"wait":true}},
        {"type":"command","id":"read","method":"page.read","params":{"tabId":{"$ref":"steps.open.result.tab.id"},"limit":{"$ref":"input.limit"},"maxElements":40}},
        {"type":"command","id":"close","method":"tabs.close","params":{"tabId":{"$ref":"steps.open.result.tab.id"}},"continueOnError":true}
      ],"collect":{"$ref":"steps.read.result.page"}}
    ],
    "output":{"pages":{"$ref":"vars.pages"}}
  }'::jsonb,
  'Read up to 20 supplied URLs sequentially using temporary background tabs.',
  true
);

select public.opera_register_workflow(
  'youtube.captions_on',
  '{
    "steps":[
      {"type":"command","id":"yt","method":"tabs.find","params":{"urlContains":"youtube.com/watch","limit":10}},
      {"type":"if","id":"hasyt","condition":{"left":{"$ref":"steps.yt.result.tab"},"op":"exists"},"then":[
        {"type":"command","id":"cc","method":"page.query","params":{"tabId":{"$ref":"steps.yt.result.tab.id"},"selector":".ytp-subtitles-button","index":0,"limit":5}},
        {"type":"if","id":"already","condition":{"left":{"$ref":"steps.cc.result.item.ariaPressed"},"op":"eq","right":"true"},"then":[
          {"type":"set","name":"captions","value":true}
        ],"else":[
          {"type":"if","condition":{"left":{"$ref":"steps.cc.result.item"},"op":"exists"},"then":[
            {"type":"command","id":"clickcc","method":"page.click","params":{"tabId":{"$ref":"steps.yt.result.tab.id"},"ref":{"$ref":"steps.cc.result.item.ref"},"trusted":true}},
            {"type":"wait","ms":200},
            {"type":"command","id":"verifycc","method":"page.query","params":{"tabId":{"$ref":"steps.yt.result.tab.id"},"selector":".ytp-subtitles-button","index":0,"limit":5}},
            {"type":"if","condition":{"left":{"$ref":"steps.verifycc.result.item.ariaPressed"},"op":"eq","right":"true"},"then":[{"type":"set","name":"captions","value":true}],"else":[{"type":"fail","code":"CAPTIONS_VERIFY_FAILED","message":"Closed captions did not report aria-pressed=true after click."}]}
          ],"else":[{"type":"fail","code":"CAPTIONS_BUTTON_NOT_FOUND","message":"Closed captions button was not found."}]}
        ]}
      ],"else":[{"type":"fail","code":"YOUTUBE_TAB_NOT_FOUND","message":"No YouTube watch tab is open."}]}
    ],
    "output":{"captionsOn":{"$ref":"vars.captions"},"tab":{"$ref":"steps.yt.result.tab"}}
  }'::jsonb,
  'Enable YouTube closed captions using only generic browser primitives.',
  true
);

select public.opera_register_workflow(
  'youtube.search',
  '{
    "steps":[
      {"type":"command","id":"find","method":"tabs.find","params":{"urlContains":"youtube.com","limit":10}},
      {"type":"if","condition":{"left":{"$ref":"steps.find.result.tab"},"op":"exists"},"then":[
        {"type":"set","name":"tabId","value":{"$ref":"steps.find.result.tab.id"}},
        {"type":"command","id":"activate","method":"tabs.activate","params":{"tabId":{"$ref":"vars.tabId"}}}
      ],"else":[
        {"type":"command","id":"openyt","method":"tabs.open","params":{"url":"https://www.youtube.com/","active":true,"wait":true}},
        {"type":"set","name":"tabId","value":{"$ref":"steps.openyt.result.tab.id"}}
      ]},
      {"type":"command","id":"home","method":"tabs.navigate","params":{"tabId":{"$ref":"vars.tabId"},"url":"https://www.youtube.com/","wait":true}},
      {"type":"command","id":"searchbox","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":"input#search, input.ytSearchboxComponentInput, input[name=\"search_query\"]","index":0,"limit":5}},
      {"type":"command","id":"fill","method":"page.fill","params":{"tabId":{"$ref":"vars.tabId"},"ref":{"$ref":"steps.searchbox.result.item.ref"},"value":{"$ref":"input.query"}}},
      {"type":"command","id":"searchbutton","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":"button#search-icon-legacy, button.ytSearchboxComponentSearchButton, button[aria-label=\"Search\"]","index":0,"limit":5}},
      {"type":"command","id":"click","method":"page.click","params":{"tabId":{"$ref":"vars.tabId"},"ref":{"$ref":"steps.searchbutton.result.item.ref"},"trusted":true}},
      {"type":"command","id":"wait","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"ytd-search","timeoutMs":10000}},
      {"type":"command","id":"tab","method":"tabs.get","params":{"tabId":{"$ref":"vars.tabId"}}}
    ],
    "output":{"tab":{"$ref":"steps.tab.result.tab"},"query":{"$ref":"input.query"}}
  }'::jsonb,
  'Search YouTube through the local Opera tab using generic primitives.',
  true
);

select public.opera_register_workflow(
  'youtube.play_recommendation',
  '{
    "steps":[
      {"type":"command","id":"find","method":"tabs.find","params":{"urlContains":"youtube.com","limit":10}},
      {"type":"if","condition":{"left":{"$ref":"steps.find.result.tab"},"op":"exists"},"then":[
        {"type":"set","name":"tabId","value":{"$ref":"steps.find.result.tab.id"}},
        {"type":"command","id":"activate","method":"tabs.activate","params":{"tabId":{"$ref":"vars.tabId"}}}
      ],"else":[
        {"type":"command","id":"openyt","method":"tabs.open","params":{"url":"https://www.youtube.com/","active":true,"wait":true}},
        {"type":"set","name":"tabId","value":{"$ref":"steps.openyt.result.tab.id"}}
      ]},
      {"type":"command","id":"home","method":"tabs.navigate","params":{"tabId":{"$ref":"vars.tabId"},"url":"https://www.youtube.com/","wait":true}},
      {"type":"command","id":"waitrecs","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"a#thumbnail[href*=\"watch\"], a.yt-lockup-view-model__content-image[href*=\"watch\"]","timeoutMs":10000}},
      {"type":"command","id":"rec","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":"a#thumbnail[href*=\"watch\"], a.yt-lockup-view-model__content-image[href*=\"watch\"]","index":{"$ref":"input.index"},"limit":30}},
      {"type":"if","condition":{"left":{"$ref":"steps.rec.result.item.href"},"op":"exists"},"then":[],"else":[{"type":"fail","code":"RECOMMENDATION_NOT_FOUND","message":"No recommendation URL was found."}]},
      {"type":"command","id":"openrec","method":"tabs.navigate","params":{"tabId":{"$ref":"vars.tabId"},"url":{"$ref":"steps.rec.result.item.href"},"wait":true}},
      {"type":"command","id":"waitvideo","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"video","timeoutMs":10000}},
      {"type":"repeat","id":"ads","maxIterations":20,"failOnLimit":false,"steps":[
        {"type":"command","id":"skip","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":".ytp-ad-skip-button-modern, .ytp-ad-skip-button, button.ytp-skip-ad-button","index":0,"limit":5}},
        {"type":"if","condition":{"left":{"$ref":"steps.skip.result.item"},"op":"exists"},"then":[{"type":"command","id":"skipclick","method":"page.click","params":{"tabId":{"$ref":"vars.tabId"},"ref":{"$ref":"steps.skip.result.item.ref"},"trusted":true},"continueOnError":true}],"else":[]},
        {"type":"wait","ms":600},
        {"type":"command","id":"adstate","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":".ad-showing, .ytp-ad-player-overlay","index":0,"limit":5},"continueOnError":true}
      ],"until":{"left":{"$ref":"steps.adstate.result.item"},"op":"not_exists"}},
      {"type":"command","id":"play","method":"media.play","params":{"tabId":{"$ref":"vars.tabId"},"index":0},"continueOnError":true},
      {"type":"command","id":"media","method":"media.state","params":{"tabId":{"$ref":"vars.tabId"},"index":0}},
      {"type":"command","id":"tab","method":"tabs.get","params":{"tabId":{"$ref":"vars.tabId"}}}
    ],
    "output":{"tab":{"$ref":"steps.tab.result.tab"},"recommendation":{"$ref":"steps.rec.result.item"},"media":{"$ref":"steps.media.result.media"},"ad":{"$ref":"steps.adstate.result.item"}}
  }'::jsonb,
  'Open a YouTube recommendation, attempt bounded ad skipping, and verify media state.',
  true
);
