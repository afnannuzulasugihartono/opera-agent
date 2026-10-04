-- @last-edited: 2026-10-04 18:25 UTC+7.
-- @title: transaction-cloud-install-8d — cloud-install-8d — Bounded synthetic cloud primitive probe; not hosted OAuth/approval acce.
-- @context: Test.
-- @state: fix(quality): resolve Sonar new-code reliability sweep - code-unit sort comparators, honest throw-free finally, identical-ternary collapse,.
-- @updated: every file carries Last edited, Title, Purpose and Now
-- @dependencies: none stated.

-- Bounded synthetic cloud primitive probe; not hosted OAuth/approval acceptance.
-- Run only after explicit installation authority. No auth/session/browser writes.
-- All changes, including DARK policy, roll back in this same short transaction.

begin;
set local statement_timeout='10s';
set local lock_timeout='3s';
do $$
declare p constant text:='m8d_cloud_install_a'; a constant text:='m8d_cloud_actor_a';
  b constant text:='m8d_cloud_install_b'; h text:='sha256:'||repeat('a',64);
  f text:='sha256:'||repeat('b',64); t text:='sha256:'||repeat('c',64);
  n text:='sha256:'||repeat('d',64); ad text:='sha256:'||repeat('e',64);
  cd text:='sha256:'||repeat('f',64); stamp timestamptz:=clock_timestamp();
  v jsonb; first_key text; gates integer:=0; caught boolean;
begin
  if (select mode from opera_agent_tx_candidate.policy)<>'OFF'
    or exists(select 1 from opera_agent_tx_candidate.principals)
    or exists(select 1 from opera_agent_tx_candidate.runs)
    then raise exception 'PROBE_REQUIRES_CLEAN_OFF'; end if;
  caught:=false;
  begin update opera_agent_tx_candidate.policy set agent_commit_enabled=true where singleton=true;
  exception when check_violation then caught:=true; end;
  if not caught then raise exception 'AGENT_COMMIT_POLICY_BYPASS'; end if; gates:=gates+1;
  update opera_agent_tx_candidate.policy set mode='DARK' where singleton=true;
  insert into opera_agent_tx_candidate.principals values
    (p,a,'m8d_cloud_user_a','m8d_cloud_client_a'),
    (b,'m8d_cloud_actor_b','m8d_cloud_user_b','m8d_cloud_client_b');
  v:=opera_agent_tx_candidate.prepare(p,a,'m8d_cloud_tx_a',h,f,t,'m8d_cloud_device',42,'oatx1.synthetic.cipher',stamp,stamp+interval '9 minutes');
  if v->>'status'<>'PREPARED' or (v->>'browserDispatchAllowed')::boolean then raise exception 'PREPARE_FAILED'; end if; gates:=gates+1;
  first_key:=v->>'commitKey';
  v:=opera_agent_tx_candidate.prepare(p,a,'m8d_cloud_tx_a',h,f,t,'m8d_cloud_device',42,'oatx1.synthetic.cipher',stamp,stamp+interval '9 minutes');
  if v->>'replay'<>'true' or v->>'commitKey'<>first_key then raise exception 'PREPARE_REPLAY_FAILED'; end if; gates:=gates+1;
  caught:=false;
  begin perform opera_agent_tx_candidate.prepare(p,a,'m8d_cloud_tx_a',h,f,t,'m8d_cloud_device',42,'oatx1.changed.cipher',stamp,stamp+interval '9 minutes');
  exception when others then if sqlerrm='IDEMPOTENCY_COLLISION' then caught:=true; else raise; end if; end;
  if not caught then raise exception 'COLLISION_ACCEPTED'; end if; gates:=gates+1;
  caught:=false;
  begin perform opera_agent_tx_candidate.read_run(b,'m8d_cloud_actor_b','m8d_cloud_tx_a');
  exception when others then if sqlerrm='TRANSACTION_NOT_FOUND' then caught:=true; else raise; end if; end;
  if not caught then raise exception 'FOREIGN_READ_ACCEPTED'; end if; gates:=gates+1;
  caught:=false;
  begin perform opera_agent_tx_candidate.cancel(b,'m8d_cloud_actor_b','m8d_cloud_tx_a');
  exception when others then if sqlerrm='TRANSACTION_NOT_FOUND' then caught:=true; else raise; end if; end;
  if not caught then raise exception 'FOREIGN_CANCEL_ACCEPTED'; end if; gates:=gates+1;
  v:=opera_agent_tx_candidate.claim(p,a,'m8d_cloud_tx_a','m8d_cloud_worker_a');
  if v->>'leaseEpoch'<>'1' then raise exception 'CLAIM_FAILED'; end if; gates:=gates+1;
  caught:=false;
  begin perform opera_agent_tx_candidate.claim(p,a,'m8d_cloud_tx_a','m8d_cloud_worker_b');
  exception when others then if sqlerrm='LEASE_BUSY' then caught:=true; else raise; end if; end;
  if not caught then raise exception 'LEASE_THEFT_ACCEPTED'; end if; gates:=gates+1;
  perform opera_agent_tx_candidate.await_approval(p,a,'m8d_cloud_tx_a',1,f,t);
  v:=opera_agent_tx_candidate.await_approval(p,a,'m8d_cloud_tx_a',1,f,t);
  if v->>'replay'<>'true' or v->>'transition'<>'1' then raise exception 'TRANSITION_REPLAY_FAILED'; end if; gates:=gates+1;
  perform opera_agent_tx_candidate.issue_approval(p,a,'m8d_cloud_tx_a',1,f,n,ad,120000);
  v:=opera_agent_tx_candidate.finalize_dark(p,a,'m8d_cloud_tx_a',1,f,n,ad,cd);
  if v->>'status'<>'COMMITTING' or v->>'transition'<>'3' or v->>'commitKey'<>first_key then raise exception 'FINALIZE_FAILED'; end if; gates:=gates+1;
  v:=opera_agent_tx_candidate.finalize_dark(p,a,'m8d_cloud_tx_a',1,f,n,ad,cd);
  if v->>'replay'<>'true' then raise exception 'FINALIZE_REPLAY_FAILED'; end if;
  if (select count(*) from opera_agent_tx_candidate.commit_slots where tenant_id=p)<>1
    or (select commits from opera_agent_tx_candidate.rates where tenant_id=p)<>1
    or (select count(*) from opera_agent_tx_candidate.journal where tenant_id=p)<>3
    then raise exception 'REPLAY_DUPLICATED_EFFECT'; end if; gates:=gates+1;
  caught:=false;
  begin perform opera_agent_tx_candidate.consume_approval(p,a,'m8d_cloud_tx_a',1,f,n,ad,t);
  exception when others then if sqlerrm='APPROVAL_ALREADY_CONSUMED' then caught:=true; else raise; end if; end;
  if not caught then raise exception 'NONCE_REUSE_ACCEPTED'; end if; gates:=gates+1;
  v:=opera_agent_tx_candidate.cancel(p,a,'m8d_cloud_tx_a');
  if v->>'status'<>'CANCELLED' or exists(select 1 from opera_agent_tx_candidate.runs where tenant_id=p and payload_token is not null)
    then raise exception 'CANCEL_MINIMIZATION_FAILED'; end if; gates:=gates+1;
  v:=opera_agent_tx_candidate.cancel(p,a,'m8d_cloud_tx_a');
  if v->>'replay'<>'true' then raise exception 'CANCEL_REPLAY_FAILED'; end if; gates:=gates+1;
  update opera_agent_tx_candidate.runs set terminal_at=clock_timestamp()-interval '8 days' where tenant_id=p;
  if opera_agent_tx_candidate.cleanup(1)<>1 then raise exception 'RETENTION_CLEANUP_FAILED'; end if;
  if exists(select 1 from opera_agent_tx_candidate.journal where tenant_id=p)
    or exists(select 1 from opera_agent_tx_candidate.approvals where tenant_id=p)
    or exists(select 1 from opera_agent_tx_candidate.commit_slots where tenant_id=p)
    then raise exception 'CHILD_CLEANUP_FAILED'; end if; gates:=gates+1;
  raise notice '8D cloud primitive probe: % gates passed; rollback follows; no browser dispatch',gates;
end $$;
rollback;
select jsonb_build_object('mode',(select mode from opera_agent_tx_candidate.policy),
  'runs',(select count(*) from opera_agent_tx_candidate.runs),
  'principals',(select count(*) from opera_agent_tx_candidate.principals),
  'rates',(select count(*) from opera_agent_tx_candidate.rates)) as post_probe_state;
