-- Historical production migration snapshot.
--
-- This experiment registered a future generic local-plan primitive and a small
-- set of workflows that depended on it. The stable Opera Agent 1.0.1 extension
-- never advertised browser.plan, so the immediately-following quarantine
-- migration disables the method and workflows. Keep this file immutable as
-- migration/history evidence; do not treat it as a shipped extension feature.

insert into public.opera_methods(method, default_timeout_ms, enabled, description)
values (
  'browser.plan',
  55000,
  true,
  'Execute a bounded declarative sequence of existing allowlisted browser primitives locally in Opera Agent v2.'
)
on conflict (method) do update
set default_timeout_ms = excluded.default_timeout_ms,
    enabled = excluded.enabled,
    description = excluded.description;

select public.opera_register_workflow(
  'browser.v2_status',
  $json$
  {
    "steps": [
      {
        "id": "plan",
        "type": "command",
        "method": "browser.plan",
        "params": {
          "steps": [
            {"id": "ping", "type": "command", "method": "browser.ping", "params": {}}
          ],
          "output": {"ping": {"$ref": "steps.ping"}}
        }
      }
    ],
    "output": {"result": {"$ref": "steps.plan.result.result"}}
  }
  $json$::jsonb,
  'Opera Agent v2 status through one local browser.plan command.',
  true
);

select public.opera_register_workflow(
  'research.v2_read_current_full',
  $json$
  {
    "steps": [
      {
        "id": "plan",
        "type": "command",
        "method": "browser.plan",
        "params": {
          "steps": [
            {"name": "offset", "type": "set", "value": 0},
            {"name": "content", "type": "set", "value": ""},
            {"id": "tab", "type": "command", "method": "tabs.get", "params": {}},
            {
              "type": "repeat",
              "steps": [
                {
                  "id": "read",
                  "type": "command",
                  "method": "page.read",
                  "params": {
                    "limit": 12000,
                    "tabId": {"$ref": "steps.tab.tab.id"},
                    "offset": {"$ref": "vars.offset"},
                    "includeElements": false
                  }
                },
                {"name": "content", "type": "set", "value": {"$concat": [{"$ref": "vars.content"}, {"$ref": "steps.read.page.text"}]}},
                {"name": "offset", "type": "set", "value": {"$ref": "steps.read.page.nextOffset"}}
              ],
              "until": {"op": "falsey", "left": {"$ref": "steps.read.page.hasMore"}},
              "maxIterations": 20
            }
          ],
          "output": {
            "tab": {"$ref": "steps.tab.tab"},
            "url": {"$ref": "steps.read.page.url"},
            "text": {"$ref": "vars.content"},
            "title": {"$ref": "steps.read.page.title"},
            "totalTextChars": {"$ref": "steps.read.page.totalTextChars"}
          }
        }
      }
    ],
    "output": {"page": {"$ref": "steps.plan.result.result"}}
  }
  $json$::jsonb,
  'Read the current page in one claimed v2 browser command using bounded 12k text-only chunks.',
  true
);

select public.opera_register_workflow(
  'research.v2_read_url_full',
  $json$
  {
    "steps": [
      {
        "id": "plan",
        "type": "command",
        "method": "browser.plan",
        "params": {
          "input": {"url": {"$ref": "input.url"}},
          "steps": [
            {"name": "offset", "type": "set", "value": 0},
            {"name": "content", "type": "set", "value": ""},
            {"id": "open", "type": "command", "method": "tabs.open", "params": {"url": {"$ref": "input.url"}, "wait": false, "active": false}},
            {"id": "ready", "type": "command", "method": "page.wait_for", "params": {"tabId": {"$ref": "steps.open.tab.id"}, "selector": "body", "timeoutMs": 12000, "visibleOnly": false}},
            {
              "type": "repeat",
              "steps": [
                {"id": "read", "type": "command", "method": "page.read", "params": {"limit": 12000, "tabId": {"$ref": "steps.open.tab.id"}, "offset": {"$ref": "vars.offset"}, "includeElements": false}},
                {"name": "content", "type": "set", "value": {"$concat": [{"$ref": "vars.content"}, {"$ref": "steps.read.page.text"}]}},
                {"name": "offset", "type": "set", "value": {"$ref": "steps.read.page.nextOffset"}}
              ],
              "until": {"op": "falsey", "left": {"$ref": "steps.read.page.hasMore"}},
              "maxIterations": 20
            },
            {"id": "close", "type": "command", "method": "tabs.close", "params": {"tabId": {"$ref": "steps.open.tab.id"}}, "continueOnError": true}
          ],
          "output": {
            "url": {"$ref": "steps.read.page.url"},
            "text": {"$ref": "vars.content"},
            "title": {"$ref": "steps.read.page.title"},
            "totalTextChars": {"$ref": "steps.read.page.totalTextChars"}
          }
        }
      }
    ],
    "output": {"page": {"$ref": "steps.plan.result.result"}}
  }
  $json$::jsonb,
  'Open and read a long URL in one claimed v2 browser command using bounded 12k text-only chunks.',
  true
);

select public.opera_register_workflow(
  'research.v2_crawl_urls',
  $json$
  {
    "steps": [
      {
        "id": "plan",
        "type": "command",
        "method": "browser.plan",
        "params": {
          "input": {"urls": {"$ref": "input.urls"}},
          "steps": [
            {
              "type": "foreach",
              "items": {"$ref": "input.urls"},
              "itemVar": "url",
              "maxItems": 20,
              "collectVar": "pages",
              "steps": [
                {"name": "offset", "type": "set", "value": 0},
                {"name": "content", "type": "set", "value": ""},
                {"id": "open", "type": "command", "method": "tabs.open", "params": {"url": {"$ref": "vars.url"}, "wait": false, "active": false}},
                {"id": "ready", "type": "command", "method": "page.wait_for", "params": {"tabId": {"$ref": "steps.open.tab.id"}, "selector": "body", "timeoutMs": 12000, "visibleOnly": false}},
                {
                  "type": "repeat",
                  "steps": [
                    {"id": "read", "type": "command", "method": "page.read", "params": {"limit": 12000, "tabId": {"$ref": "steps.open.tab.id"}, "offset": {"$ref": "vars.offset"}, "includeElements": false}},
                    {"name": "content", "type": "set", "value": {"$concat": [{"$ref": "vars.content"}, {"$ref": "steps.read.page.text"}]}},
                    {"name": "offset", "type": "set", "value": {"$ref": "steps.read.page.nextOffset"}}
                  ],
                  "until": {"op": "falsey", "left": {"$ref": "steps.read.page.hasMore"}},
                  "maxIterations": 20
                },
                {"id": "close", "type": "command", "method": "tabs.close", "params": {"tabId": {"$ref": "steps.open.tab.id"}}, "continueOnError": true}
              ],
              "collect": {
                "url": {"$ref": "steps.read.page.url"},
                "text": {"$ref": "vars.content"},
                "title": {"$ref": "steps.read.page.title"},
                "totalTextChars": {"$ref": "steps.read.page.totalTextChars"}
              }
            }
          ],
          "output": {"pages": {"$ref": "vars.pages"}}
        }
      }
    ],
    "output": {"pages": {"$ref": "steps.plan.result.result.pages"}}
  }
  $json$::jsonb,
  'Sequentially crawl up to 20 URLs inside one bounded v2 local plan, avoiding one backend round trip per browser primitive.',
  true
);
