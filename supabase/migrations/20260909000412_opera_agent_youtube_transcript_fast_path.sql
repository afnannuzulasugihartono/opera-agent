-- Refine YouTube transcript extraction after live Opera profiling.
-- The v1 workflow remains in opera_workflow_versions for rollback.
-- Avoid a trusted CDP click when the transcript panel is already open, and try a normal DOM click first when opening it.
-- Trusted input remains the fallback.

select public.opera_register_workflow(
  'youtube.get_transcript',
  $wf$
  {
    "steps":[
      {"type":"command","id":"yt","method":"tabs.find","params":{"urlContains":"youtube.com/watch","limit":10}},
      {"type":"if","condition":{"left":{"$ref":"steps.yt.result.tab"},"op":"exists"},"then":[
        {"type":"set","name":"tabId","value":{"$ref":"steps.yt.result.tab.id"}}
      ],"else":[
        {"type":"fail","code":"YOUTUBE_TAB_NOT_FOUND","message":"No YouTube watch tab is open."}
      ]},
      {"type":"command","id":"watch","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"ytd-watch-flexy","timeoutMs":10000}},
      {"type":"set","name":"panelWasOpen","value":false},
      {"type":"set","name":"openMethod","value":"none"},
      {"type":"command","id":"panel","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":"ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer[target-id*=\"transcript\"]","index":0,"limit":5},"continueOnError":true},
      {"type":"if","condition":{"left":{"$ref":"steps.panel.result.item"},"op":"exists"},"then":[
        {"type":"set","name":"panelWasOpen","value":true},
        {"type":"set","name":"openMethod","value":"already-open"}
      ],"else":[
        {"type":"command","id":"transcript","method":"page.find","params":{"tabId":{"$ref":"vars.tabId"},"text":"Show transcript","limit":5},"continueOnError":true},
        {"type":"if","condition":{"left":{"$ref":"steps.transcript.result.item"},"op":"not_exists"},"then":[
          {"type":"command","id":"expand","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":"#description-inline-expander #expand, ytd-text-inline-expander #expand, tp-yt-paper-button#expand","index":0,"limit":5},"continueOnError":true},
          {"type":"if","condition":{"left":{"$ref":"steps.expand.result.item"},"op":"exists"},"then":[
            {"type":"command","id":"expandclick","method":"page.click","params":{"tabId":{"$ref":"vars.tabId"},"ref":{"$ref":"steps.expand.result.item.ref"},"trusted":false},"continueOnError":true}
          ],"else":[]},
          {"type":"command","id":"waittranscript","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"text":"Show transcript","timeoutMs":5000}},
          {"type":"set","name":"transcriptRef","value":{"$ref":"steps.waittranscript.result.item.ref"}}
        ],"else":[
          {"type":"set","name":"transcriptRef","value":{"$ref":"steps.transcript.result.item.ref"}}
        ]},
        {"type":"command","id":"openSynthetic","method":"page.click","params":{"tabId":{"$ref":"vars.tabId"},"ref":{"$ref":"vars.transcriptRef"},"trusted":false},"continueOnError":true},
        {"type":"command","id":"panelFast","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer[target-id*=\"transcript\"]","timeoutMs":1200},"continueOnError":true},
        {"type":"if","condition":{"left":{"$ref":"steps.panelFast.result.item"},"op":"exists"},"then":[
          {"type":"set","name":"openMethod","value":"synthetic"}
        ],"else":[
          {"type":"command","id":"transcriptFresh","method":"page.find","params":{"tabId":{"$ref":"vars.tabId"},"text":"Show transcript","limit":5}},
          {"type":"command","id":"openTrusted","method":"page.click","params":{"tabId":{"$ref":"vars.tabId"},"ref":{"$ref":"steps.transcriptFresh.result.item.ref"},"trusted":true}},
          {"type":"command","id":"panelTrusted","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer[target-id*=\"transcript\"]","timeoutMs":8000}},
          {"type":"set","name":"openMethod","value":"trusted"}
        ]}
      ]},
      {"type":"set","name":"text","value":""},
      {"type":"set","name":"offset","value":0},
      {"type":"repeat","id":"chunks","maxIterations":30,"failOnLimit":false,"steps":[
        {"type":"command","id":"read","method":"page.read","params":{"tabId":{"$ref":"vars.tabId"},"offset":{"$ref":"vars.offset"},"limit":12000,"maxElements":1}},
        {"type":"set","name":"text","value":{"$concat":[{"$ref":"vars.text"},{"$ref":"steps.read.result.page.text"}]}},
        {"type":"set","name":"offset","value":{"$ref":"steps.read.result.page.nextOffset"}}
      ],"until":{"left":{"$ref":"steps.read.result.page.hasMore"},"op":"falsey"}},
      {"type":"command","id":"tab","method":"tabs.get","params":{"tabId":{"$ref":"vars.tabId"}}}
    ],
    "output":{
      "tab":{"$ref":"steps.tab.result.tab"},
      "text":{"$ref":"vars.text"},
      "totalTextChars":{"$ref":"steps.read.result.page.totalTextChars"},
      "hasMore":{"$ref":"steps.read.result.page.hasMore"},
      "nextOffset":{"$ref":"steps.read.result.page.nextOffset"},
      "panelWasOpen":{"$ref":"vars.panelWasOpen"},
      "openMethod":{"$ref":"vars.openMethod"}
    }
  }
  $wf$::jsonb,
  'Open or reuse YouTube transcript panel with an already-open fast path, synthetic-click preference, trusted fallback, and adaptive 12k reads.',
  true
);
