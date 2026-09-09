-- Opt text-oriented workflows into the protocol-1 text-only page.read mode.
-- Existing workflow versions remain in opera_workflow_versions for rollback.
-- The migration intentionally derives from the active definitions established by
-- earlier migrations so site-specific orchestration is not duplicated here.

do $$
declare
  v_name text;
  v_workflow public.opera_workflows%rowtype;
  v_definition jsonb;
  v_result jsonb;
begin
  foreach v_name in array array[
    'research.read_current_full',
    'research.read_url_full',
    'youtube.get_transcript'
  ] loop
    select * into v_workflow
    from public.opera_workflows
    where name = v_name;

    if not found then
      raise exception 'Required workflow % is missing', v_name;
    end if;

    v_definition := replace(
      v_workflow.definition::text,
      '"maxElements": 1',
      '"maxElements": 1, "includeElements": false'
    )::jsonb;

    if v_definition = v_workflow.definition then
      raise exception 'Workflow % has no text-read payload to optimize', v_name;
    end if;

    v_result := public.opera_register_workflow(
      v_name,
      v_definition,
      left(v_workflow.description || ' Uses extension 1.1 text-only page reads.', 2000),
      v_workflow.enabled
    );

    if not coalesce((v_result->>'ok')::boolean, false) then
      raise exception 'Unable to register workflow %: %', v_name, coalesce(v_result->>'error', 'unknown error');
    end if;
  end loop;
end
$$;
