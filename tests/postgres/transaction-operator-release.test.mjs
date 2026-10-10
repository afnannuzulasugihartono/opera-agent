// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-operator-release-8d.test — operator-release-8d.test — Repository file.
// @state: install reviewed fence OFF and pin deployed Edge.
// @dependencies: strict, node:test, node:child_process, promises, node:os, node:path, node:net.

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

// Opt-in real PostgreSQL gate; absence of native tools is a failure, not a skip.

const bin=process.env.OPERA_PG_BIN;
assert.ok(bin,'OPERA_PG_BIN is required for the native release gate');
const exe=name=>join(bin,name+(process.platform==='win32'?'.exe':''));
const control=args=>new Promise((resolve,reject)=>{
  const child=spawn(exe('pg_ctl'),args,{windowsHide:true,stdio:'ignore'});
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('pg_ctl failed: '+code)));
});

test('8D exclusive release refuses late committed rows and retains ownership',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'oa-release-native-'));
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));
  const port=socket.address().port;await new Promise(r=>socket.close(r));
  let started=false;
  const args=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'];
  const query=sql=>execFileSync(exe('psql'),args,{input:sql,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
  try {
    execFileSync(exe('initdb'),['-D',join(dir,'data'),'-U','postgres','-A','trust','--no-locale','-E','UTF8'],{windowsHide:true,stdio:'ignore'});
    await control(['-D',join(dir,'data'),'-l',join(dir,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);started=true;
    const tables=['principals','rates','acceptance_bindings','runs','run_identities','run_limits','run_previews','run_challenges','journal','approvals','commit_slots'];
    query(`create role anon;create role authenticated;create role service_role;create schema opera_agent_tx_candidate;create schema opera_agent_private;
      create table opera_agent_tx_candidate.policy(singleton boolean primary key,mode text,legacy_gated boolean,agent_commit_enabled boolean);
      insert into opera_agent_tx_candidate.policy values(true,'OFF',false,false);
      create table opera_agent_private.goal_heads(tenant_id uuid);
      ${tables.map(name=>`create table opera_agent_tx_candidate.${name}(tenant_id text);`).join('\n')}`);
    query(await readFile(new URL('../../supabase/migrations/20260914043049_transaction_operator_fence_8d.sql',import.meta.url),'utf8'));
    const ns='11111111-1111-4111-8111-111111111111';
    const binding=`'native_owner_01','${ns}',1`;
    assert.equal(query(`select public.opera_tx_operator_acquire_8d('native_owner_01','${ns}',180000)`),'1');
    for(const name of [...tables,'goal_heads']){
      const table=(name==='goal_heads'?'opera_agent_private':'opera_agent_tx_candidate')+'.'+name;
      assert.equal(query(`select count(*) from ${table}`),'0');
      query(`begin;select public.opera_tx_operator_assert_8d(${binding});insert into ${table} values('${ns}');commit;`);
      assert.throws(()=>query(`select public.opera_tx_operator_release_8d(${binding})`),e=>e.stderr?.includes('SERVER_FENCE_OWNED_ROWS_REMAIN'));
      assert.equal(query(`select owner_id from opera_agent_tx_candidate.operator_control`),'native_owner_01');
      query(`delete from ${table}`);
    }

    // Actual concurrent admission: release must wait for the share-lock holder,
    // then see the newly committed row rather than trust an earlier zero read.
    const late=spawn(exe('psql'),[...args,'-c',`set application_name='oa_8d_late_insert';begin;
      select public.opera_tx_operator_assert_8d(${binding});
      insert into opera_agent_tx_candidate.principals values('${ns}');
      select pg_sleep(1);commit;`],{windowsHide:true,stdio:'ignore'});
    const settled=new Promise((resolve,reject)=>{late.once('error',reject);late.once('exit',code=>code===0?resolve():reject(new Error('late insert failed')));});
    let holding=false;
    for(let attempt=0;attempt<100;attempt++){
      holding=query("select count(*) from pg_stat_activity where application_name='oa_8d_late_insert' and wait_event='PgSleep'")==='1';
      if(holding)break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(holding,true,'late insert reached its admitted share-lock boundary');
    assert.throws(()=>query(`select public.opera_tx_operator_release_8d(${binding})`),e=>e.stderr?.includes('SERVER_FENCE_OWNED_ROWS_REMAIN'));
    await settled;
    assert.equal(query('select count(*) from opera_agent_tx_candidate.principals'),'1');
    query('delete from opera_agent_tx_candidate.principals');
    assert.equal(query(`select public.opera_tx_operator_release_8d(${binding})`),'t');
    assert.throws(()=>query(`select public.opera_tx_operator_assert_8d(${binding})`),e=>e.stderr?.includes('SERVER_FENCE_LOST'));
  } finally {
    if(started)await control(['-D',join(dir,'data'),'-m','fast','-w','stop']);
    console.log('Native PostgreSQL stopped; synthetic evidence: '+dir);
  }
});
