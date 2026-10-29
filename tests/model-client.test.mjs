// @last-edited: 2026-10-25 UTC+7.
// @title: model-client.test — the device-local model compiler holds its gate and its bounds.
// @state: the config gate, the single destination, the call bound, the streamed answer assembled from deltas, and the key that never leaves.
// @dependencies: node:test, strict, extension-source.

import test from 'node:test';
import assert from 'node:assert/strict';
import { extensionSource } from './helpers/extension-source.mjs';
import {
  composeModelPlan,
  buildProbeRequest,
  endpointOk,
  MODEL_TIMEOUT_MS,
  MODEL_MAX_TOKENS
} from '../extension/lib/model-client.js';

const storageOf = (cfg) => ({ get: async () => cfg });
const program = { root: {
  type: 'SEQUENCE',
  children: [{
    type: 'COMMAND',
    method: 'page.find',
    arguments: { text: 'Skip' },
    resultBinding: 'hit'
  }]
} };
const fetchOk = (
  t,
  body = program
) => {
  t.calls = [];
  return async (
    url,
    init
  ) => {
    t.calls.push({
      url,
      init
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] })
    };
  };
};
const full = {
  modelEndpoint: 'https://llm.example.com/v1/chat/completions',
  modelName: 'm',
  modelKey: 'fixture-model-key-abc123'
};
const target = {
  deviceId: 'opera',
  tabId: 1
};
const budgets = {
  astDepth: 12,
  browserCommandLeavesPerRun: 12
};

const sseResponse = (chunks) => {
  const encoder = new TextEncoder();
  let index = 0;
  const reader = {
    cancelled: false,
    read: async () => (index < chunks.length ? {
      done: false,
      value: encoder.encode(chunks[index++])
    } : { done: true }),
    cancel: async () => {
      reader.cancelled = true;
    }
  };
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
    body: { getReader: () => reader },
    reader
  };
};
const sseChunks = (
  text,
  { end = true } = {}
) => {
  const chunks = [
    text.slice(0, 8),
    text.slice(8, 20),
    text.slice(20)
  ]
    .filter(Boolean)
    .map((part) => `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
  if (end) chunks.push('data: [DONE]\n\n');
  return chunks;
};

test('unconfigured device never fetches', async () => {
  const t = {};
  const out = await composeModelPlan({
    storage: storageOf({}),
    fetchImpl: fetchOk(t)
  }, {
    goal: 'x',
    page: {},
    target,
    budgets
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'MODEL_NOT_CONFIGURED');
  assert.deepEqual(t.calls, []);
});

test('http remote endpoint is refused before fetch', async () => {
  const t = {};
  const out = await composeModelPlan({
    storage: storageOf({
      ...full,
      modelEndpoint: 'http://evil.example.com/x'
    }),
    fetchImpl: fetchOk(t)
  }, {
    goal: 'x',
    page: {},
    target,
    budgets
  });
  assert.equal(out.ok, false);
  assert.deepEqual(t.calls, []);
});

test('one bounded POST to the configured endpoint only, key never in body or result', async () => {
  const t = {};
  const out = await composeModelPlan({
    storage: storageOf(full),
    fetchImpl: fetchOk(t)
  }, {
    goal: 'find skip',
    page: {},
    target,
    budgets
  });
  assert.equal(out.ok, true);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].url, full.modelEndpoint);
  const sent = JSON.parse(t.calls[0].init.body);
  assert.equal(sent.model, 'm');
  assert.equal(sent.temperature, 0);
  assert.ok(!JSON.stringify(sent).includes('fixture-model-key-abc123'), 'key must not be in the body');
  assert.equal(t.calls[0].init.headers.Authorization, 'Bearer fixture-model-key-abc123');
  assert.ok(!JSON.stringify(out).includes('fixture-model-key-abc123'), 'key must not be in the result');
});

test('non-conforming response is refused, never a program', async () => {
  const t = {};
  const bad = async (
    url,
    init
  ) => {
    t.calls = [{ url }]; return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [] })
    };
  };
  const out = await composeModelPlan({
    storage: storageOf(full),
    fetchImpl: bad
  }, {
    goal: 'x',
    page: {},
    target,
    budgets
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'MODEL_BAD_RESPONSE');
});

test('a streamed answer is assembled from deltas and compiled', async () => {
  const t = {};
  let response;
  const fetchImpl = async (
    url,
    init
  ) => {
    t.calls = [{
      url,
      init
    }]; response = sseResponse(sseChunks(JSON.stringify(program))); return response;
  };
  const out = await composeModelPlan({
    storage: storageOf(full),
    fetchImpl
  }, {
    goal: 'find skip',
    page: {},
    target,
    budgets
  });
  assert.equal(out.ok, true);
  const sent = JSON.parse(t.calls[0].init.body);
  assert.equal(sent.stream, true);
  assert.equal(response.reader.cancelled, true, 'the reader is released once [DONE] lands');
});

test('a stream that ends without [DONE] still compiles', async () => {
  const fetchImpl = async () => sseResponse(sseChunks(JSON.stringify(program), { end: false }));
  const out = await composeModelPlan({
    storage: storageOf(full),
    fetchImpl
  }, {
    goal: 'x',
    page: {},
    target,
    budgets
  });
  assert.equal(out.ok, true);
});

test('keep-alive and unparsable stream lines are skipped, never fatal', async () => {
  const chunks = [
    ': keep-alive\n\n',
    'data: not-json\n\n',
    'data: {"choices":[{"delta":{}}]}\n\n',
    'data: {"error":{"message":"late"}}\n\n',
    ...sseChunks(JSON.stringify(program), { end: false }),
    'data: [DONE]\n\n'
  ];
  const fetchImpl = async () => sseResponse(chunks);
  const out = await composeModelPlan({
    storage: storageOf(full),
    fetchImpl
  }, {
    goal: 'x',
    page: {},
    target,
    budgets
  });
  assert.equal(out.ok, true);
});

test('a server that ignores stream:true and answers plain JSON still compiles', async () => {
  const t = {};
  const fetchImpl = async (
    url,
    init
  ) => {
    t.calls = [{
      url,
      init
    }];
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ choices: [{ message: { content: JSON.stringify(program) } }] })
    };
  };
  const out = await composeModelPlan({
    storage: storageOf(full),
    fetchImpl
  }, {
    goal: 'x',
    page: {},
    target,
    budgets
  });
  assert.equal(out.ok, true);
  assert.equal(JSON.parse(t.calls[0].init.body).stream, true);
});

test('a stream without any text surfaces MODEL_BAD_RESPONSE', async () => {
  const fetchImpl = async () => sseResponse([
    'data: {"choices":[{"delta":{}}]}\n\n',
    'data: [DONE]\n\n'
  ]);
  const out = await composeModelPlan({
    storage: storageOf(full),
    fetchImpl
  }, {
    goal: 'x',
    page: {},
    target,
    budgets
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'MODEL_BAD_RESPONSE');
});

test('a hung stream surfaces MODEL_TIMEOUT, never a hang', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: { getReader: () => ({
      read: () => Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })),
      cancel: async () => {}
    }) }
  });
  const out = await composeModelPlan({
    storage: storageOf(full),
    fetchImpl
  }, {
    goal: 'x',
    page: {},
    target,
    budgets
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'MODEL_TIMEOUT');
});

test('probe carries no page content and no goal', () => {
  const probe = buildProbeRequest({ model: 'm' });
  assert.equal(probe.temperature, 0);
  assert.ok(JSON.stringify(probe).length < 300);
});

test('a hung endpoint surfaces MODEL_TIMEOUT, never a hang', async () => {
  const hanging = () => Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
  const out = await composeModelPlan({
    storage: storageOf(full),
    fetchImpl: hanging
  }, {
    goal: 'x',
    page: {},
    target,
    budgets
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'MODEL_TIMEOUT');
});
test('compiler bounds are pinned', () => {
  assert.equal(MODEL_TIMEOUT_MS, 30000);
  assert.equal(MODEL_MAX_TOKENS, 2000);
});

test('endpoint allowlist: https or loopback only', () => {
  assert.equal(endpointOk('https://llm.example.com/v1/chat/completions'), true);
  assert.equal(endpointOk('http://127.0.0.1:11434/v1/chat/completions'), true);
  assert.equal(endpointOk('http://evil.example.com/x'), false);
  assert.equal(endpointOk('not-a-url'), false);
});

test('background routes the options probe action to the compiler module', async () => {
  const bg = await extensionSource();
  assert.ok(bg.includes(`scope === 'opera-agent-options'`));
  assert.ok(bg.includes(`action === 'testModel'`));
  assert.ok(bg.includes('buildProbeRequest'));
});

test('malformed endpoint refuses before fetch', async () => {
  const t = {};
  const out = await composeModelPlan({
    storage: storageOf({
      ...full,
      modelEndpoint: 'notaurl'
    }),
    fetchImpl: fetchOk(t)
  }, {
    goal: 'x',
    page: {},
    target,
    budgets
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'MODEL_BAD_ENDPOINT');
  assert.deepEqual(t.calls, []);
});

test('non-timeout rejection surfaces MODEL_HTTP_ERROR, never MODEL_TIMEOUT', async () => {
  const boom = async () => {
    throw new Error('boom');
  };
  const out = await composeModelPlan({
    storage: storageOf(full),
    fetchImpl: boom
  }, {
    goal: 'x',
    page: {},
    target,
    budgets
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'MODEL_HTTP_ERROR');
});

test('non-ok status surfaces MODEL_HTTP_ERROR with the status', async () => {
  const bad = async () => ({
    ok: false,
    status: 500
  });
  const out = await composeModelPlan({
    storage: storageOf(full),
    fetchImpl: bad
  }, {
    goal: 'x',
    page: {},
    target,
    budgets
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'MODEL_HTTP_ERROR');
  assert.ok(out.message.includes('500'));
});
