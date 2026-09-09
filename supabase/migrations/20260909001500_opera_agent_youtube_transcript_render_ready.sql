-- Refine YouTube transcript extraction after real-Opera background-tab testing.
-- v1/v2 remain preserved in opera_workflow_versions for rollback.
-- YouTube can expose an expanded transcript engagement panel before transcript rows
-- are actually rendered in an inactive tab. Activate only as a bounded fallback,
-- then restore the previously active tab after extraction.

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
      {"type":"command","id":"previousActive","method":"tabs.get","params":{}},
      {"type":"command","id":"watch","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"ytd-watch-flexy","timeoutMs":10000}},
      {"type":"set","name":"panelWasOpen","value":false},
      {"type":"set","name":"openMethod","value":"none"},
      {"type":"set","name":"activatedForRender","value":false},
      {"type":"command","id":"panel","method":"page.query","params":{"tabId":{"$ref":"vars.tabId"},"selector":"ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer[target-id*=\"transcript\"][visibility=\"ENGAGEMENT_PANEL_VISIBILITY_EXPANDED\"]","index":0,"limit":5,"visibleOnly":false},"continueOnError":true},
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
        {"type":"command","id":"panelFast","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer[target-id*=\"transcript\"][visibility=\"ENGAGEMENT_PANEL_VISIBILITY_EXPANDED\"]","visibleOnly":false,"timeoutMs":1200},"continueOnError":true},
        {"type":"if","condition":{"left":{"$ref":"steps.panelFast.result.item"},"op":"exists"},"then":[
          {"type":"set","name":"openMethod","value":"synthetic"}
        ],"else":[
          {"type":"command","id":"transcriptFresh","method":"page.find","params":{"tabId":{"$ref":"vars.tabId"},"text":"Show transcript","limit":5}},
          {"type":"command","id":"openTrusted","method":"page.click","params":{"tabId":{"$ref":"vars.tabId"},"ref":{"$ref":"steps.transcriptFresh.result.item.ref"},"trusted":true}},
          {"type":"command","id":"panelTrusted","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer[target-id*=\"transcript\"][visibility=\"ENGAGEMENT_PANEL_VISIBILITY_EXPANDED\"]","visibleOnly":false,"timeoutMs":8000}},
          {"type":"set","name":"openMethod","value":"trusted"}
        ]}
      ]},
      {"type":"command","id":"segmentFast","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"ytd-transcript-segment-renderer","visibleOnly":false,"timeoutMs":1200},"continueOnError":true},
      {"type":"if","condition":{"left":{"$ref":"steps.segmentFast.result.item"},"op":"not_exists"},"then":[
        {"type":"command","id":"activateForRender","method":"tabs.activate","params":{"tabId":{"$ref":"vars.tabId"},"focusWindow":false}},
        {"type":"set","name":"activatedForRender","value":true},
        {"type":"command","id":"segmentReady","method":"page.wait_for","params":{"tabId":{"$ref":"vars.tabId"},"selector":"ytd-transcript-segment-renderer","visibleOnly":false,"timeoutMs":6000}}
      ],"else":[]},
      {"type":"set","name":"text","value":""},
      {"type":"set","name":"offset","value":0},
      {"type":"repeat","id":"chunks","maxIterations":30,"failOnLimit":false,"steps":[
        {"type":"command","id":"read","method":"page.read","params":{"tabId":{"$ref":"vars.tabId"},"offset":{"$ref":"vars.offset"},"limit":12000,"maxElements":1}},
        {"type":"set","name":"text","value":{"$concat":[{"$ref":"vars.text"},{"$ref":"steps.read.result.page.text"}]}},
        {"type":"set","name":"offset","value":{"$ref":"steps.read.result.page.nextOffset"}}
      ],"until":{"left":{"$ref":"steps.read.result.page.hasMore"},"op":"falsey"}},
      {"type":"command","id":"tab","method":"tabs.get","params":{"tabId":{"$ref":"vars.tabId"}}},
      {"type":"if","condition":{"left":{"$ref":"vars.activatedForRender"},"op":"truthy"},"then":[
        {"type":"if","condition":{"left":{"$ref":"steps.previousActive.result.tab.id"},"op":"ne","right":{"$ref":"vars.tabId"}},"then":[
          {"type":"command","id":"restoreActive","method":"tabs.activate","params":{"tabId":{"$ref":"steps.previousActive.result.tab.id"},"focusWindow":false},"continueOnError":true}
        ],"else":[]}
      ],"else":[]}
    ],
    "output":{
      "tab":{"$ref":"steps.tab.result.tab"},
      "text":{"$ref":"vars.text"},
      "totalTextChars":{"$ref":"steps.read.result.page.totalTextChars"},
      "hasMore":{"$ref":"steps.read.result.page.hasMore"},
      "nextOffset":{"$ref":"steps.read.result.page.nextOffset"},
      "panelWasOpen":{"$ref":"vars.panelWasOpen"},
      "openMethod":{"$ref":"vars.openMethod"},
      "activatedForRender":{"$ref":"vars.activatedForRender"}
    }
  }
  $wf$::jsonb,
  'Open or reuse YouTube transcript, wait for actual transcript rows, activate only when background rendering is throttled, restore the previous active tab, and collect adaptive 12k text.',
  true
);
