-- Add user_id to opera_workflow_runs so authenticated users can only see their own runs.
-- Discovering device_name from the run, then joining through opera_devices to user_id.

alter table public.opera_workflow_runs
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists opera_workflow_runs_user_id_idx
  on public.opera_workflow_runs(user_id);

create policy opera_workflow_runs_owner_read on public.opera_workflow_runs
  for select to authenticated using (
    exists (
      select 1 from public.opera_devices d
      where d.device_name = opera_workflow_runs.device_name
      and d.user_id = auth.uid()
    )
  );
