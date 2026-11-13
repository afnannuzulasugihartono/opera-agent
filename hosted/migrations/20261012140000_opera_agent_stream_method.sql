-- WHY THE STREAM NEEDS ITS OWN ROW.
-- The enqueue gate refuses any method the table does not list, so the new input primitive registers here exactly like every method before it: a longer default budget, because one stream carries up to a hundred events where one key carries one.

insert into public.opera_methods(method, default_timeout_ms, description) values
  ('page.stream', 30000, 'Trusted key/text event stream replayed back-to-back in one command.')
on conflict (method) do update set default_timeout_ms = excluded.default_timeout_ms,
  description = excluded.description;
