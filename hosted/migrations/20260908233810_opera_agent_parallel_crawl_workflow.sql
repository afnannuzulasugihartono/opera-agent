-- Optional high-throughput crawl workflow.
-- The default research.crawl_urls keeps its low-overhead one-tab sequential behavior.
-- This workflow uses bounded parallel foreach orchestration in the Edge runner and opens separate background tabs so page network loading can overlap safely.

select public.opera_register_workflow(
  'research.crawl_urls_parallel',
  $wf$
  {
    "steps": [
      {
        "type":"foreach",
        "id":"crawl",
        "items":{"$ref":"input.urls"},
        "itemVar":"url",
        "maxItems":20,
        "parallel":true,
        "maxConcurrency":4,
        "collectVar":"pages",
        "steps":[
          {"type":"command","id":"open","method":"tabs.open","params":{"url":{"$ref":"vars.url"},"active":false,"wait":false}},
          {"type":"command","id":"ready","method":"page.wait_for","params":{"tabId":{"$ref":"steps.open.result.tab.id"},"selector":"body","visibleOnly":false,"timeoutMs":8000},"continueOnError":true},
          {"type":"command","id":"read","method":"page.read","params":{"tabId":{"$ref":"steps.open.result.tab.id"},"limit":12000,"maxElements":1},"continueOnError":true},
          {"type":"command","id":"close","method":"tabs.close","params":{"tabId":{"$ref":"steps.open.result.tab.id"}},"continueOnError":true},
          {"type":"if","condition":{"left":{"$ref":"steps.read.ok"},"op":"falsey"},"then":[{"type":"fail","code":"CRAWL_READ_FAILED","message":"A parallel crawl item failed after its temporary tab was closed."}],"else":[]}
        ],
        "collect":{"$ref":"steps.read.result.page"}
      }
    ],
    "output":{"pages":{"$ref":"vars.pages"}}
  }
  $wf$::jsonb,
  'Read up to 20 URLs with at most four independent background tabs loading concurrently; output matches research.crawl_urls.',
  true
);
