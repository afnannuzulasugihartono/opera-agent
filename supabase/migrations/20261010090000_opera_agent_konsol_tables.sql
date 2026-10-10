-- The table editor on the dashboard: sixteen tables read through three functions, zero grants.
--
-- WHY functions and not grants: isolation rests on two layers — the missing grant is
-- layer one and row policies are layer two, and tests/konsol-tables.test.mjs pins
-- both in this file while tests/landing-dashboard.test.mjs pins the page's calls.
-- Handing SELECT to authenticated would spend layer one on convenience. The reader is
-- SECURITY DEFINER instead: it filters by auth.uid() itself, masks secret columns before
-- they leave the database, and needs no table grant at all.
--
-- WHY opera_operator: signup is open (seventeen other accounts already exist here) and
-- seven tables carry no owner column — workflow definitions, skills, update telemetry,
-- the method registry, the installers. "Any signed-in account" is the wrong rule for
-- those, and pairing does not prove the caller is the operator: opera_create_pairing_code
-- asks no role, so any account can issue a code and pair a device to itself. The flag
-- table says it outright, seeded from the account behind the earliest paired device.
--
-- WHY the predicate text lives twice: a policy cannot call a lookup, and a SECURITY
-- DEFINER function bypasses policies by design, so opera_konsol_scope() and every USING
-- clause below repeat the same parenthesized qual. The repetition is not free-form:
-- tests/konsol-tables.test.mjs compares the two copies string for string, so they cannot
-- drift. (The live project already carried one silent drift: opera_workflow_runs_owner_read
-- was applied as d.device_name = d.device_name — a tautology granting every paired account
-- every run. This migration drops it and rebuilds the predicate from the map.)

create table if not exists public.opera_operator (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.opera_operator enable row level security;

-- WHY earliest paired device and not a hardcoded id: the seed must mean the same thing
-- on any environment with a paired device, and the first device on a project belongs to
-- whoever set it up. A fresh install seeds nothing; an operator is inserted by hand there.
insert into public.opera_operator (user_id)
  select user_id from public.opera_devices where user_id is not null
  group by user_id order by min(created_at) asc limit 1
  on conflict (user_id) do nothing;

-- WHY this toggle: opera_skills has run with row security off while its grants were
-- revoked from anon and authenticated — layer one alone, unlike every other table here.
-- The line makes both layers uniform and changes no access, because no grant exists to act on.
alter table public.opera_skills enable row level security;

-- The scope map: one row per table, every qual fully parenthesized so the reader can
-- append `and <search>` without an OR escaping its group. Scope 'owner' means rows are
-- filtered per caller; scope 'operator' means the whole table is refused without the flag.
create or replace function public.opera_konsol_scope()
returns table (tbl text, scope text, qual text)
language sql stable
as $$
  values
    ('opera_audit', 'owner', '(exists (select 1 from public.opera_devices d where d.id = opera_audit.device_id and d.user_id = auth.uid()) or exists (select 1 from public.opera_commands c join public.opera_devices d on d.id = c.device_id where c.id = opera_audit.command_id and d.user_id = auth.uid()) or exists (select 1 from public.opera_operator o where o.user_id = auth.uid()))'),
    ('opera_commands', 'owner', '(exists (select 1 from public.opera_devices d where d.id = opera_commands.device_id and d.user_id = auth.uid()))'),
    ('opera_devices', 'owner', '(opera_devices.user_id = auth.uid())'),
    ('opera_listen_chunks', 'owner', '(exists (select 1 from public.opera_listen_sessions s where s.id = opera_listen_chunks.session_id and s.user_id = auth.uid()))'),
    ('opera_listen_segments', 'owner', '(exists (select 1 from public.opera_listen_sessions s where s.id = opera_listen_segments.session_id and s.user_id = auth.uid()))'),
    ('opera_listen_sessions', 'owner', '(opera_listen_sessions.user_id = auth.uid())'),
    ('opera_pairing_codes', 'owner', '(opera_pairing_codes.issued_by = auth.uid())'),
    ('opera_watch_events', 'owner', '(exists (select 1 from public.opera_devices d where d.device_name = opera_watch_events.device_name and d.user_id = auth.uid()) or exists (select 1 from public.opera_operator o where o.user_id = auth.uid()))'),
    ('opera_workflow_runs', 'owner', '((opera_workflow_runs.user_id = auth.uid()) or exists (select 1 from public.opera_devices d where d.device_name = opera_workflow_runs.device_name and d.user_id = auth.uid()))'),
    ('opera_methods', 'operator', '(exists (select 1 from public.opera_operator o where o.user_id = auth.uid()))'),
    ('opera_releases', 'operator', '(exists (select 1 from public.opera_operator o where o.user_id = auth.uid()))'),
    ('opera_skills', 'operator', '(exists (select 1 from public.opera_operator o where o.user_id = auth.uid()))'),
    ('opera_update_events', 'operator', '(exists (select 1 from public.opera_operator o where o.user_id = auth.uid()))'),
    ('opera_v2_releases', 'operator', '(exists (select 1 from public.opera_operator o where o.user_id = auth.uid()))'),
    ('opera_workflow_versions', 'operator', '(exists (select 1 from public.opera_operator o where o.user_id = auth.uid()))'),
    ('opera_workflows', 'operator', '(exists (select 1 from public.opera_operator o where o.user_id = auth.uid()))')
$$;

create or replace function public.opera_konsol_tables()
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_operator boolean;
  v_rec record;
  v_tables jsonb := '[]'::jsonb;
  v_total bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in.');
  end if;
  v_operator := exists (select 1 from public.opera_operator o where o.user_id = v_uid);

  -- WHY the count rides the qual: a table the caller cannot read must show no number
  -- at all, and a count outside the predicate would leak row totals the caller has no
  -- right to see, even behind a disabled cell.
  for v_rec in select s.tbl, s.scope, s.qual from public.opera_konsol_scope() s loop
    if v_rec.scope = 'operator' and not v_operator then
      v_tables := v_tables || jsonb_build_object('name', v_rec.tbl, 'scope', v_rec.scope, 'readable', false, 'total', null);
      continue;
    end if;
    execute format('select count(*) from public.%I where %s', v_rec.tbl, v_rec.qual) into v_total;
    v_tables := v_tables || jsonb_build_object('name', v_rec.tbl, 'scope', v_rec.scope, 'readable', true, 'total', v_total);
  end loop;
  return jsonb_build_object('ok', true, 'operator', v_operator, 'tables', v_tables);
end $$;

create or replace function public.opera_konsol_table(
  p_table text,
  p_limit integer default 50,
  p_offset integer default 0,
  p_search text default null,
  p_sort text default null,
  p_dir text default null
)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_operator boolean;
  v_rec record;
  v_cols jsonb;
  v_rows jsonb;
  v_out jsonb := '[]'::jsonb;
  v_row jsonb;
  v_detail jsonb;
  v_total bigint;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_dir text := case when lower(coalesce(p_dir, 'desc')) = 'asc' then 'asc' else 'desc' end;
  v_search text := left(coalesce(p_search, ''), 64);
  v_order text;
  v_pk_names text[];
  v_pk_order text := '';
  v_sort_ok boolean;
  v_where text;
  v_sql text;
  v_key text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in.');
  end if;
  select * into v_rec from public.opera_konsol_scope() s where s.tbl = lower(coalesce(p_table, ''));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Unknown table.');
  end if;
  v_operator := exists (select 1 from public.opera_operator o where o.user_id = v_uid);
  if v_rec.scope = 'operator' and not v_operator then
    return jsonb_build_object('ok', false, 'error', 'That table belongs to the operator account.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('name', column_name, 'type', data_type) order by ordinal_position), '[]'::jsonb)
    into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = v_rec.tbl;

  -- WHY the primary key is read from the catalog: paging with OFFSET needs one stable
  -- order, and a table without created_at (or without any key) still has to sort by
  -- something deterministic or page two repeats rows from page one.
  select coalesce(array_agg(a.attname order by a.attnum), array[]::text[])
    into v_pk_names
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = ('public.' || v_rec.tbl)::regclass and i.indisprimary;
  select coalesce(string_agg(format('%I', x), ', ' order by ord), '')
    into v_pk_order
    from unnest(v_pk_names) with ordinality as keys(x, ord);

  -- WHY the sort is validated and quoted: p_sort is spliced into dynamic SQL, so it
  -- becomes a quoted identifier only after it is proven to be a real column of this table.
  if p_sort is not null then
    select exists (
      select 1 from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = v_rec.tbl and c.column_name = p_sort
    ) into v_sort_ok;
    if v_sort_ok then
      v_order := format('%I %s', p_sort, v_dir);
      if v_pk_order <> '' and not (p_sort = any (v_pk_names)) then
        v_order := v_order || ', ' || v_pk_order;
      end if;
    end if;
  end if;
  if v_order is null then
    select exists (
      select 1 from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = v_rec.tbl and c.column_name = 'created_at'
    ) into v_sort_ok;
    if v_sort_ok then
      v_order := 'created_at desc';
      if v_pk_order <> '' then
        v_order := v_order || ', ' || v_pk_order;
      end if;
    elsif v_pk_order <> '' then
      v_order := v_pk_order;
    else
      select format('%I', column_name) into v_order
        from information_schema.columns
       where table_schema = 'public' and table_name = v_rec.tbl
       order by ordinal_position limit 1;
    end if;
  end if;

  -- WHY two paths instead of one: measured on this project, serialising all 28,745
  -- audit rows to text for an empty ilike '%%' costs 253ms where the bare predicate
  -- costs 25ms, so the default page — nobody has typed yet — never touches to_jsonb.
  -- A typed search pays that one scan as the price of its filter, on an explicit
  -- request. The placeholder is $1 because plpgsql EXECUTE does not substitute bare
  -- ? — it would parse as the jsonb operator and die at the end of the string.
  v_where := v_rec.qual;
  if v_search <> '' then
    v_where := format('%s and to_jsonb(%I)::text ilike $1', v_rec.qual, v_rec.tbl);
  end if;
  v_sql := format('select count(*) from public.%I where %s', v_rec.tbl, v_where);
  if v_search = '' then
    execute v_sql into v_total;
  else
    execute v_sql into v_total using ('%' || v_search || '%');
  end if;
  v_sql := format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from public.%I where %s order by %s limit %s offset %s) t',
    v_rec.tbl, v_where, v_order, v_limit, v_offset
  );
  if v_search = '' then
    execute v_sql into v_rows;
  else
    execute v_sql into v_rows using ('%' || v_search || '%');
  end if;

  -- WHY masking happens here and never in the page: a hash that never leaves the
  -- database cannot be asked for again by a modified client. Short values keep four
  -- characters so two devices are still tellable apart; blobs report their length,
  -- which is the only fact a grid cell ever had about them.
  for v_row in select value from jsonb_array_elements(v_rows) loop
    foreach v_key in array array['token_hash', 'code_hash'] loop
      if v_row ? v_key and jsonb_typeof(v_row -> v_key) = 'string' then
        v_row := v_row || jsonb_build_object(v_key, left(v_row ->> v_key, 4) || '…');
      end if;
    end loop;
    foreach v_key in array array['audio_base64', 'crx_base64'] loop
      if v_row ? v_key and jsonb_typeof(v_row -> v_key) = 'string' then
        v_row := v_row || jsonb_build_object(v_key, length(v_row ->> v_key) || ' chars omitted');
      end if;
    end loop;
    if v_row ? 'details' and jsonb_typeof(v_row -> 'details') = 'object' then
      v_detail := v_row -> 'details';
      if v_detail ? 'token_hash' then
        v_detail := v_detail || jsonb_build_object('token_hash', '…');
      end if;
      if v_detail ? 'archive_b64' and jsonb_typeof(v_detail -> 'archive_b64') = 'string' then
        v_detail := v_detail || jsonb_build_object('archive_b64', length(v_detail ->> 'archive_b64') || ' chars omitted');
      end if;
      v_row := v_row || jsonb_build_object('details', v_detail);
    end if;
    v_out := v_out || jsonb_build_array(v_row);
  end loop;

  return jsonb_build_object(
    'ok', true, 'table', v_rec.tbl, 'scope', v_rec.scope,
    'columns', v_cols, 'rows', v_out, 'total', v_total, 'operator', v_operator
  );
end $$;

-- Layer two, table by table, with the predicate copied verbatim from the map above.
-- No grant changes anywhere: the missing grant stays layer one, and these policies are
-- what keep the rows owned the day someone adds one.

drop policy if exists opera_audit_owner_read on public.opera_audit;
create policy opera_audit_owner_read on public.opera_audit for select to authenticated using ((exists (select 1 from public.opera_devices d where d.id = opera_audit.device_id and d.user_id = auth.uid()) or exists (select 1 from public.opera_commands c join public.opera_devices d on d.id = c.device_id where c.id = opera_audit.command_id and d.user_id = auth.uid()) or exists (select 1 from public.opera_operator o where o.user_id = auth.uid())));

drop policy if exists opera_listen_chunks_owner_read on public.opera_listen_chunks;
create policy opera_listen_chunks_owner_read on public.opera_listen_chunks for select to authenticated using ((exists (select 1 from public.opera_listen_sessions s where s.id = opera_listen_chunks.session_id and s.user_id = auth.uid())));

drop policy if exists opera_watch_events_owner_read on public.opera_watch_events;
create policy opera_watch_events_owner_read on public.opera_watch_events for select to authenticated using ((exists (select 1 from public.opera_devices d where d.device_name = opera_watch_events.device_name and d.user_id = auth.uid()) or exists (select 1 from public.opera_operator o where o.user_id = auth.uid())));

drop policy if exists opera_workflow_runs_owner_read on public.opera_workflow_runs;
create policy opera_workflow_runs_owner_read on public.opera_workflow_runs for select to authenticated using (((opera_workflow_runs.user_id = auth.uid()) or exists (select 1 from public.opera_devices d where d.device_name = opera_workflow_runs.device_name and d.user_id = auth.uid())));

drop policy if exists opera_methods_operator_read on public.opera_methods;
create policy opera_methods_operator_read on public.opera_methods for select to authenticated using ((exists (select 1 from public.opera_operator o where o.user_id = auth.uid())));

drop policy if exists opera_releases_operator_read on public.opera_releases;
create policy opera_releases_operator_read on public.opera_releases for select to authenticated using ((exists (select 1 from public.opera_operator o where o.user_id = auth.uid())));

drop policy if exists opera_skills_operator_read on public.opera_skills;
create policy opera_skills_operator_read on public.opera_skills for select to authenticated using ((exists (select 1 from public.opera_operator o where o.user_id = auth.uid())));

drop policy if exists opera_update_events_operator_read on public.opera_update_events;
create policy opera_update_events_operator_read on public.opera_update_events for select to authenticated using ((exists (select 1 from public.opera_operator o where o.user_id = auth.uid())));

drop policy if exists opera_v2_releases_operator_read on public.opera_v2_releases;
create policy opera_v2_releases_operator_read on public.opera_v2_releases for select to authenticated using ((exists (select 1 from public.opera_operator o where o.user_id = auth.uid())));

drop policy if exists opera_workflow_versions_operator_read on public.opera_workflow_versions;
create policy opera_workflow_versions_operator_read on public.opera_workflow_versions for select to authenticated using ((exists (select 1 from public.opera_operator o where o.user_id = auth.uid())));

drop policy if exists opera_workflows_operator_read on public.opera_workflows;
create policy opera_workflows_operator_read on public.opera_workflows for select to authenticated using ((exists (select 1 from public.opera_operator o where o.user_id = auth.uid())));

-- The five tables whose first policies were written before this file — devices,
-- commands, pairing codes, listen sessions, listen segments — state the same rule
-- in unqualified words: `user_id = auth.uid()` where the map says
-- `opera_devices.user_id = auth.uid()`. Both forms always resolved to one door, but
-- a string-for-string drift test can only compare what one file holds, so these
-- five are rebuilt from the map here: same door, identical text, and the file above
-- then describes every policy the console rests on.

drop policy if exists opera_devices_owner_read on public.opera_devices;
create policy opera_devices_owner_read on public.opera_devices for select to authenticated using ((opera_devices.user_id = auth.uid()));

drop policy if exists opera_commands_owner_read on public.opera_commands;
create policy opera_commands_owner_read on public.opera_commands for select to authenticated using ((exists (select 1 from public.opera_devices d where d.id = opera_commands.device_id and d.user_id = auth.uid())));

drop policy if exists opera_pairing_codes_owner_read on public.opera_pairing_codes;
create policy opera_pairing_codes_owner_read on public.opera_pairing_codes for select to authenticated using ((opera_pairing_codes.issued_by = auth.uid()));

drop policy if exists opera_listen_sessions_owner_read on public.opera_listen_sessions;
create policy opera_listen_sessions_owner_read on public.opera_listen_sessions for select to authenticated using ((opera_listen_sessions.user_id = auth.uid()));

drop policy if exists opera_listen_segments_owner_read on public.opera_listen_segments;
create policy opera_listen_segments_owner_read on public.opera_listen_segments for select to authenticated using ((exists (select 1 from public.opera_listen_sessions s where s.id = opera_listen_segments.session_id and s.user_id = auth.uid())));

-- The flag table inherits Supabase's default table grants the moment it is created,
-- so layer one is taken back the way every other table in this project takes it back:
-- anon and authenticated hold nothing, and the policies above are then the only door.
revoke all on public.opera_operator from anon, authenticated;

-- The scope map stays owner-readable by nothing: it holds no rows, and the two readers
-- reach it as owners inside their definer bodies. Signed-in callers get the two readers.
revoke execute on function public.opera_konsol_scope() from public, anon, authenticated;
revoke execute on function public.opera_konsol_tables() from public, anon;
grant execute on function public.opera_konsol_tables() to authenticated;
revoke execute on function public.opera_konsol_table(text, integer, integer, text, text, text) from public, anon;
grant execute on function public.opera_konsol_table(text, integer, integer, text, text, text) to authenticated;
