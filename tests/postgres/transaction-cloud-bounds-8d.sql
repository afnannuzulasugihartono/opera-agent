-- @last-edited: 2026-10-04 18:25 UTC+7.
-- @title: transaction-cloud-bounds-8d — cloud-bounds-8d — Opt-in authorized synthetic database boundary probe; no OAuth/browser cl.
-- @context: Test.
-- @state: verify bounded 8D cloud limits and record OAuth prerequisites.
-- @updated: every file carries Last edited, Title, Purpose and Now
-- @dependencies: none stated.

-- Opt-in authorized synthetic database boundary probe; no OAuth/browser claims.
-- No DDL, auth/session writes, runtime changes or persistent DARK state.

begin;
set local statement_timeout='10s';
set local lock_timeout='3s';
do $$
declare a text:='m8d_bounds_actor'; p text; tx text; i integer; v jsonb;
  h text:='sha256:'||repeat('a',64); f text:='sha256:'||repeat('b',64);
  t text:='sha256:'||repeat('c',64); ad text:='sha256:'||repeat('e',64);
  cd text:='sha256:'||repeat('f',64); n text; caught boolean;
  stamp timestamptz:=clock_timestamp(); gates integer:=0;
begin
  if (select mode from opera_agent_tx_candidate.policy)<>'OFF'
    or exists(select 1 from opera_agent_tx_candidate.runs)
    or exists(select 1 from opera_agent_tx_candidate.principals)
    or exists(select 1 from opera_agent_tx_candidate.rates)
    then raise exception 'PROBE_REQUIRES_CLEAN_OFF'; end if;
  update opera_agent_tx_candidate.policy set mode='DARK';
  foreach p in array array['m8d_bounds_pending','m8d_bounds_prepare_rate',
    'm8d_bounds_commit_rate','m8d_bounds_concurrent','m8d_bounds_payload','m8d_bounds_payload_max'] loop
    insert into opera_agent_tx_candidate.principals values(p,a,'m8d_bounds_user','m8d_bounds_client');
  end loop;

  p:='m8d_bounds_pending';
  for i in 1..8 loop
    perform opera_agent_tx_candidate.prepare(p,a,'pending_'||i,h,f,t,'m8d_bounds_device',42,'oatx1.synthetic.cipher',stamp,stamp+interval '9 minutes');
  end loop;
  caught:=false;
  begin perform opera_agent_tx_candidate.prepare(p,a,'pending_9',h,f,t,'m8d_bounds_device',42,'oatx1.synthetic.cipher',stamp,stamp+interval '9 minutes');
  exception when others then if sqlerrm='PENDING_LIMIT' then caught:=true; else raise; end if; end;
  if not caught or (select count(*) from opera_agent_tx_candidate.runs where tenant_id=p)<>8
    then raise exception 'PENDING_BOUND_FAILED'; end if; gates:=gates+1;
  perform opera_agent_tx_candidate.cancel(p,a,'pending_1');
  perform opera_agent_tx_candidate.prepare(p,a,'pending_9',h,f,t,'m8d_bounds_device',42,'oatx1.synthetic.cipher',stamp,stamp+interval '9 minutes');
  if (select count(*) from opera_agent_tx_candidate.runs where tenant_id=p and terminal_at is null)<>8
    then raise exception 'PENDING_RELEASE_FAILED'; end if; gates:=gates+1;

  p:='m8d_bounds_prepare_rate';

  -- Pin each synthetic boundary in its actual database minute; not rollover proof.

  for i in 1..20 loop
    insert into opera_agent_tx_candidate.rates values(p,date_trunc('minute',clock_timestamp()),i-1,0)
      on conflict(tenant_id) do update set window_start=excluded.window_start,prepares=excluded.prepares;
    perform opera_agent_tx_candidate.prepare(p,a,'prepare_rate_'||i,h,f,t,'m8d_bounds_device',42,'oatx1.synthetic.cipher',stamp,stamp+interval '9 minutes');
    perform opera_agent_tx_candidate.cancel(p,a,'prepare_rate_'||i);
  end loop;
  update opera_agent_tx_candidate.rates set window_start=date_trunc('minute',clock_timestamp()),prepares=20 where tenant_id=p;
  caught:=false;
  begin perform opera_agent_tx_candidate.prepare(p,a,'prepare_rate_21',h,f,t,'m8d_bounds_device',42,'oatx1.synthetic.cipher',stamp,stamp+interval '9 minutes');
  exception when others then if sqlerrm='PREPARE_RATE_LIMIT' then caught:=true; else raise; end if; end;
  if not caught or (select count(*) from opera_agent_tx_candidate.runs where tenant_id=p)<>20
    then raise exception 'PREPARE_RATE_BOUND_FAILED'; end if; gates:=gates+1;

  p:='m8d_bounds_commit_rate';
  for i in 1..11 loop
    tx:='commit_rate_'||i; n:='sha256:'||encode(sha256(convert_to(tx,'UTF8')),'hex');
    perform opera_agent_tx_candidate.prepare(p,a,tx,h,f,t,'m8d_bounds_device',100+i,'oatx1.synthetic.cipher',stamp,stamp+interval '9 minutes');
    perform opera_agent_tx_candidate.claim(p,a,tx,'m8d_bounds_worker');
    perform opera_agent_tx_candidate.await_approval(p,a,tx,1,f,t);
    perform opera_agent_tx_candidate.issue_approval(p,a,tx,1,f,n,ad,120000);
    update opera_agent_tx_candidate.rates set window_start=date_trunc('minute',clock_timestamp()),commits=least(i-1,10) where tenant_id=p;
    if i<=10 then
      perform opera_agent_tx_candidate.finalize_dark(p,a,tx,1,f,n,ad,cd);
      v:=opera_agent_tx_candidate.finalize_dark(p,a,tx,1,f,n,ad,cd);
      if v->>'replay'<>'true' or (select commits from opera_agent_tx_candidate.rates where tenant_id=p)<>i
        then raise exception 'COMMIT_REPLAY_RATE_FAILED'; end if;
      perform opera_agent_tx_candidate.cancel(p,a,tx);
    else
      caught:=false;
      begin perform opera_agent_tx_candidate.finalize_dark(p,a,tx,1,f,n,ad,cd);
      exception when others then if sqlerrm='COMMIT_RATE_LIMIT' then caught:=true; else raise; end if; end;
      if not caught or not (select consumed_at is null from opera_agent_tx_candidate.approvals where tenant_id=p and transaction_id=tx)
        or (select status from opera_agent_tx_candidate.runs where tenant_id=p and transaction_id=tx)<>'AWAITING_APPROVAL'
        then raise exception 'COMMIT_RATE_ATOMIC_ROLLBACK_FAILED'; end if;
    end if;
  end loop;
  if (select count(*) from opera_agent_tx_candidate.commit_slots where tenant_id=p)<>10
    then raise exception 'COMMIT_SLOT_COUNT_FAILED'; end if; gates:=gates+1;

  p:='m8d_bounds_concurrent';
  for i in 1..3 loop
    tx:='concurrent_'||i; n:='sha256:'||encode(sha256(convert_to(tx,'UTF8')),'hex');
    perform opera_agent_tx_candidate.prepare(p,a,tx,h,f,t,'m8d_bounds_device',200+i,'oatx1.synthetic.cipher',stamp,stamp+interval '9 minutes');
    perform opera_agent_tx_candidate.claim(p,a,tx,'m8d_bounds_worker');
    perform opera_agent_tx_candidate.await_approval(p,a,tx,1,f,t);
    perform opera_agent_tx_candidate.issue_approval(p,a,tx,1,f,n,ad,120000);
    if i<=2 then perform opera_agent_tx_candidate.finalize_dark(p,a,tx,1,f,n,ad,cd);
    else
      caught:=false;
      begin perform opera_agent_tx_candidate.finalize_dark(p,a,tx,1,f,n,ad,cd);
      exception when others then if sqlerrm='COMMIT_CONCURRENCY_LIMIT' then caught:=true; else raise; end if; end;
      if not caught or not (select consumed_at is null from opera_agent_tx_candidate.approvals where tenant_id=p and transaction_id=tx)
        then raise exception 'TENANT_CONCURRENCY_FAILED'; end if;
    end if;
  end loop; gates:=gates+1;
  perform opera_agent_tx_candidate.cancel(p,a,'concurrent_2');
  tx:='same_target'; n:='sha256:'||encode(sha256(convert_to(tx,'UTF8')),'hex');
  perform opera_agent_tx_candidate.prepare(p,a,tx,h,f,cd,'m8d_bounds_device',201,'oatx1.synthetic.cipher',stamp,stamp+interval '9 minutes');
  perform opera_agent_tx_candidate.claim(p,a,tx,'m8d_bounds_worker');
  perform opera_agent_tx_candidate.await_approval(p,a,tx,1,f,t);
  perform opera_agent_tx_candidate.issue_approval(p,a,tx,1,f,n,ad,120000);
  caught:=false;
  begin perform opera_agent_tx_candidate.finalize_dark(p,a,tx,1,f,n,ad,cd);
  exception when others then if sqlerrm='TARGET_COMMIT_LIMIT' then caught:=true; else raise; end if; end;
  if not caught or not (select consumed_at is null from opera_agent_tx_candidate.approvals where tenant_id=p and transaction_id=tx)
    then raise exception 'PHYSICAL_TARGET_DIGEST_BYPASS'; end if; gates:=gates+1;

  p:='m8d_bounds_payload_max';
  perform opera_agent_tx_candidate.prepare(p,a,'maximum',h,f,t,'m8d_bounds_device',42,'oatx1.synthetic.'||repeat('x',196592),stamp,stamp+interval '9 minutes');
  if not exists(select 1 from opera_agent_tx_candidate.runs where tenant_id=p and transaction_id='maximum' and octet_length(payload_token)=196608)
    then raise exception 'PAYLOAD_MAXIMUM_NOT_ACCEPTED'; end if;
  p:='m8d_bounds_payload';
  caught:=false;
  begin perform opera_agent_tx_candidate.prepare(p,a,'oversized',h,f,t,'m8d_bounds_device',42,'oatx1.synthetic.'||repeat('x',196593),stamp,stamp+interval '9 minutes');
  exception when check_violation then caught:=true; end;
  if not caught or exists(select 1 from opera_agent_tx_candidate.runs where tenant_id=p)
    or exists(select 1 from opera_agent_tx_candidate.rates where tenant_id=p)
    then raise exception 'PAYLOAD_BOUND_ROLLBACK_FAILED'; end if; gates:=gates+1;
  caught:=false;
  begin perform opera_agent_tx_candidate.cleanup(101);
  exception when others then if sqlerrm='CLEANUP_LIMIT' then caught:=true; else raise; end if; end;
  if not caught then raise exception 'CLEANUP_BOUND_FAILED'; end if; gates:=gates+1;
  if gates<>8 then raise exception 'MISSING_BOUND_GATE'; end if;
  raise notice '8D cloud bounds: % grouped assertions PASS; rollback follows',gates;
end $$;
rollback;
select jsonb_build_object('completedGroups',8,'mode',(select mode from opera_agent_tx_candidate.policy),
  'runs',(select count(*) from opera_agent_tx_candidate.runs),
  'principals',(select count(*) from opera_agent_tx_candidate.principals),
  'rates',(select count(*) from opera_agent_tx_candidate.rates)) as post_bounds_state;
