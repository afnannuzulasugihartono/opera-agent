-- Skill memory RPCs v1 (2026-10-09): manual save/recall over public.opera_skills.

-- Manual path first, per the table header: after a task the caller saves what worked, what failed, and what recovered it; before a task it recalls matching lessons into context.
-- No automatic extraction here, no MCP tool, no extension dependency, and no pg_trgm: recall matches with ILIKE.

-- Lengths are truncated, never rejected: an overlong field is clipped with left(...) so a save always lands.
-- Only empty task/lesson is refused, with an INVALID_INPUT envelope.

create or replace function public.opera_skill_save(
  p_task text,
  p_lesson text,
  p_site text default '',
  p_pitfalls text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(trim(p_task),'')='' or coalesce(trim(p_lesson),'')='' then
    return jsonb_build_object('ok',false,'error',jsonb_build_object('code','INVALID_INPUT','message','Task and lesson must not be empty.'));
  end if;

  insert into public.opera_skills(task, site, lesson, pitfalls)
  values(left(trim(p_task),500), left(coalesce(p_site,''),120), left(trim(p_lesson),4000), left(coalesce(p_pitfalls,''),2000))
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end;
$$;

create or replace function public.opera_skill_recall(
  p_query text,
  p_site text default '',
  p_limit integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit,5),1),20);
  v_escaped text;
  v_skills jsonb;
begin

  v_escaped := replace(replace(replace(coalesce(p_query,''), '\', '\\'), '%', '\%'), '_', '\_');
  select coalesce(jsonb_agg(s.skill), '[]'::jsonb) into v_skills
  from (
    select jsonb_build_object('task',task,'site',site,'lesson',lesson,'pitfalls',pitfalls) as skill
    from public.opera_skills
    where (task ilike '%' || v_escaped || '%' escape '\'
      or lesson ilike '%' || v_escaped || '%' escape '\')
      and (coalesce(p_site,'')='' or site = p_site)
    order by created_at desc, id desc
    limit v_limit
  ) s;
  return jsonb_build_object('ok',true,'skills',v_skills);
end;
$$;

revoke all on function public.opera_skill_save(text,text,text,text) from public,anon,authenticated;
grant execute on function public.opera_skill_save(text,text,text,text) to service_role;
revoke all on function public.opera_skill_recall(text,text,integer) from public,anon,authenticated;
grant execute on function public.opera_skill_recall(text,text,integer) to service_role;
