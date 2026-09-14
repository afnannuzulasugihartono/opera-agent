import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEASE_TTL_MS_8D, parseAcceptanceArgs8D, runAcceptanceCli8D, SDK_SPECIFIER_8D, STATE_DIRECTORY_8D } from './cloud/transaction-cloud-acceptance-8d.mjs';

const namespace='12345678-1234-4234-8234-123456789abc';
const credential='sbp_'+('a'.repeat(40));

test('8D live runner freezes exact CLI modes, pinned SDK and ownership window',()=>{
  assert.deepEqual(parseAcceptanceArgs8D([]),{mode:'accept'});
  assert.deepEqual(parseAcceptanceArgs8D(['--recover',namespace]),{mode:'recover',namespace});
  assert.throws(()=>parseAcceptanceArgs8D(['--recover']),/INVALID_8D_RUNNER_ARGUMENTS/);
  assert.throws(()=>parseAcceptanceArgs8D(['--recover','not-a-uuid']),/INVALID_8D_RUNNER_ARGUMENTS/);
  assert.throws(()=>parseAcceptanceArgs8D(['--sql','select 1']),/INVALID_8D_RUNNER_ARGUMENTS/);
  assert.equal(SDK_SPECIFIER_8D,'npm:@supabase/supabase-js@2.57.4');
  assert.equal(STATE_DIRECTORY_8D,'.opera-agent-8d-state');
  assert.equal(LEASE_TTL_MS_8D,60000);
});

test('8D recovery mode needs no OAuth key, SDK call, browser or network when no dirty manifest exists',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'oa-8d-runner-'));let sdkCalls=0,fetchCalls=0;const lines=[];
  try{
    const result=await runAcceptanceCli8D({args:['--recover',namespace],createClient:()=>{sdkCalls++;throw new Error('sdk must not run');},credential,publicKey:null,
      fetchImpl:async()=>{fetchCalls++;throw new Error('network must not run');},now:()=>1000,randomUUID:()=> 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',stateDirectory:dir,write:value=>lines.push(value)});
    assert.deepEqual(result,{mode:'recover',namespace,recovered:false});assert.equal(sdkCalls,0);assert.equal(fetchCalls,0);
    assert.equal(lines.length,1);assert.equal(lines[0].includes(credential),false);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('8D acceptance fails preflight before emitting namespace or OAuth URL when deployed bundle is not exact',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'oa-8d-runner-'));const lines=[];let sdkCalls=0;
  try{
    const fetchImpl=async url=>{
      if(String(url).endsWith('/functions'))return new Response(JSON.stringify([{slug:'opera-agent-transactions-8d',status:'ACTIVE',verify_jwt:true,ezbr_sha256:'wrong'}]),{status:200,headers:{'Content-Type':'application/json'}});
      throw new Error('unexpected request');
    };
    const sdk={auth:{getClaims:async()=>({data:{},error:null}),getUser:async()=>({data:{},error:null})}};
    await assert.rejects(runAcceptanceCli8D({args:[],createClient:()=>{sdkCalls++;return sdk;},credential,publicKey:'sb_publishable_'+('x'.repeat(24)),fetchImpl,now:()=>Date.parse('2026-09-14T00:00:00.000Z'),randomUUID:()=>namespace,stateDirectory:dir,write:value=>lines.push(value)}),/CLOUD_PREFLIGHT_FAILED/);
    assert.equal(sdkCalls,1);assert.deepEqual(lines,[]);
  }finally{await rm(dir,{recursive:true,force:true});}
});
