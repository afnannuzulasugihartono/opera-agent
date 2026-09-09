-- Generic, viewport-bounded trusted pointer input for canvas and dynamic UIs.
insert into public.opera_methods(method, default_timeout_ms, description)
values ('page.pointer', 8000, 'Move, click, drag, or wheel inside the active visible viewport with sensitive-target protection.')
on conflict(method) do update
  set default_timeout_ms = excluded.default_timeout_ms,
      description = excluded.description,
      enabled = true;
