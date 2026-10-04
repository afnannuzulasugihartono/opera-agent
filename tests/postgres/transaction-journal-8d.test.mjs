// @last-edited: 2026-10-04 11:10 UTC.
// @title: transaction-journal-8d.test — journal-8d.test — Repository file.
// @context: Test.
// @state: chore(sync): align migration file IDs with production ledger, record applied skip_ads/ETW migrations, update test paths and sync docs.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: strict, node:child_process, node:util, promises, node:path, node:os, node:net, node:crypto, node:url, node:test, transaction-dark-fixture, transaction-cloud-fixture-8d, transaction-host-8d, ledger-tok.

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test, { before, after } from 'node:test';
import { transactionFixture } from '../helpers/transaction-dark-fixture.mjs';
import { createCloudFixtureData8D } from '../helpers/transaction-cloud-fixture-8d.mjs';
import { createTransactionDarkHost } from '../../lib/transaction-host-8d.js';
import { sealLedgerToken } from '../../lib/ledger-token.js';
import { openTransactionToken } from '../../lib/transaction-token-8d.js';
import { TRANSACTION_8B_LIMITS,createTransactionPreview } from '../../lib/transaction-prepare.js';
import { createApprovalChallenge,createModernApprovalRequest,verifyModernApprovalResponse } from '../../lib/transaction-authority.js';

// Mandatory real native PostgreSQL gate. Missing tooling is a failure, not a skip.
const run = promisify(execFile);
const bin = process.env.OPERA_PG_BIN;
if (!bin || !path.isAbsolute(bin)) throw new Error('Set OPERA_PG_BIN to native PostgreSQL bin directory.');
const executable = (name) => path.join(bin, process.platform === 'win32' ? `${name}.exe` : name);
// pg_ctl's detached Windows server can inherit pipes. Wait on its process exit,
// not on inherited stream closure, and never open a visible console window.
const control = (argv) => new Promise((resolve,reject) => {
  const child = spawn(executable('pg_ctl'), argv, { windowsHide: true, stdio: 'ignore' });
  child.once('error',reject);
  child.once('exit',(code) => code === 0 ? resolve() : reject(new Error(`pg_ctl failed: ${code}`)));
});
const data = await fs.mkdtemp(path.join(os.tmpdir(), 'opera-agent-tx-db-'));
const socket = net.createServer();
await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
let started = false;
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres'];
const query = async (sql, role = 'service_role') => {
  const result = await run(executable('psql'), [...args, '-c', `set statement_timeout='10s'; set role ${role}; ${sql}`], { windowsHide: true, maxBuffer: 1048576 });
  return result.stdout.trim();
};
const fails = async (sql, code, role) => assert.rejects(query(sql, role), (error) => error.stderr?.includes(code));
const hash = (char) => `sha256:${char.repeat(64)}`;
const nonce = (id) => `sha256:${createHash('sha256').update(id).digest('hex')}`;
const P = 'opera_agent_tx_candidate';
const actor = 'synthetic_a';
const tenant = 'tenant_a';
const create = (id, tenantId = tenant, actorId = actor) => `${P}.prepare('${tenantId}','${actorId}','${id}','${hash('a')}','${hash('b')}','${hash('c')}','device_${tenantId}',42,'oatx1.synthetic.cipher',coalesce((select prepared_at from ${P}.runs where tenant_id='${tenantId}' and transaction_id='${id}'),statement_timestamp()),coalesce((select expires_at from ${P}.runs where tenant_id='${tenantId}' and transaction_id='${id}'),statement_timestamp()+interval '10 minutes'))`;
const claim = (id, worker = 'worker_a') => `${P}.claim('${tenant}','${actor}','${id}','${worker}')`;
const stage = (id, epoch = 1) => `${P}.await_approval('${tenant}','${actor}','${id}',${epoch},'${hash('b')}','${hash('d')}')`;
const issue = (id, nonceDigest = nonce(id)) => `${P}.issue_approval('${tenant}','${actor}','${id}',1,'${hash('b')}','${nonceDigest}','${hash('e')}',120000)`;
const consume = (id, digest = 'f', nonceDigest = nonce(id)) => `${P}.consume_approval('${tenant}','${actor}','${id}',1,'${hash('b')}','${nonceDigest}','${hash('e')}','${hash(digest)}')`;
const validate = (id) => `${P}.mark_validated('${tenant}','${actor}','${id}',1,'${hash('b')}')`;
const reserve = (id) => `${P}.reserve_slot('${tenant}','${actor}','${id}',1,'${hash('b')}')`;
const finalize = (id) => `${P}.finalize_dark('${tenant}','${actor}','${id}',1,'${hash('b')}','${nonce(id)}','${hash('e')}','${hash('f')}')`;
const prepared = async (id) => { await query(`select ${create(id)}; select ${claim(id)};`); };
const approved = async (id) => { await prepared(id); await query(`select ${stage(id)}; select ${issue(id)}; select ${consume(id)}; select ${validate(id)};`); };
const scoped = (sql, name) => sql.replaceAll('tenant_a', name);
const setupScope = async (name) => query(`insert into ${P}.principals values ('${name}','${actor}','user_a','client_a');`,'postgres');
const approveScope = async (name,id,tab,target='c') => query(scoped(`select ${create(id).replace(',42,',`,${tab},`).replace(hash('c'),hash(target))}; select ${claim(id)}; select ${stage(id)}; select ${issue(id)}; select ${consume(id)}; select ${validate(id)};`,name));
const cancelScope = (name,id) => query(`select ${P}.cancel('${name}','${actor}','${id}');`);
const killBoundWorker=async(mode,tx,context)=>{
  const worker=spawn(process.execPath,[fileURLToPath(new URL('./transaction-worker-8d.mjs',import.meta.url)),bin,String(port),'tenant_alpha',tx,mode,JSON.stringify(context)],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
  let diagnostics='';worker.stderr.on('data',chunk=>{diagnostics+=chunk;});
  try{
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Bound worker checkpoint timeout: '+diagnostics)),5000);
      worker.once('message',message=>{clearTimeout(timeout);message.phase===mode?resolve():reject(new Error('Wrong bound phase'));});
      worker.once('error',error=>{clearTimeout(timeout);reject(error);});
      worker.once('exit',code=>{clearTimeout(timeout);reject(new Error('Bound worker exited: '+code+' '+diagnostics));});
    });
    const exited=new Promise(resolve=>worker.once('exit',resolve));worker.kill();await exited;
  }finally{if(worker.exitCode===null&&!worker.killed)worker.kill();}
};

before(async () => {
  await run(executable('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { windowsHide: true });
  await control(['-D', data, '-l', path.join(data, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  started = true;
  await query('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;', 'postgres');
  // Synthetic auth metadata only, shaped like the verified production columns.
  await query('create schema auth; create table auth.sessions(id text primary key,user_id text,oauth_client_id text,not_after timestamptz);','postgres');
  await query(`create schema opera_agent_private; create table opera_agent_private.goal_heads(tenant_id text,goal_id text,head_revision integer,head_digest text,status text,expires_at timestamptz,primary key(tenant_id,goal_id)); grant usage on schema opera_agent_private to service_role; grant select,update on opera_agent_private.goal_heads to service_role;`,'postgres');
  await run(executable('psql'), [...args, '-f', fileURLToPath(new URL('../../supabase/candidates/transaction-journal-8d.sql', import.meta.url))], { windowsHide: true });
  await query(`update ${P}.policy set mode='DARK'; insert into ${P}.principals values ('tenant_a','synthetic_a','user_a','client_a'),('tenant_b','synthetic_b','user_b','client_b');`, 'postgres');
});

after(async () => {
  if (started) await control(['-D', data, '-m', 'fast', '-w', 'stop']);
  // Keep synthetic diagnostic artifacts; never recursively delete a computed path.
  console.log(`Native PostgreSQL stopped; synthetic diagnostic directory: ${data}`);
});

test('8D cloud fixture goal head fits actual production DDL rather than the reduced journal double', async () => {
  const f = await createCloudFixtureData8D({ namespace: '12345678-1234-4234-8234-123456789abc', userId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', preparedAt: '2026-09-14T00:00:00.000Z' });
  const source = await fs.readFile(new URL('../../supabase/migrations/20260911162525_opera_agent_goal_head.sql', import.meta.url), 'utf8');
  const ddl = source.match(/create table opera_agent_private\.goal_heads \([\s\S]*?\n\);/)?.[0];
  assert.ok(ddl, 'Production goal-head DDL must be available unchanged');
  const table = 'fixture_shape_8d.goal_heads';
  const record = JSON.stringify(f.goalHead).replaceAll("'", "''");
  const result = await query(`begin; create schema fixture_shape_8d; ${ddl.replace('opera_agent_private.goal_heads', table)} insert into ${table} select * from jsonb_populate_record(null::${table},'${record}'::jsonb); select count(*) from ${table} where tenant_id='${f.principal.tenant_id}'::uuid and goal_id='${f.goalHead.goal_id}'; rollback;`, 'postgres');
  assert.equal(result, '1');
  assert.equal(await query("select count(*) from pg_namespace where nspname='fixture_shape_8d';", 'postgres'), '0');
});

test('8D private schema/RLS/function grants deny anon and authenticated', async () => {
  for (const role of ['anon', 'authenticated']) {
    await fails(`select * from ${P}.runs;`, 'permission denied', role);
    await fails(`select ${create('denied')};`, 'permission denied', role);
    assert.equal(await query(`select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'opera_tx_%' and has_function_privilege('${role}',oid,'EXECUTE');`,'postgres'),'0');
  }
  assert.equal(await query(`select count(*) from pg_class where relnamespace='${P}'::regnamespace and relkind='r' and not relrowsecurity;`, 'postgres'), '0');
  assert.equal(await query(`select count(*) from pg_proc where pronamespace='${P}'::regnamespace and prosecdef and proname<>'assert_live_identity';`, 'postgres'), '0');
});

test('8D service identity lookup requires active exact user/client/session grant',async()=>{
  await query(`insert into auth.sessions values ('session_a','user_a','client_a',clock_timestamp()+interval '1 minute');`,'postgres');
  const lookup="public.opera_tx_identity_read('user_a','client_a','session_a')";
  assert.equal(await query(`select ${lookup}->>'actor_id';`),'synthetic_a');
  for(const role of ['anon','authenticated'])await fails(`select ${lookup};`,'permission denied',role);
  assert.equal(await query(`select ${lookup.replace("'client_a'","'client_b'")} is null;`),'t');
  await query("delete from auth.sessions where id='session_a';",'postgres');
  assert.equal(await query(`select ${lookup} is null;`),'t');
});

test('8D bound prepare locks actual current head and rejects cancellation/stale authority',async()=>{
  const f=await transactionFixture(new Date(Date.now()-60000).toISOString());
  const tx=f.request.prepared,ledger=f.state.ledger;
  const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
  const binding={mode:'DARK',preparedDigest:tx.prepareDigest,ledgerDigest:ledger.ledgerDigest,target:tx.target,grant:f.state.grant,operands:[f.state.resolved]};
  await query(`insert into ${P}.principals values ('tenant_alpha','synthetic_8d','user_alpha','client_a'); insert into opera_agent_private.goal_heads values ('tenant_alpha','goal_alpha',${ledger.revision},'${ledger.ledgerDigest}','OPEN','${tx.expiresAt}'); insert into ${P}.acceptance_bindings values ('tenant_alpha','synthetic_8d','${tx.transactionId}','goal_alpha',${ledger.revision},'${ledger.ledgerDigest}',${literal(binding)});`,'postgres');
  const identity={userId:'user_alpha',tenantId:'tenant_alpha',oauthClientId:'client_a',sessionId:'session_alpha',accessExpiresAt:Math.floor(Date.now()/1000)+300,acceptanceIdentity:'synthetic_8d'};
  await query("insert into auth.sessions values ('session_alpha','user_alpha','client_a',clock_timestamp()+interval '5 minutes');",'postgres');
  const prepare=`public.opera_tx_prepare_bound('tenant_alpha','synthetic_8d',${literal(identity)},${literal(tx)},'${ledger.ledgerDigest}','${hash('b')}','oatx1.synthetic.cipher')`;
  await fails(`select ${prepare.replace(literal(identity),literal({...identity,accessExpiresAt:1}))};`,'AUTHENTICATION_REQUIRED');
  assert.equal(await query(`select ${prepare}->>'replay';`),'false');
  await fails(`update ${P}.acceptance_bindings set goal_revision=goal_revision+1;`,'IMMUTABLE_ACCEPTANCE_BINDING');
  assert.equal(await query(`select ${prepare.replace('synthetic.cipher','different.cipher')}->>'replay';`),'true');
  await query("update auth.sessions set oauth_client_id='client_b' where id='session_alpha';",'postgres');
  await fails(`select ${prepare};`,'AUTHENTICATION_REQUIRED');
  await query("update auth.sessions set oauth_client_id='client_a' where id='session_alpha';",'postgres');
  const prefix=`'tenant_alpha','synthetic_8d','${tx.transactionId}',1,'${hash('b')}'`;
  await query(`select ${P}.claim('tenant_alpha','synthetic_8d','${tx.transactionId}','bound_worker'); select ${P}.await_approval(${prefix},'${hash('d')}');`);
  const preview=await createTransactionPreview(tx),issuedAt=new Date().toISOString();
  const authenticatedContext={userId:'user_alpha',oauthClientId:'client_a',authenticationKind:'OAUTH_USER'};
  const challenge=await createApprovalChallenge({prepared:tx,preview,authenticatedContext,approvalChallengeId:'challenge_bound',nonceDigest:nonce(tx.transactionId),issuedAt,expiresAt:new Date(Date.parse(issuedAt)+120000).toISOString(),protocolEra:'MCP_2026_07_28'});
  const issueBound=value=>`public.opera_tx_issue_bound(${prefix},${literal(value)})`;
  await fails(`select ${issueBound({...challenge,previewDigest:hash('0')})};`,'APPROVAL_MISMATCH');
  assert.equal(await query(`select count(*) from ${P}.approvals where tenant_id='tenant_alpha';`),'0');
  assert.equal(await query(`select ${issueBound(challenge)}->>'replay';`),'false');
  assert.equal(await query(`select ${issueBound(challenge)}->>'replay';`),'true');
  const accepted=await verifyModernApprovalResponse({prepared:tx,preview,trustedChallenge:challenge,requestState:createModernApprovalRequest(challenge).requestState,inputResponses:[{requestId:'transaction_approval',value:'APPROVE'}],authenticatedContext,clientCapabilities:{elicitation:{form:true}},mrtrRound:1,evaluatedAt:new Date().toISOString(),consumedNonceDigests:[]});
  // Synthetic first-party response, NOT actual ChatGPT human approval transport.
  const finalizeBound=`public.opera_tx_finalize_bound(${prefix},'${challenge.nonceDigest}','${challenge.approvalDigest}','${accepted.consumptionDigest}')`;
  await query("update opera_agent_private.goal_heads set status='CANCELLED' where tenant_id='tenant_alpha';",'postgres');
  await fails(`select ${prepare};`,'AUTHORITY_NOT_RESOLVED');
  await fails(`select ${finalizeBound};`,'AUTHORITY_NOT_RESOLVED');
  assert.equal(await query(`select consumed_at is null from ${P}.approvals where tenant_id='tenant_alpha';`),'t');
  await query("update opera_agent_private.goal_heads set status='OPEN' where tenant_id='tenant_alpha';",'postgres');
  await query("delete from auth.sessions where id='session_alpha';",'postgres');
  await fails(`select ${finalizeBound};`,'AUTHENTICATION_REQUIRED');
  await query("insert into auth.sessions values ('session_alpha','user_alpha','client_a',clock_timestamp()+interval '5 minutes');",'postgres');
  const workerContext={route:'bound',actor:'synthetic_8d',epoch:1,fence:hash('b'),nonce:challenge.nonceDigest,approval:challenge.approvalDigest,consumption:accepted.consumptionDigest};
  await killBoundWorker('before',tx.transactionId,workerContext);
  assert.equal(await query(`select consumed_at is null from ${P}.approvals where tenant_id='tenant_alpha';`),'t');
  await query(`update ${P}.runs set lease_until=clock_timestamp()+interval '100 milliseconds' where tenant_id='tenant_alpha';select pg_sleep(0.15);`,'postgres');
  assert.equal(await query(`select ${P}.claim('tenant_alpha','synthetic_8d','${tx.transactionId}','recovered_bound')->>'leaseEpoch';`),'2');
  await killBoundWorker('after',tx.transactionId,{...workerContext,epoch:2});
  assert.equal(await query(`select count(*) from ${P}.commit_slots where tenant_id='tenant_alpha';`),'1');
  await query(`update ${P}.runs set lease_until=clock_timestamp()+interval '100 milliseconds' where tenant_id='tenant_alpha';select pg_sleep(0.15);`,'postgres');
  assert.equal(await query(`select ${P}.claim('tenant_alpha','synthetic_8d','${tx.transactionId}','recovered_again')->>'leaseEpoch';`),'3');
  assert.equal(await query(`select ${finalizeBound.replace(',1,',',3,')}->>'replay';`),'true');
  assert.equal(await query(`select commits from ${P}.rates where tenant_id='tenant_alpha';`),'1');
  await query("update opera_agent_private.goal_heads set status='OPEN',head_revision=head_revision+1 where tenant_id='tenant_alpha';",'postgres');
  await fails(`select ${prepare};`,'AUTHORITY_NOT_RESOLVED');
  await fails(`select ${finalizeBound};`,'AUTHORITY_NOT_RESOLVED');
  await query(`select ${P}.cancel('tenant_alpha','synthetic_8d','${tx.transactionId}');`);
});

test('8D host route integrates crypto/admission with real native prepare/status/cancel RPCs',async()=>{
  const options={tenantId:'tenant_host',userId:'user_host',actorId:'actor_host',transactionId:'tx_host_route',budgets:{pendingPerTenant:1}};
  const f=await transactionFixture(new Date(Date.now()-60000).toISOString(),options);
  const tx=f.request.prepared,ledger=f.state.ledger,key=new Uint8Array(32).fill(9),now=new Date().toISOString();
  const text=v=>"'"+String(v).replaceAll("'","''")+"'",json=v=>text(JSON.stringify(v))+'::jsonb';
  const binding={mode:'DARK',preparedDigest:tx.prepareDigest,ledgerDigest:ledger.ledgerDigest,target:tx.target,grant:f.state.grant,operands:[f.state.resolved]};
  await query(`insert into ${P}.principals values ('tenant_host','actor_host','user_host','client_host'); insert into auth.sessions values ('session_host','user_host','client_host',clock_timestamp()+interval '5 minutes'); insert into opera_agent_private.goal_heads values ('tenant_host','goal_alpha',${ledger.revision},${text(ledger.ledgerDigest)},'OPEN',${text(tx.expiresAt)}); insert into ${P}.acceptance_bindings values ('tenant_host','actor_host','tx_host_route','goal_alpha',${ledger.revision},${text(ledger.ledgerDigest)},${json(binding)});`,'postgres');
  // Auth SDK boundary remains a synthetic double; every journal RPC is real PG.
  const sdk={auth:{getClaims:async()=>({data:{claims:{iss:'https://example.supabase.co/auth/v1',aud:'authenticated',role:'authenticated',sub:'user_host',client_id:'client_host',session_id:'session_host',iat:1,exp:Math.floor(Date.now()/1000)+300}}}),getUser:async()=>({data:{user:{id:'user_host'}}})},rpc:async(name,a)=>{
    let sql;
    if(name==='opera_goal_crypto_key')return {data:{enabled:true,key:Buffer.from(key).toString('base64url')}};
    if(name==='opera_tx_identity_read')sql=`public.opera_tx_identity_read(${text(a.p_user_id)},${text(a.p_client_id)},${text(a.p_session_id)})`;
    else if(name==='opera_tx_binding_read')sql=`public.opera_tx_binding_read(${text(a.p_tenant)},${text(a.p_actor)},${text(a.p_tx)})`;
    else if(name==='opera_goal_head_get')sql=`(select jsonb_build_object('ok',true,'headRevision',head_revision,'headDigest',head_digest,'status',status) from opera_agent_private.goal_heads where tenant_id=${text(a.p_tenant_id)} and goal_id=${text(a.p_goal_id)})`;
    else if(name==='opera_tx_prepare_bound')sql=`public.opera_tx_prepare_bound(${text(a.p_tenant)},${text(a.p_actor)},${json(a.p_identity)},${json(a.p_prepared)},${text(a.p_ledger_digest)},${text(a.p_fence)},${text(a.p_payload)})`;
    else if(name==='opera_tx_metadata')sql=`public.opera_tx_metadata(${text(a.p_operation)},${text(a.p_tenant)},${text(a.p_actor)},${json(a.p_identity)},${text(a.p_tx)})`;
    else throw new Error('Unexpected RPC');
    try{const value=await query('select '+sql+';');return {data:value?JSON.parse(value):null};}
    catch{return {error:{message:'synthetic storage error'}};}
  }};
  const host=createTransactionDarkHost(sdk,{issuer:'https://example.supabase.co/auth/v1',audience:'authenticated',clock:()=>new Date(now),transactionKey:key});
  const ledgerToken=await sealLedgerToken(ledger,key,{requestId:'host_ledger_fixture',issuedAt:now});
  const request={operation:'prepare',ledgerToken,...f.request};
  assert.equal((await host(request,'synthetic-bearer')).replay,false);
  const original=await query(`select payload_token from ${P}.runs where tenant_id='tenant_host';`);
  assert.deepEqual(await openTransactionToken(original,key,{kind:'PREPARED',tenantId:'tenant_host',transactionId:tx.transactionId,prepareDigest:tx.prepareDigest}),tx);
  assert.equal((await host(request,'synthetic-bearer')).replay,true);
  assert.equal(await query(`select payload_token from ${P}.runs where tenant_id='tenant_host';`),original);
  const second=await transactionFixture(tx.preparedAt,{...options,transactionId:'tx_host_second'});
  const secondBinding={...binding,preparedDigest:second.request.prepared.prepareDigest};
  await query(`insert into ${P}.acceptance_bindings values ('tenant_host','actor_host','tx_host_second','goal_alpha',${ledger.revision},${text(ledger.ledgerDigest)},${json(secondBinding)});`,'postgres');
  await assert.rejects(host({operation:'prepare',ledgerToken,...second.request},'synthetic-bearer'),{code:'STORAGE_ERROR'});
  assert.equal(await query(`select count(*) from ${P}.runs where tenant_id='tenant_host';`),'1');
  assert.equal((await host({operation:'status',transactionId:tx.transactionId},'synthetic-bearer')).status,'PREPARED');
  assert.equal((await host({operation:'cancel',transactionId:tx.transactionId},'synthetic-bearer')).status,'CANCELLED');
  assert.equal(await query(`select payload_token is null from ${P}.runs where tenant_id='tenant_host';`),'t');
  assert.equal((await host({operation:'prepare',ledgerToken,...second.request},'synthetic-bearer')).replay,false);
  await host({operation:'cancel',transactionId:'tx_host_second'},'synthetic-bearer');
  await query("delete from auth.sessions where id='session_host';",'postgres');
  await assert.rejects(host({operation:'status',transactionId:tx.transactionId},'synthetic-bearer'),{code:'AUTHENTICATION_REQUIRED'});
});

test('8D session expiry during row-lock wait rejects after acquiring the lock',async()=>{
  await query(`insert into ${P}.principals values ('tenant_wait','actor_wait','user_wait','client_wait'); insert into auth.sessions values ('session_wait','user_wait','client_wait',clock_timestamp()+interval '1 second');`,'postgres');
  const identity={userId:'user_wait',tenantId:'tenant_wait',oauthClientId:'client_wait',sessionId:'session_wait',accessExpiresAt:Math.floor(Date.now()/1000)+300,acceptanceIdentity:'actor_wait'};
  const holder=query("set application_name='8d_expiry_holder'; begin; select id from auth.sessions where id='session_wait' for update; select pg_sleep(2); commit;",'postgres');
  // Observe actual DB lock-holder readiness, not a guessed client-side delay.
  let ready=false;
  for(let i=0;i<15&&!ready;i++)ready=await query("select exists(select 1 from pg_stat_activity where application_name='8d_expiry_holder' and wait_event='PgSleep');",'postgres')==='t';
  assert.equal(ready,true);
  const literal="'"+JSON.stringify(identity)+"'::jsonb";
  await fails(`select ${P}.assert_live_identity('tenant_wait','actor_wait',${literal});`,'AUTHENTICATION_REQUIRED');
  await holder;
  assert.equal(await query(`select count(*) from ${P}.runs where tenant_id='tenant_wait';`),'0');
});

test('8D cancellation waiting on tenant lock rechecks expired session before mutation',async()=>{
  await query(`insert into ${P}.principals values ('tenant_cancel_wait','actor_cancel_wait','user_cancel_wait','client_cancel_wait'); insert into auth.sessions values ('session_cancel_wait','user_cancel_wait','client_cancel_wait',clock_timestamp()+interval '1 second');`,'postgres');
  await query(`select ${create('tx_cancel_wait','tenant_cancel_wait','actor_cancel_wait')};`);
  const identity={userId:'user_cancel_wait',tenantId:'tenant_cancel_wait',oauthClientId:'client_cancel_wait',sessionId:'session_cancel_wait',accessExpiresAt:Math.floor(Date.now()/1000)+300,acceptanceIdentity:'actor_cancel_wait'};
  const holder=query("set application_name='8d_cancel_holder';begin;select pg_advisory_xact_lock(hashtextextended('tenant_cancel_wait',814));select pg_sleep(2);commit;",'postgres');
  let ready=false;for(let i=0;i<15&&!ready;i++)ready=await query("select exists(select 1 from pg_stat_activity where application_name='8d_cancel_holder' and wait_event='PgSleep');",'postgres')==='t';
  assert.equal(ready,true);
  await fails(`select public.opera_tx_metadata('cancel','tenant_cancel_wait','actor_cancel_wait','${JSON.stringify(identity)}'::jsonb,'tx_cancel_wait');`,'AUTHENTICATION_REQUIRED');
  await holder;
  assert.equal(await query(`select status||':'||transition from ${P}.runs where transaction_id='tx_cancel_wait';`),'PREPARED:0');
});

test('8D OFF and ENFORCED cannot grant candidate browser/agent commit authority', async () => {
  await query(`update ${P}.policy set mode='OFF';`, 'postgres');
  await fails(`select ${create('off')};`, 'TRANSACTION_DISABLED');
  await fails(`update ${P}.policy set agent_commit_enabled=true;`, 'check constraint', 'postgres');
  await fails(`update ${P}.policy set mode='ENFORCED',legacy_gated=false;`, 'check constraint', 'postgres');
  await query(`update ${P}.policy set mode='ENFORCED',legacy_gated=true;`, 'postgres');
  await fails(`select ${create('enforced')};`, 'TRANSACTION_DISABLED');
  await query(`update ${P}.policy set mode='DARK';`, 'postgres');
});

test('8D exact prepare replay is stable and altered fence collides', async () => {
  await query(`select ${create('replay')};`);
  assert.equal(await query(`select ${create('replay')}->>'replay';`), 'true');
  await fails(`select ${create('replay').replace(hash('b'), hash('9'))};`, 'IDEMPOTENCY_COLLISION');
  await fails(`select ${create('replay').replace('select expires_at','select expires_at+interval \'1s\'')};`, 'IDEMPOTENCY_COLLISION');
  assert.equal(await query(`select count(*) from ${P}.runs where transaction_id='replay';`), '1');
});

test('8D foreign tenant/principal cannot read, claim, cancel, stage or consume', async () => {
  await prepared('isolation');
  for (const sql of [
    `${P}.read_run('tenant_b','synthetic_b','isolation')`,
    `${P}.claim('tenant_b','synthetic_b','isolation','worker_b')`,
    `${P}.cancel('tenant_b','synthetic_b','isolation')`,
    stage('isolation').replaceAll('tenant_a','tenant_b').replaceAll('synthetic_a','synthetic_b'),
      consume('isolation').replaceAll('tenant_a','tenant_b').replaceAll('synthetic_a','synthetic_b'),
      issue('isolation').replaceAll('tenant_a','tenant_b').replaceAll('synthetic_a','synthetic_b'),
      reserve('isolation').replaceAll('tenant_a','tenant_b').replaceAll('synthetic_a','synthetic_b'),
      finalize('isolation').replaceAll('tenant_a','tenant_b').replaceAll('synthetic_a','synthetic_b'),
  ]) await fails(`select ${sql};`, 'TRANSACTION_NOT_FOUND');
});

test('8D lease CAS rejects rivals/stale epochs and worker death permits fenced reclaim', async () => {
  await prepared('lease');
  await fails(`select ${claim('lease','worker_b')};`, 'LEASE_BUSY');
  await query(`update ${P}.runs set lease_until=clock_timestamp()-interval '1s' where transaction_id='lease';`, 'postgres');
  assert.equal(await query(`select ${claim('lease','worker_b')}->>'leaseEpoch';`), '2');
  await fails(`select ${stage('lease',1)};`, 'STALE_LEASE');
  await query(`select ${stage('lease',2)};`);
});

test('8D journal exact redelivery advances once; changed material fails', async () => {
  await prepared('journal');
  await query(`select ${stage('journal')};`);
  assert.equal(await query(`select ${stage('journal')}->>'replay';`), 'true');
  await fails(`select ${stage('journal').replace(hash('d'),hash('8'))};`, 'IDEMPOTENCY_COLLISION');
  assert.equal(await query(`select transition from ${P}.runs where transaction_id='journal';`), '1');
});

test('8D two native DB sessions consume one nonce with one logical advancement', async () => {
  await prepared('nonce');
  await query(`select ${stage('nonce')}; select ${issue('nonce')};`);
  await fails(`select ${issue('nonce').replace('120000','119999')};`, 'IDEMPOTENCY_COLLISION');
  const results = await Promise.all([query(`select ${consume('nonce')}->>'replay';`), query(`select ${consume('nonce')}->>'replay';`)]);
  assert.deepEqual(results.sort(), ['false','true']);
  assert.equal(await query(`select transition from ${P}.runs where transaction_id='nonce';`), '2');
  await fails(`select ${consume('nonce','9')};`, 'APPROVAL_ALREADY_CONSUMED');
});

test('8D transaction rollback undoes nonce consumption and journal together', async () => {
  await prepared('rollback');
  await query(`select ${stage('rollback')}; select ${issue('rollback',hash('2'))};`);
  const operation = consume('rollback','f',hash('2'));
  await fails(`begin; select ${operation}; select 1/0; commit;`, 'division by zero');
  assert.equal(await query(`select consumed_at is null from ${P}.approvals where transaction_id='rollback';`), 't');
  assert.equal(await query(`select transition from ${P}.runs where transaction_id='rollback';`), '1');
});

test('8D reserved commit slot is deterministic, one-shot and never dispatches', async () => {
  await approved('slot');
  const result = JSON.parse(await query(`select ${reserve('slot')};`));
  assert.match(result.commitKey, /^tx1:[0-9a-f]{64}$/);
  assert.equal(result.browserDispatchAllowed, false);
  assert.equal(JSON.parse(await query(`select ${reserve('slot')};`)).replay, true);
  assert.equal(await query(`select count(*) from ${P}.commit_slots where transaction_id='slot';`), '1');
});

test('8D approval and validation clocks have strict bounds before slot reservation', async () => {
  await approved('delay');
  await query(`update ${P}.runs set validated_at=clock_timestamp()-interval '6s' where transaction_id='delay';`, 'postgres');
  await fails(`select ${reserve('delay')};`, 'VALIDATION_EXPIRED');
  await query(`select ${validate('delay')}; update ${P}.approvals set consumed_at=clock_timestamp()-interval '16s' where transaction_id='delay';`, 'postgres');
  await fails(`select ${reserve('delay')};`, 'APPROVAL_EXPIRED');
});

test('8D cancel/expiry invalidate leases and survive a new native DB session', async () => {
  await prepared('cancelled');
  await query(`select ${P}.cancel('${tenant}','${actor}','cancelled');`);
  await fails(`select ${stage('cancelled')};`, 'TRANSACTION_TERMINAL');
  assert.equal(await query(`select ${P}.read_run('${tenant}','${actor}','cancelled')->>'status';`), 'CANCELLED');
  assert.equal(await query(`select payload_token is null from ${P}.runs where transaction_id='cancelled';`),'t');
  assert.equal(await query(`select ${create('cancelled')}->>'replay';`),'true');
  await fails(`select ${create('cancelled').replace('synthetic.cipher','different.cipher')};`,'IDEMPOTENCY_COLLISION');
  await prepared('expired');
  await query(`update ${P}.runs set created_at=statement_timestamp()-interval '2s',prepared_at=statement_timestamp()-interval '2s',expires_at=statement_timestamp()-interval '1s' where transaction_id='expired';`, 'postgres');
  assert.equal(await query(`select ${claim('expired')}->>'status';`), 'EXPIRED');
  assert.equal(await query(`select payload_token is null from ${P}.runs where transaction_id='expired';`),'t');
});

test('8D pending/rate/payload quotas reject atomically without extra rows', async () => {
  for (let i=0;i<8;i++) await query(`select ${create(`quota_${i}`,'tenant_b','synthetic_b')};`);
  await fails(`select ${create('quota_8','tenant_b','synthetic_b')};`, 'PENDING_LIMIT');
  await fails(`select ${create('payload').replace("'oatx1.synthetic.cipher'", "repeat('x',196609)")};`, 'check constraint');
  await query(`update ${P}.rates set prepares=20,window_start=date_trunc('minute',clock_timestamp()) where tenant_id='tenant_a';`, 'postgres');
  await fails(`select ${create('rate')};`, 'PREPARE_RATE_LIMIT');
  assert.equal(await query(`select count(*) from ${P}.runs where transaction_id in ('quota_8','payload','rate');`), '0');
});

test('8D rate window resets on minute rollover allowing prepare after expiry', async () => {
  const name = 'rollover'; await setupScope(name);
  await query(`update ${P}.rates set prepares=20,window_start=date_trunc('minute',clock_timestamp()) - interval '2 minutes' where tenant_id='${name}';`, 'postgres');
  await query(scoped(`select ${create('rollover_0')};`, name));
  assert.equal(await query(`select prepares from ${P}.rates where tenant_id='${name}';`), '1');
  assert.equal(await query(`select count(*) from ${P}.runs where tenant_id='${name}';`), '1');
});

test('8D journal status is a closed frozen vocabulary even for privileged writes', async () => {
  await fails(`update ${P}.journal set status='PROVED_BY_PAGE';`,'check constraint','postgres');
});

test('8D atomic dark finalize consumes approval and reserves once across two sessions', async () => {
  const name='atomic_ok'; await setupScope(name);
  await query(scoped(`select ${create('atomic_one')}; select ${claim('atomic_one')}; select ${stage('atomic_one')}; select ${issue('atomic_one')};`,name));
  const results=await Promise.all([query(scoped(`select ${finalize('atomic_one')}->>'replay';`,name)),query(scoped(`select ${finalize('atomic_one')}->>'replay';`,name))]);
  assert.deepEqual(results.sort(),['false','true']);
  assert.equal(await query(`select status||':'||transition from ${P}.runs where tenant_id='${name}';`),'COMMITTING:3');
  assert.equal(await query(`select count(*) from ${P}.journal where tenant_id='${name}';`),'3');
  assert.equal(await query(`select count(*) from ${P}.commit_slots where tenant_id='${name}';`),'1');
});

test('8D failed atomic slot validation rolls back nonce and authorizing journal', async () => {
  const name='atomic_fail'; await setupScope(name);
  await approveScope(name,'atomic_existing',42); await query(scoped(`select ${reserve('atomic_existing')};`,name));
  await query(scoped(`select ${create('atomic_rejected')}; select ${claim('atomic_rejected')}; select ${stage('atomic_rejected')}; select ${issue('atomic_rejected')};`,name));
  await fails(scoped(`select ${finalize('atomic_rejected')};`,name),'TARGET_COMMIT_LIMIT');
  assert.equal(await query(`select consumed_at is null from ${P}.approvals where transaction_id='atomic_rejected';`),'t');
  assert.equal(await query(`select status||':'||transition from ${P}.runs where transaction_id='atomic_rejected';`),'AWAITING_APPROVAL:1');
  assert.equal(await query(`select count(*) from ${P}.journal where transaction_id='atomic_rejected';`),'1');
  assert.equal(await query(`select commits from ${P}.rates where tenant_id='${name}';`),'1');
});

test('8D smaller durable approval/validation/commit-rate budgets reject before slot effects',async()=>{
  const name='budget_small';await setupScope(name);
  const install=async(id,limits)=>{
    await query(scoped(`select ${create(id)}; select ${claim(id)}; select ${stage(id)};`,name));
    const value=JSON.stringify({...TRANSACTION_8B_LIMITS,...limits}).replaceAll("'","''");
    await query(`insert into ${P}.run_limits values ('${name}','${id}','${value}'::jsonb);`,'postgres');
  };
  await install('budget_approval',{approvalLifetimeMs:1000});
  await fails(scoped(`select ${issue('budget_approval')};`,name),'APPROVAL_EXPIRED');
  assert.equal(await query(`select count(*) from ${P}.approvals where transaction_id='budget_approval';`),'0');
  await cancelScope(name,'budget_approval');
  await install('budget_validation',{finalValidationToDispatchMs:1});
  await query(scoped(`select ${issue('budget_validation')};select ${consume('budget_validation')};select ${validate('budget_validation')};`,name));
  await fails(scoped(`select ${reserve('budget_validation')};`,name),'VALIDATION_EXPIRED');
  assert.equal(await query(`select count(*) from ${P}.commit_slots where transaction_id='budget_validation';`),'0');
  await cancelScope(name,'budget_validation');
  await install('budget_rate',{commitRatePerTenantPerMinute:1});
  await query(scoped(`select ${issue('budget_rate')};select ${consume('budget_rate')};`,name));
  // Atomic synthetic seed + fresh validation + reservation, no client roundtrip.
  await fails(scoped(`update ${P}.rates set window_start=date_trunc('minute',clock_timestamp()),commits=1 where tenant_id='tenant_a';select ${validate('budget_rate')};select ${reserve('budget_rate')};`,name),'COMMIT_RATE_LIMIT');
  assert.equal(await query(`select count(*) from ${P}.commit_slots where transaction_id='budget_rate';`),'0');
  await cancelScope(name,'budget_rate');
});

test('8D smaller retention limits delete eligible synthetic metadata within cleanup budget',async()=>{
  const name='budget_retention';await setupScope(name);
  await query(scoped(`select ${create('retention_small')};`,name));
  const limits=JSON.stringify({...TRANSACTION_8B_LIMITS,nonterminalRetentionHours:1});
  await query(`insert into ${P}.run_limits values ('${name}','retention_small','${limits}'::jsonb); update ${P}.runs set created_at=statement_timestamp()-interval '1 hour 1 second',prepared_at=statement_timestamp()-interval '1 hour 1 second',expires_at=statement_timestamp()-interval '1 hour 1 second'+interval '10 minutes' where tenant_id='${name}';`,'postgres');
  assert.equal(await query(`select ${P}.cleanup(1);`),'1');
  assert.equal(await query(`select count(*) from ${P}.runs where tenant_id='${name}';`),'0');
  assert.equal(await query(`select count(*) from ${P}.run_limits where tenant_id='${name}';`),'0');
});

test('8D actual native worker process death before/after finalize preserves one commit identity',async()=>{
  for(const mode of ['before','after']){
    const name=`death_${mode}`,id=`death_tx_${mode}`;await setupScope(name);
    await query(scoped(`select ${create(id)};select ${claim(id)};select ${stage(id)};select ${issue(id)};`,name));
    const worker=spawn(process.execPath,[fileURLToPath(new URL('./transaction-worker-8d.mjs',import.meta.url)),bin,String(port),name,id,mode],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
    let diagnostics='';worker.stderr.on('data',chunk=>{diagnostics+=chunk;});
    try{
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Worker checkpoint timeout: '+diagnostics)),5000);
        worker.once('message',message=>{clearTimeout(timeout);message.phase===mode?resolve():reject(new Error('Wrong checkpoint'));});
        worker.once('error',error=>{clearTimeout(timeout);reject(error);});
        worker.once('exit',code=>{clearTimeout(timeout);reject(new Error('Early worker exit '+code+': '+diagnostics));});
      });
      const exited=new Promise(resolve=>worker.once('exit',resolve));
      assert.equal(worker.kill(),true);await exited;
    }finally{if(worker.exitCode===null&&!worker.killed)worker.kill();}
    // Use a short synthetic remaining lease and let DATABASE time expire naturally.
    await query(`update ${P}.runs set lease_until=clock_timestamp()+interval '100 milliseconds' where transaction_id='${id}';`,'postgres');
    await query('select pg_sleep(0.15);');
    assert.equal(await query(scoped(`select ${claim(id,'replacement_worker')}->>'leaseEpoch';`,name)),'2');
    if(mode==='before')assert.equal(await query(`select consumed_at is null from ${P}.approvals where transaction_id='${id}';`),'t');
    else assert.equal(await query(`select count(*) from ${P}.commit_slots where transaction_id='${id}';`),'1');
    const recovered=scoped(finalize(id).replace("',1,","',2,"),name);
    await query(`select ${recovered};`);await query(`select ${recovered};`);
    assert.equal(await query(`select count(*) from ${P}.commit_slots where transaction_id='${id}';`),'1');
    assert.equal(await query(`select commits from ${P}.rates where tenant_id='${name}';`),'1');
    assert.equal(await query(`select transition from ${P}.runs where transaction_id='${id}';`),'3');
  }
});

test('8D competing native slots cannot bypass physical target by changing digest', async () => {
  const name='race_target'; await setupScope(name);
  await approveScope(name,'race_one',101,'c'); await approveScope(name,'race_two',101,'9');
  const results=await Promise.allSettled(['race_one','race_two'].map(id=>query(scoped(`select ${reserve(id)};`,name))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.stderr,/TARGET_COMMIT_LIMIT/);
  assert.equal(await query(`select count(*) from ${P}.commit_slots where tenant_id='${name}';`),'1');
  assert.equal(await query(`select commits from ${P}.rates where tenant_id='${name}';`),'1');
  assert.equal(await query(`select count(*) from ${P}.runs where tenant_id='${name}' and status='APPROVED' and transition=2;`),'1');
  assert.equal(await query(`select count(*) from ${P}.journal where tenant_id='${name}' and transition=3;`),'1');
});

test('8D tenant allows two distinct targets but concurrent third contenders rollback', async () => {
  const name='race_tenant'; await setupScope(name);
  for(const [id,tab] of [['tenant_one',201],['tenant_two',202],['tenant_three',203]]) await approveScope(name,id,tab);
  await query(scoped(`select ${reserve('tenant_one')};`,name));
  const results=await Promise.allSettled(['tenant_two','tenant_three'].map(id=>query(scoped(`select ${reserve(id)};`,name))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.stderr,/COMMIT_CONCURRENCY_LIMIT/);
  assert.equal(await query(`select count(*) from ${P}.commit_slots where tenant_id='${name}';`),'2');
  assert.equal(await query(`select commits from ${P}.rates where tenant_id='${name}';`),'2');
  assert.equal(await query(`select count(*) from ${P}.runs where tenant_id='${name}' and status='APPROVED' and transition=2;`),'1');
  assert.equal(await query(`select count(*) from ${P}.journal where tenant_id='${name}' and transition=3;`),'2');
});

test('8D tenth commit succeeds, eleventh rolls back, exact replay does not spend rate', async () => {
  const name='rate_commit'; await setupScope(name);
  for(let i=0;i<11;i++) {
    const id=`commit_${i}`; await approveScope(name,id,300+i);
    // Pin the isolated synthetic window: this is a boundary test, not wall-clock minute timing.
    // Seed the synthetic boundary explicitly; do not let a real minute rollover
    // make this counter-boundary fixture depend on test scheduling.
    await query(`update ${P}.rates set window_start=date_trunc('minute',clock_timestamp()),commits=${Math.min(i,10)} where tenant_id='${name}';`,'postgres');
    if(i===10) { await fails(scoped(`select ${reserve(id)};`,name),'COMMIT_RATE_LIMIT'); break; }
    await query(scoped(`select ${reserve(id)};`,name));
    assert.equal(await query(scoped(`select ${reserve(id)}->>'replay';`,name)),'true');
    await cancelScope(name,id); // Candidate has no dispatch; release concurrent status without clearing rate/slot history.
  }
  assert.equal(await query(`select commits from ${P}.rates where tenant_id='${name}';`),'10');
  assert.equal(await query(`select count(*) from ${P}.commit_slots where tenant_id='${name}';`),'10');
  assert.equal(await query(`select status||':'||transition from ${P}.runs where tenant_id='${name}' and transaction_id='commit_10';`),'APPROVED:2');
  assert.equal(await query(`select count(*) from ${P}.journal where tenant_id='${name}' and transaction_id='commit_10' and transition=3;`),'0');
});

test('8D bounded cleanup removes eligible synthetic rows and leaves policy OFF', async () => {
  await query(`insert into ${P}.rates select 'old_rate_'||i,statement_timestamp()-interval '8 days',0,0 from generate_series(1,5) i;`, 'postgres');
  assert.equal(await query(`select ${P}.cleanup(2);`), '2');
  assert.equal(await query(`select count(*) from ${P}.rates where tenant_id like 'old_rate_%';`), '3');
  await query(`update ${P}.runs set created_at=statement_timestamp()-interval '24 hours 1 second',prepared_at=statement_timestamp()-interval '24 hours 1 second',expires_at=statement_timestamp()-interval '24 hours 1 second'+interval '10 minutes',worker_id=null,lease_until=null where transaction_id='replay';`, 'postgres');
  await query(`select ${P}.cleanup(1);`);
  assert.equal(await query(`select count(*) from ${P}.runs where transaction_id='replay';`),'0');
  await query(`update ${P}.runs set created_at=statement_timestamp()-interval '8 days',prepared_at=statement_timestamp()-interval '8 days',expires_at=statement_timestamp()-interval '8 days'+interval '10 minutes',status='EXPIRED',terminal_at=statement_timestamp()-interval '8 days',worker_id=null,lease_until=null,payload_token=null; update ${P}.policy set mode='OFF';`, 'postgres');
  assert.equal(await query(`select ${P}.cleanup(2);`), '2');
  await query(`select ${P}.cleanup(100);`);
  assert.equal(await query(`select count(*) from ${P}.runs;`), '0');
  assert.equal(await query(`select count(*) from ${P}.approvals;`), '0');
  assert.equal(await query(`select count(*) from ${P}.journal;`), '0');
  assert.equal(await query(`select count(*) from ${P}.commit_slots;`), '0');
  assert.equal(await query(`select mode from ${P}.policy;`), 'OFF');
  await query(`delete from ${P}.rates; delete from ${P}.principals;`, 'postgres');
  assert.equal(await query(`select count(*) from ${P}.principals;`), '0');
  assert.equal(await query(`select count(*) from ${P}.acceptance_bindings;`),'0');
  await query('delete from opera_agent_private.goal_heads; delete from auth.sessions;','postgres');
});
