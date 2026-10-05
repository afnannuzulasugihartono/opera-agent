// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-host-install-8d — host-install-8d — Explicit opt-in, read-only HTTP probe. No prepare/cancel/approval/browse.
// @state: install audited OFF backend and record bounded cloud probes.
// @dependencies: strict.

// Explicit opt-in, read-only HTTP probe. No prepare/cancel/approval/browser calls.

import assert from 'node:assert/strict';
const mode=process.argv[2];
assert.ok(mode==='OFF'||mode==='DARK','Specify OFF or DARK for the bounded probe');
const key=process.env.OPERA_PUBLIC_ANON_KEY;
assert.ok(key,'Supply only the public legacy anon key through environment');
const url='https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-transactions-8d';
const results=[];
for(const [name,token] of [['anon',key],['malformed','not-a-jwt']]){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
    body:JSON.stringify({operation:'status',transactionId:'m8d_install_probe'}),signal:AbortSignal.timeout(15000)});
  const body=await response.json();
  const expected=name==='malformed'?401:mode==='OFF'?503:401;
  assert.equal(response.status,expected,name+' unexpected status');
  if(name==='anon'){
    assert.equal(body.browserDispatchAllowed,false);
    assert.equal(body.error,mode==='OFF'?'TRANSACTION_DISABLED':'AUTHENTICATION_REQUIRED');
  }
  results.push({name,status:response.status,body});
}
console.log(JSON.stringify({mode,results}));
