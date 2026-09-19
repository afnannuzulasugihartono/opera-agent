-- Pre-8E repair R5: internal media sampling fast path.
-- This adds no public MCP tool and does not change Protocol 1 / the 26 browser
-- primitives. It registers a generic server-side workflow that seeks an
-- existing media element locally instead of encoding time into a URL or
-- reloading/navigating the tab.
--
-- Playback-state rule:
--   paused before -> remain paused after seek
--   playing before -> pause, seek, then resume play
--
-- Historical workflows remain versioned/rollbackable through
-- opera_register_workflow.

select public.opera_register_workflow(
  'media.sample_at',
  $wf$
  {
    "steps":[
      {"type":"set","name":"mediaIndex","value":0},
      {"type":"if","condition":{"left":{"$ref":"input.index"},"op":"exists"},"then":[
        {"type":"set","name":"mediaIndex","value":{"$ref":"input.index"}}
      ],"else":[]},
      {"type":"command","id":"before","method":"media.state","params":{
        "tabId":{"$ref":"input.tabId"},
        "index":{"$ref":"vars.mediaIndex"}
      }},
      {"type":"if","condition":{"left":{"$ref":"steps.before.result.media.present"},"op":"truthy"},"then":[],"else":[
        {"type":"fail","code":"MEDIA_NOT_FOUND","message":"No media element is available in the target tab."}
      ]},
      {"type":"if","condition":{"left":{"$ref":"steps.before.result.media.paused"},"op":"falsey"},"then":[
        {"type":"command","id":"pause","method":"media.pause","params":{
          "tabId":{"$ref":"input.tabId"},
          "index":{"$ref":"vars.mediaIndex"}
        }}
      ],"else":[]},
      {"type":"command","id":"seek","method":"media.seek","params":{
        "tabId":{"$ref":"input.tabId"},
        "index":{"$ref":"vars.mediaIndex"},
        "seconds":{"$ref":"input.seconds"}
      }},
      {"type":"if","condition":{"left":{"$ref":"steps.before.result.media.paused"},"op":"falsey"},"then":[
        {"type":"command","id":"resume","method":"media.play","params":{
          "tabId":{"$ref":"input.tabId"},
          "index":{"$ref":"vars.mediaIndex"}
        }}
      ],"else":[]},
      {"type":"command","id":"after","method":"media.state","params":{
        "tabId":{"$ref":"input.tabId"},
        "index":{"$ref":"vars.mediaIndex"}
      }}
    ],
    "output":{
      "before":{"$ref":"steps.before.result.media"},
      "seek":{"$ref":"steps.seek.result.media"},
      "after":{"$ref":"steps.after.result.media"},
      "seconds":{"$ref":"input.seconds"},
      "index":{"$ref":"vars.mediaIndex"}
    }
  }
  $wf$::jsonb,
  'Seek an existing media element locally at a requested time while preserving prior playback state; no URL navigation/reload.',
  true
);
