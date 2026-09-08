-- Opera Agent 1.0.0 core schema.
-- Legacy loa_v3_* objects are intentionally left untouched.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.opera_methods (
  method text primary key,
  default_timeout_ms integer not null check (default_timeout_ms between 500 and 55000),
  enabled boolean not null default true,
  description text not null default ''
);

create table if not exists public.opera_devices (
  id uuid primary key default gen_random_uuid(),
  device_name text not null unique check (char_length(device_name) between 1 and 64),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'offline' check (status in ('offline','online','disabled')),
  extension_version text not null default '',
  protocol_version integer not null default 1,
  capabilities jsonb not null default '[]'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.opera_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  device_name text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.opera_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.opera_devices(id) on delete cascade,
  request_id text,
  method text not null references public.opera_methods(method),
  params jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','claimed','completed','failed','expired','cancelled')),
  timeout_ms integer not null check (timeout_ms between 500 and 55000),
  attempts integer not null default 0,
  result jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null
);
create unique index if not exists opera_commands_request_id_uidx on public.opera_commands(device_id,request_id) where request_id is not null;
create index if not exists opera_commands_queue_idx on public.opera_commands(device_id,status,created_at) where status in ('queued','claimed');
create index if not exists opera_commands_expires_idx on public.opera_commands(expires_at) where status in ('queued','claimed');

create table if not exists public.opera_workflows (
  name text primary key check (name ~ '^[a-z0-9][a-z0-9._-]{1,127}$'),
  version integer not null check (version > 0),
  enabled boolean not null default true,
  description text not null default '',
  definition jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.opera_workflow_versions (
  name text not null,
  version integer not null,
  description text not null default '',
  definition jsonb not null,
  created_at timestamptz not null default now(),
  primary key(name,version)
);
create table if not exists public.opera_audit (
  id bigint generated always as identity primary key,
  event_type text not null,
  device_id uuid,
  command_id uuid,
  workflow_name text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists opera_audit_created_idx on public.opera_audit(created_at desc);

alter table public.opera_methods enable row level security;
alter table public.opera_devices enable row level security;
alter table public.opera_pairing_codes enable row level security;
alter table public.opera_commands enable row level security;
alter table public.opera_workflows enable row level security;
alter table public.opera_workflow_versions enable row level security;
alter table public.opera_audit enable row level security;
revoke all on public.opera_methods, public.opera_devices, public.opera_pairing_codes, public.opera_commands, public.opera_workflows, public.opera_workflow_versions, public.opera_audit from anon,authenticated;

insert into public.opera_methods(method,default_timeout_ms,description) values
('browser.ping',3000,'Return bridge/version/capability state.'),
('tabs.list',5000,'List browser tabs.'),('tabs.get',5000,'Read one tab.'),('tabs.find',5000,'Find tabs by URL/title filters.'),
('tabs.open',10000,'Open an http/https tab.'),('tabs.activate',5000,'Activate a tab.'),('tabs.close',5000,'Close a tab.'),
('tabs.navigate',15000,'Navigate a tab.'),('tabs.reload',15000,'Reload a tab.'),
('page.read',10000,'Read bounded semantic page content.'),('page.query',8000,'Query by CSS selector.'),('page.find',8000,'Find semantic interactive elements.'),
('page.collect_links',10000,'Collect normalized links.'),('page.click',8000,'Click a referenced element.'),('page.fill',8000,'Fill a safe editable element.'),
('page.focus',5000,'Focus a referenced element.'),('page.scroll',5000,'Scroll page or element.'),('page.key',5000,'Send allowlisted navigation key.'),
('page.wait_for',15000,'Wait for page state.'),('media.state',5000,'Read media state.'),('media.play',5000,'Play media.'),('media.pause',5000,'Pause media.'),('media.seek',5000,'Seek media.')
on conflict(method) do update set default_timeout_ms=excluded.default_timeout_ms,description=excluded.description,enabled=true;

create or replace function public.opera_sha256(p_value text) returns text
language sql immutable set search_path=public,extensions as $$
select encode(digest(coalesce(p_value,''),'sha256'),'hex');
$$;

create or replace function public.opera_create_pairing_code(p_device_name text default 'opera',p_ttl_minutes integer default 10) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare v_code text; v_expires timestamptz;
begin
  if p_device_name is null or char_length(trim(p_device_name)) not between 1 and 64 then return jsonb_build_object('ok',false,'error','Invalid device name.'); end if;
  p_ttl_minutes:=least(greatest(coalesce(p_ttl_minutes,10),1),60);
  update public.opera_pairing_codes set consumed_at=now() where device_name=trim(p_device_name) and consumed_at is null;
  v_code:=upper(substr(encode(gen_random_bytes(12),'hex'),1,16));
  v_expires:=now()+make_interval(mins=>p_ttl_minutes);
  insert into public.opera_pairing_codes(code_hash,device_name,expires_at) values(public.opera_sha256(v_code),trim(p_device_name),v_expires);
  insert into public.opera_audit(event_type,details) values('pairing_code.created',jsonb_build_object('deviceName',trim(p_device_name),'expiresAt',v_expires));
  return jsonb_build_object('ok',true,'deviceName',trim(p_device_name),'code',v_code,'expiresAt',v_expires);
end $$;

create or replace function public.opera_pair_device(p_code text,p_token_hash text,p_device_name text,p_extension_version text,p_protocol_version integer,p_capabilities jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare v_pair public.opera_pairing_codes%rowtype; v_device public.opera_devices%rowtype;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'error','Invalid device token hash.'); end if;
  select * into v_pair from public.opera_pairing_codes where code_hash=public.opera_sha256(upper(trim(p_code))) and device_name=trim(p_device_name) and consumed_at is null and expires_at>now() for update;
  if not found then return jsonb_build_object('ok',false,'error','Pairing code is invalid or expired.'); end if;
  insert into public.opera_devices(device_name,token_hash,status,extension_version,protocol_version,capabilities,last_seen_at,updated_at)
  values(trim(p_device_name),p_token_hash,'online',left(coalesce(p_extension_version,''),64),coalesce(p_protocol_version,1),coalesce(p_capabilities,'[]'::jsonb),now(),now())
  on conflict(device_name) do update set token_hash=excluded.token_hash,status='online',extension_version=excluded.extension_version,protocol_version=excluded.protocol_version,capabilities=excluded.capabilities,last_seen_at=now(),updated_at=now()
  returning * into v_device;
  update public.opera_pairing_codes set consumed_at=now() where id=v_pair.id;
  insert into public.opera_audit(event_type,device_id,details) values('device.paired',v_device.id,jsonb_build_object('deviceName',v_device.device_name,'version',v_device.extension_version,'protocolVersion',v_device.protocol_version));
  return jsonb_build_object('ok',true,'deviceId',v_device.id,'deviceName',v_device.device_name,'protocolVersion',v_device.protocol_version);
end $$;

create or replace function public.opera_auth_device(p_device_name text,p_token_hash text) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin select id into v_id from public.opera_devices where device_name=trim(p_device_name) and token_hash=p_token_hash and status<>'disabled'; return v_id; end $$;

create or replace function public.opera_heartbeat(p_device_name text,p_token_hash text,p_extension_version text,p_protocol_version integer,p_capabilities jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  v_id:=public.opera_auth_device(p_device_name,p_token_hash); if v_id is null then return jsonb_build_object('ok',false,'error','Unauthorized device.'); end if;
  update public.opera_devices set status='online',extension_version=left(coalesce(p_extension_version,''),64),protocol_version=coalesce(p_protocol_version,protocol_version),capabilities=coalesce(p_capabilities,capabilities),last_seen_at=now(),updated_at=now() where id=v_id;
  return jsonb_build_object('ok',true,'deviceId',v_id,'serverTime',now());
end $$;

create or replace function public.opera_claim_next(p_device_name text,p_token_hash text,p_extension_version text default '',p_protocol_version integer default 1,p_capabilities jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_device_id uuid; v_cmd public.opera_commands%rowtype;
begin
  v_device_id:=public.opera_auth_device(p_device_name,p_token_hash); if v_device_id is null then return jsonb_build_object('ok',false,'error','Unauthorized device.'); end if;
  update public.opera_devices set status='online',extension_version=case when coalesce(p_extension_version,'')<>'' then left(p_extension_version,64) else extension_version end,protocol_version=coalesce(p_protocol_version,protocol_version),capabilities=case when jsonb_typeof(coalesce(p_capabilities,'[]'::jsonb))='array' then p_capabilities else capabilities end,last_seen_at=now(),updated_at=now() where id=v_device_id and (last_seen_at is null or last_seen_at<now()-interval '3 seconds');
  update public.opera_commands set status='expired',completed_at=now(),error=jsonb_build_object('code','EXPIRED','message','Command expired before execution.') where device_id=v_device_id and status in ('queued','claimed') and expires_at<=now();
  select * into v_cmd from public.opera_commands where device_id=v_device_id and status='queued' and expires_at>now() order by created_at for update skip locked limit 1;
  if not found then return jsonb_build_object('ok',true,'command',null); end if;
  update public.opera_commands set status='claimed',attempts=attempts+1,claimed_at=now() where id=v_cmd.id returning * into v_cmd;
  insert into public.opera_audit(event_type,device_id,command_id,details) values('command.claimed',v_device_id,v_cmd.id,jsonb_build_object('method',v_cmd.method,'attempt',v_cmd.attempts));
  return jsonb_build_object('ok',true,'command',jsonb_build_object('id',v_cmd.id,'method',v_cmd.method,'params',v_cmd.params,'timeoutMs',v_cmd.timeout_ms));
end $$;

create or replace function public.opera_complete_command(p_device_name text,p_token_hash text,p_command_id uuid,p_ok boolean,p_result jsonb default null,p_error jsonb default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_device_id uuid; v_cmd public.opera_commands%rowtype;
begin
  v_device_id:=public.opera_auth_device(p_device_name,p_token_hash); if v_device_id is null then return jsonb_build_object('ok',false,'error','Unauthorized device.'); end if;
  select * into v_cmd from public.opera_commands where id=p_command_id and device_id=v_device_id for update;
  if not found then return jsonb_build_object('ok',false,'error','Command not found.'); end if;
  if v_cmd.status in ('completed','failed') then return jsonb_build_object('ok',true,'idempotent',true,'status',v_cmd.status); end if;
  if v_cmd.status not in ('claimed','queued') then return jsonb_build_object('ok',false,'error','Command is no longer completable.','status',v_cmd.status); end if;
  update public.opera_commands set status=case when p_ok then 'completed' else 'failed' end,result=case when p_ok then coalesce(p_result,'{}'::jsonb) else null end,error=case when p_ok then null else coalesce(p_error,jsonb_build_object('code','EXECUTION_ERROR','message','Command failed.')) end,completed_at=now() where id=p_command_id returning * into v_cmd;
  update public.opera_devices set status='online',last_seen_at=now(),updated_at=now() where id=v_device_id;
  insert into public.opera_audit(event_type,device_id,command_id,details) values('command.completed',v_device_id,v_cmd.id,jsonb_build_object('method',v_cmd.method,'status',v_cmd.status));
  return jsonb_build_object('ok',true,'status',v_cmd.status);
end $$;

create or replace function public.opera_enqueue(p_method text,p_params jsonb default '{}'::jsonb,p_timeout_ms integer default null,p_device_name text default 'opera',p_request_id text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_device public.opera_devices%rowtype; v_default_timeout integer; v_timeout integer; v_cmd public.opera_commands%rowtype;
begin
  select default_timeout_ms into v_default_timeout from public.opera_methods where method=p_method and enabled=true; if v_default_timeout is null then return jsonb_build_object('ok',false,'error','Method is not allowlisted.'); end if;
  select * into v_device from public.opera_devices where device_name=trim(p_device_name) and status<>'disabled'; if not found then return jsonb_build_object('ok',false,'error','Device is not paired.'); end if;
  v_timeout:=least(greatest(coalesce(p_timeout_ms,v_default_timeout),500),55000);
  if p_request_id is not null then select * into v_cmd from public.opera_commands where device_id=v_device.id and request_id=left(p_request_id,128); if found then return jsonb_build_object('ok',true,'commandId',v_cmd.id,'status',v_cmd.status,'reused',true); end if; end if;
  insert into public.opera_commands(device_id,request_id,method,params,status,timeout_ms,expires_at) values(v_device.id,case when p_request_id is null then null else left(p_request_id,128) end,p_method,coalesce(p_params,'{}'::jsonb),'queued',v_timeout,now()+make_interval(secs=>(v_timeout/1000.0)+5)) returning * into v_cmd;
  insert into public.opera_audit(event_type,device_id,command_id,details) values('command.queued',v_device.id,v_cmd.id,jsonb_build_object('method',p_method,'timeoutMs',v_timeout));
  return jsonb_build_object('ok',true,'commandId',v_cmd.id,'status',v_cmd.status,'reused',false);
end $$;

create or replace function public.opera_await(p_command_id uuid,p_timeout_ms integer default 45000) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_deadline timestamptz; v_cmd public.opera_commands%rowtype; v_wait integer;
begin
  v_wait:=least(greatest(coalesce(p_timeout_ms,45000),100),55000); v_deadline:=clock_timestamp()+make_interval(secs=>v_wait/1000.0);
  loop
    select * into v_cmd from public.opera_commands where id=p_command_id; if not found then return jsonb_build_object('ok',false,'error','Command not found.'); end if;
    if v_cmd.status='completed' then return jsonb_build_object('ok',true,'commandId',v_cmd.id,'status',v_cmd.status,'result',v_cmd.result,'timing',jsonb_build_object('queuedMs',round(extract(epoch from (coalesce(v_cmd.claimed_at,v_cmd.completed_at)-v_cmd.created_at))*1000),'totalMs',round(extract(epoch from (v_cmd.completed_at-v_cmd.created_at))*1000)));
    elsif v_cmd.status in ('failed','expired','cancelled') then return jsonb_build_object('ok',false,'commandId',v_cmd.id,'status',v_cmd.status,'error',v_cmd.error); end if;
    if clock_timestamp()>=v_deadline then return jsonb_build_object('ok',false,'commandId',v_cmd.id,'status',v_cmd.status,'error',jsonb_build_object('code','AWAIT_TIMEOUT','message','Timed out waiting for command result.')); end if;
    perform pg_sleep(0.05);
  end loop;
end $$;

create or replace function public.opera_run(p_method text,p_params jsonb default '{}'::jsonb,p_timeout_ms integer default null,p_device_name text default 'opera',p_request_id text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_device public.opera_devices%rowtype; v_enqueue jsonb; v_command_id uuid; v_timeout integer;
begin
  select * into v_device from public.opera_devices where device_name=trim(p_device_name) and status<>'disabled'; if not found then return jsonb_build_object('ok',false,'error','Device is not paired.'); end if;
  if v_device.last_seen_at is null or v_device.last_seen_at<now()-interval '90 seconds' then return jsonb_build_object('ok',false,'error','Device is offline.','lastSeenAt',v_device.last_seen_at); end if;
  v_enqueue:=public.opera_enqueue(p_method,p_params,p_timeout_ms,p_device_name,p_request_id); if coalesce((v_enqueue->>'ok')::boolean,false)=false then return v_enqueue; end if;
  v_command_id:=(v_enqueue->>'commandId')::uuid; v_timeout:=least(greatest(coalesce(p_timeout_ms,45000),500),55000); return public.opera_await(v_command_id,v_timeout);
end $$;

revoke all on function public.opera_create_pairing_code(text,integer) from public,anon,authenticated;
revoke all on function public.opera_pair_device(text,text,text,text,integer,jsonb) from public,anon,authenticated;
revoke all on function public.opera_auth_device(text,text) from public,anon,authenticated;
revoke all on function public.opera_heartbeat(text,text,text,integer,jsonb) from public,anon,authenticated;
revoke all on function public.opera_claim_next(text,text,text,integer,jsonb) from public,anon,authenticated;
revoke all on function public.opera_complete_command(text,text,uuid,boolean,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.opera_enqueue(text,jsonb,integer,text,text) from public,anon,authenticated;
revoke all on function public.opera_await(uuid,integer) from public,anon,authenticated;
revoke all on function public.opera_run(text,jsonb,integer,text,text) from public,anon,authenticated;
grant execute on function public.opera_pair_device(text,text,text,text,integer,jsonb) to service_role;
grant execute on function public.opera_heartbeat(text,text,text,integer,jsonb) to service_role;
grant execute on function public.opera_claim_next(text,text,text,integer,jsonb) to service_role;
grant execute on function public.opera_complete_command(text,text,uuid,boolean,jsonb,jsonb) to service_role;
