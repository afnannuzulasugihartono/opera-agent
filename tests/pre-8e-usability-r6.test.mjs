import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateWorkflow, runWorkflow } from './helpers/workflow-runner-harness.mjs';

test('R6 recommendation reuses Home and follows the observed ref without URL reload or activation', async () => {
  const workflow = candidateWorkflow('_pre_8e_r6_navigation_reuse.sql');
  const calls = [];
  const output = await runWorkflow(workflow, {index:0}, async (method, params) => {
    calls.push({method,params});
    if (method === 'tabs.find') return {tab:{id:7,url:'https://www.youtube.com/'}};
    if (method === 'page.query' && params.selector.includes('thumbnail')) return {item:{ref:'fresh-recommendation',href:'https://www.youtube.com/watch?v=test'}};
    if (method === 'page.query') return {item:null};
    if (method === 'tabs.get') return {tab:{id:7,url:'https://www.youtube.com/watch?v=test'}};
    if (method === 'media.state') return {media:{present:true}};
    return {};
  });
  assert.equal(calls.some(c => ['tabs.navigate','tabs.open','tabs.activate','tabs.reload'].includes(c.method)), false);
  assert.equal(calls.find(c => c.method === 'page.click').params.ref, 'fresh-recommendation');
  assert.equal(output.tab.id, 7);
});

test('R6 missing tab opens background; a failed recommendation click cannot trigger navigation fallback', async () => {
  const workflow = candidateWorkflow('_pre_8e_r6_navigation_reuse.sql');
  const calls = [];
  await assert.rejects(runWorkflow(workflow, {}, async (method, params) => {
    calls.push({method,params});
    if (method === 'tabs.find') return {tab:null};
    if (method === 'tabs.open') return {tab:{id:8}};
    if (method === 'page.query') return {item:{ref:'stale',href:'https://www.youtube.com/watch?v=test'}};
    if (method === 'page.click') throw new Error('STALE_TARGET');
    return {};
  }), /STALE_TARGET/);
  assert.equal(calls.find(c => c.method === 'tabs.open').params.active, false);
  assert.equal(calls.some(c => ['tabs.navigate','tabs.activate','tabs.reload'].includes(c.method)), false);
});
