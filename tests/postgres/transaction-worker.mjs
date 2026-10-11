// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-worker-8d — worker-8d — Synthetic native journal worker only, NEVER a production runner.
// @state: refactor(quality): centralize code-unit comparator in lib/canonical-order.js - removes token-identical inline comparator blocks that tripped.
// @dependencies: node:child_process, node:util, node:path, node:crypto, canonical-order.

// Synthetic native journal worker only, NEVER a production runner.

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { codeUnitCompare } from '../../lib/canonical-order.js';
const run=promisify(execFile);
const [bin,port,tenant,tx,mode,encodedContext]=process.argv.slice(2);
if(!path.isAbsolute(bin)||!/^\d{1,5}$/.test(port)||![tenant,tx].every(v=>/^[A-Za-z0-9_-]{1,128}$/.test(v))||!['before','after'].includes(mode))throw new Error('INVALID_SYNTHETIC_WORKER');
const hash=c=>'sha256:'+c.repeat(64),nonce='sha256:'+createHash('sha256').update(tx).digest('hex');
const context=encodedContext?JSON.parse(encodedContext):{route:'primitive',actor:'synthetic_a',epoch:1,fence:hash('b'),nonce,approval:hash('e'),consumption:hash('f')};
if(Object.keys(context).sort(codeUnitCompare).join(',')!=='actor,approval,consumption,epoch,fence,nonce,route'
  ||!['primitive','bound'].includes(context.route)||!/^[A-Za-z0-9_-]{1,128}$/.test(context.actor)||!Number.isInteger(context.epoch)||context.epoch<1
  ||![context.fence,context.nonce,context.approval,context.consumption].every(value=>/^sha256:[0-9a-f]{64}$/.test(value)))throw new Error('INVALID_SYNTHETIC_WORKER_CONTEXT');
const finalize=context.route==='bound'?'public.opera_tx_finalize_bound':'opera_agent_tx_candidate.finalize_dark';
if(mode==='after')await run(path.join(bin,process.platform==='win32'?'psql.exe':'psql'),['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-c',`set statement_timeout='5s';set role service_role;select ${finalize}('${tenant}','${context.actor}','${tx}',${context.epoch},'${context.fence}','${context.nonce}','${context.approval}','${context.consumption}');`],{windowsHide:true});
process.send({phase:mode});
setInterval(()=>{},1000);
