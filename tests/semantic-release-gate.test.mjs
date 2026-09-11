import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

await import('../extension/semantic-identity.js');
await import('../extension/semantic-views.js');

const { createIdentityEngine } = globalThis.OperaAgentSemanticIdentity;
const { createViewEngine } = globalThis.OperaAgentSemanticViews;
const contract = JSON.parse(fs.readFileSync(new URL('./fixtures/mcp-contract-v1.json', import.meta.url), 'utf8'));
const mcpSource = fs.readFileSync(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');

function element(key, overrides = {}) {
  return {
    ref: `ref-${key}`, stableKey: `key-${key}`, stableKeySource: 'id', tag: 'button', role: 'button',
    label: `Item ${key}`, text: `Item ${key}`, rect: { x: 0, y: 0, width: 80, height: 24 },
    inViewport: true, sensitive: false, regionKey: 'feed', ...overrides,
  };
}

function random(seed = 0x5f1600) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000);
}

test('MCP v1 tool names and input schemas remain byte-for-byte locked', () => {
  const digest = crypto.createHash('sha256').update(mcpSource).digest('hex');
  const tools = [...mcpSource.matchAll(/server\.registerTool\("([a-z_]+)"/g)].map((match) => match[1]);
  assert.equal(contract.protocolVersion, 1);
  assert.equal(digest, contract.sourceSha256);
  assert.equal(tools.length, contract.toolCount);
  assert.deepEqual(tools, contract.tools);
});

test('legacy and enriched page.read results both survive the unchanged MCP envelope', () => {
  const envelope = (result) => JSON.parse(JSON.stringify({ ok: true, commandId: 'command', status: 'completed', result }));
  const legacy = envelope({ page: { title: 'Legacy', elements: [{ ref: 'oa_old' }] } });
  const enriched = envelope({ page: {
    title: 'Candidate', elements: [{ ref: 'oa_new', logicalId: 'se_new' }],
    semanticState: { observationRevision: 2 }, semanticDelta: { classification: 'UPDATE' },
    semanticViews: { schemaVersion: 1, regions: [] },
  } });
  assert.equal(legacy.result.page.semanticState, undefined);
  assert.equal(enriched.result.page.elements[0].logicalId, 'se_new');
  assert.equal(enriched.result.page.semanticDelta.classification, 'UPDATE');
  assert.match(mcpSource, /result: completed\.result/);
  assert.match(mcpSource, /structuredContent = value && typeof value === "object" \? value/);
});

test('deterministic mutation fuzz preserves bounds, uniqueness, resets, and proof safety', () => {
  const rng = random();
  let clock = 1000;
  const identity = createIdentityEngine({
    documentId: 'fuzz-document', maxEntities: 40, maxCacheBytes: 40_000, maxAgeMs: 100,
    maxDeltaChanges: 12, maxDeltaBytes: 8_000, now: () => clock,
  });
  const views = createViewEngine({ maxRegions: 4, maxEntities: 40, now: () => clock });
  let keys = [];
  for (let step = 0; step < 250; step += 1) {
    clock += 2;
    const choice = Math.floor(rng() * 6);
    if (choice <= 1 && keys.length < 55) keys.push(`k${step}`);
    else if (choice === 2 && keys.length) keys.splice(Math.floor(rng() * keys.length), 1);
    else if (choice === 3) keys.reverse();
    else if (choice === 4 && step % 31 === 0) identity.reset('FUZZ_RESET');
    const observed = keys.slice(0, 45).map((key, index) => element(key, {
      label: `Item ${key} revision ${step % 17 === 0 && index === 0 ? step : 0}`,
      text: `Item ${key}`, inViewport: index < 8,
    }));
    const result = identity.observe(observed);
    const logicalIds = result.items.map((item) => item.logicalId).filter(Boolean);
    assert.equal(new Set(logicalIds).size, logicalIds.length);
    assert.ok(result.state.entityCount <= 40);
    assert.ok(result.state.cacheBytes <= 40_000);
    assert.ok(result.delta.changes.length <= 12 || result.delta.classification === 'RESET');
    const view = views.observe({
      regions: [{ regionId: 'feed', kind: 'repeated', role: 'feed', label: 'Results', scroll: {
        scrollTop: step, scrollHeight: 1000, clientHeight: 100, reachedBottom: false,
      } }], items: result.items, semanticState: result.state, delta: result.delta,
    });
    assert.ok(view.regions.length <= 4);
    assert.ok(view.regions[0].loadedEntityCount <= 40);
    assert.notEqual(view.regions[0].completion.status, 'PROVED');
  }
  clock += 200;
  identity.observe([]);
  assert.equal(identity.inspect().entityCount, 0);
});

test('document engines isolate identical entities and never retain sensitive values', () => {
  const first = createIdentityEngine({ documentId: 'tab-a' });
  const second = createIdentityEngine({ documentId: 'tab-b' });
  const a = first.observe([element('same'), element('secret', { sensitive: true, value: 'never-retain-me' })]);
  const b = second.observe([element('same')]);
  assert.notEqual(a.items[0].logicalId, b.items[0].logicalId);
  assert.equal(a.items[1].logicalId, undefined);
  assert.doesNotMatch(JSON.stringify(first.inspect()), /never-retain-me|secret/);
});
