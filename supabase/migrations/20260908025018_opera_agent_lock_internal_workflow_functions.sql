-- Restrict Opera Agent workflow internals. Only privileged/server paths should invoke the workflow engine.
revoke all on function public.opera_execute_steps(jsonb,jsonb,timestamptz,text) from public, anon, authenticated;
revoke all on function public.opera_resolve_json(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.opera_eval_condition(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.opera_validate_steps(jsonb) from public, anon, authenticated;

-- Repeat outer revokes so reconstructed environments stay locked down.
revoke all on function public.opera_register_workflow(text,jsonb,text,boolean) from public, anon, authenticated;
revoke all on function public.opera_rollback_workflow(text,integer) from public, anon, authenticated;
revoke all on function public.opera_run_workflow(text,jsonb,integer,text) from public, anon, authenticated;
