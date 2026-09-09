-- Opera Agent v2 is a new extension identity/device line. The 1.0.1 and legacy
-- release records remain untouched and usable as fallback/history.

insert into public.opera_methods(method, default_timeout_ms, enabled, description)
values ('browser.plan', 55000, true, 'Execute a bounded declarative sequence of existing allowlisted browser primitives locally in Opera Agent v2.')
on conflict(method) do update
set default_timeout_ms = excluded.default_timeout_ms,
    enabled = excluded.enabled,
    description = excluded.description;

create table if not exists public.opera_v2_releases (
  version text primary key,
  extension_id text not null,
  crx_base64 text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer not null check (size_bytes > 0),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  notes text not null default ''
);

create unique index if not exists opera_v2_releases_one_active_idx
  on public.opera_v2_releases ((active)) where active = true;

alter table public.opera_v2_releases enable row level security;
revoke all on table public.opera_v2_releases from anon, authenticated;
grant select, insert, update, delete on table public.opera_v2_releases to service_role;
comment on table public.opera_v2_releases is
  'Signed CRX artifacts for the separate Opera Agent v2 identity. Does not replace public.opera_releases (1.0.x).';

select public.opera_register_workflow(
  'browser.v2_status',
  '{
    "steps":[
      {"type":"command","id":"plan","method":"browser.plan","params":{
        "steps":[{"type":"command","id":"ping","method":"browser.ping","params":{}}],
        "output":{"ping":{"$ref":"steps.ping"}}
      }}
    ],
    "output":{"result":{"$ref":"steps.plan.result.result"}}
  }'::jsonb,
  'Opera Agent v2 status through one local browser.plan command.',
  true
);

select public.opera_register_workflow(
  'research.v2_read_url_full',
  '{
    "steps":[
      {"type":"command","id":"plan","method":"browser.plan","params":{
        "input":{"url":{"$ref":"input.url"}},
        "steps":[
          {"type":"set","name":"offset","value":0},
          {"type":"set","name":"content","value":""},
          {"type":"command","id":"open","method":"tabs.open","params":{"url":{"$ref":"input.url"},"active":false,"wait":false}},
          {"type":"command","id":"ready","method":"page.wait_for","params":{"tabId":{"$ref":"steps.open.tab.id"},"selector":"body","timeoutMs":12000,"visibleOnly":false}},
          {"type":"repeat","maxIterations":20,"steps":[
            {"type":"command","id":"read","method":"page.read","params":{"tabId":{"$ref":"steps.open.tab.id"},"offset":{"$ref":"vars.offset"},"limit":12000,"includeElements":false}},
            {"type":"set","name":"content","value":{"$concat":[{"$ref":"vars.content"},{"$ref":"steps.read.page.text"}]}},
            {"type":"set","name":"offset","value":{"$ref":"steps.read.page.nextOffset"}}
          ],"until":{"left":{"$ref":"steps.read.page.hasMore"},"op":"falsey"}},
          {"type":"command","id":"close","method":"tabs.close","params":{"tabId":{"$ref":"steps.open.tab.id"}},"continueOnError":true}
        ],
        "output":{
          "title":{"$ref":"steps.read.page.title"},
          "url":{"$ref":"steps.read.page.url"},
          "text":{"$ref":"vars.content"},
          "totalTextChars":{"$ref":"steps.read.page.totalTextChars"}
        }
      }}
    ],
    "output":{"page":{"$ref":"steps.plan.result.result"}}
  }'::jsonb,
  'Open and read a long URL in one claimed v2 browser command using bounded 12k text-only chunks.',
  true
);

select public.opera_register_workflow(
  'research.v2_read_current_full',
  '{
    "steps":[
      {"type":"command","id":"plan","method":"browser.plan","params":{
        "steps":[
          {"type":"set","name":"offset","value":0},
          {"type":"set","name":"content","value":""},
          {"type":"command","id":"tab","method":"tabs.get","params":{}},
          {"type":"repeat","maxIterations":20,"steps":[
            {"type":"command","id":"read","method":"page.read","params":{"tabId":{"$ref":"steps.tab.tab.id"},"offset":{"$ref":"vars.offset"},"limit":12000,"includeElements":false}},
            {"type":"set","name":"content","value":{"$concat":[{"$ref":"vars.content"},{"$ref":"steps.read.page.text"}]}},
            {"type":"set","name":"offset","value":{"$ref":"steps.read.page.nextOffset"}}
          ],"until":{"left":{"$ref":"steps.read.page.hasMore"},"op":"falsey"}}
        ],
        "output":{
          "tab":{"$ref":"steps.tab.tab"},
          "title":{"$ref":"steps.read.page.title"},
          "url":{"$ref":"steps.read.page.url"},
          "text":{"$ref":"vars.content"},
          "totalTextChars":{"$ref":"steps.read.page.totalTextChars"}
        }
      }}
    ],
    "output":{"page":{"$ref":"steps.plan.result.result"}}
  }'::jsonb,
  'Read the current page in one claimed v2 browser command using bounded 12k text-only chunks.',
  true
);

select public.opera_register_workflow(
  'research.v2_crawl_urls',
  '{
    "steps":[
      {"type":"command","id":"plan","method":"browser.plan","params":{
        "input":{"urls":{"$ref":"input.urls"}},
        "steps":[
          {"type":"foreach","items":{"$ref":"input.urls"},"itemVar":"url","maxItems":20,"collectVar":"pages","steps":[
            {"type":"set","name":"offset","value":0},
            {"type":"set","name":"content","value":""},
            {"type":"command","id":"open","method":"tabs.open","params":{"url":{"$ref":"vars.url"},"active":false,"wait":false}},
            {"type":"command","id":"ready","method":"page.wait_for","params":{"tabId":{"$ref":"steps.open.tab.id"},"selector":"body","timeoutMs":12000,"visibleOnly":false}},
            {"type":"repeat","maxIterations":20,"steps":[
              {"type":"command","id":"read","method":"page.read","params":{"tabId":{"$ref":"steps.open.tab.id"},"offset":{"$ref":"vars.offset"},"limit":12000,"includeElements":false}},
              {"type":"set","name":"content","value":{"$concat":[{"$ref":"vars.content"},{"$ref":"steps.read.page.text"}]}},
              {"type":"set","name":"offset","value":{"$ref":"steps.read.page.nextOffset"}}
            ],"until":{"left":{"$ref":"steps.read.page.hasMore"},"op":"falsey"}},
            {"type":"command","id":"close","method":"tabs.close","params":{"tabId":{"$ref":"steps.open.tab.id"}},"continueOnError":true}
          ],"collect":{
            "title":{"$ref":"steps.read.page.title"},
            "url":{"$ref":"steps.read.page.url"},
            "text":{"$ref":"vars.content"},
            "totalTextChars":{"$ref":"steps.read.page.totalTextChars"}
          }}
        ],
        "output":{"pages":{"$ref":"vars.pages"}}
      }}
    ],
    "output":{"pages":{"$ref":"steps.plan.result.result.pages"}}
  }'::jsonb,
  'Sequentially crawl up to 20 URLs inside one bounded v2 local plan, avoiding one backend round trip per browser primitive.',
  true
);
