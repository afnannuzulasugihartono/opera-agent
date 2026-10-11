// @last-edited: 2026-10-11 UTC+7.
// @title: transaction-http — the dark host's HTTP boundary, which nothing tested at all.
// @state: 5 tests; configuration, the refusal ladder, the body limit, the error map, and the headers.
// @dependencies: node:test, assert.

// WHY THIS FILE EXISTS
//
// lib/transaction-http.js had no test and no gate. A grep across tests/ and scripts/
// for the module name returned nothing. It is not scaffolding either: it is imported
// by supabase/functions/opera-agent-transactions-8d/index.ts, which is a deployed edge
// function. So a deployed HTTP boundary — the one place a malformed request, an
// oversized body or a stolen token enters the system — was carrying roughly twenty
// invariants with nothing holding any of them.
//
// This is the shape of a security boundary, and every lock below is one an innocent
// edit could plausibly break:
//
//   - configuration is validated at CONSTRUCTION, so a misconfigured handler never
//     exists, rather than at request time where it would fail per request;
//   - unknown keys are rejected outright, because a typo'd key would otherwise be
//     silently ignored and the operator would believe a setting applied;
//   - the refusal ladder is ordered, and the order is the security property: a
//     disabled host must not leak whether the token was good;
//   - the body limit is enforced WHILE STREAMING, with the reader cancelled, because a
//     limit checked only after buffering is not a limit;
//   - every response carries browserDispatchAllowed:false, so nothing that reaches a
//     browser can be mistaken for authority to drive one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransactionDarkHttpHandler } from '../lib/transaction-http.js';

const LIMIT = 524288;

const post = (body, headers = {}) => new Request('https://example.test/', {
  method: 'POST',
  headers: { authorization: 'Bearer tok', 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});

const handlerOver = (extra = {}) => createTransactionDarkHttpHandler({
  host: async () => ({ ok: true }),
  ...extra
});

const read = async (response) => ({ status: response.status, body: await response.json() });

test('the configuration is refused at construction, never at request time', () => {

  const bad = [
    ['no configuration', undefined],
    ['no host', {}],
    ['a host that is not a function', { host: 'yes' }],
    ['an unknown key', { host: async () => ({}), secret: 1 }],
    ['a non-boolean enabled', { host: async () => ({}), enabled: 'yes' }]
  ];
  for (const [why, configuration] of bad) {
    assert.throws(() => createTransactionDarkHttpHandler(configuration),
      /INVALID_HTTP_CONFIGURATION/, `${why} is refused`);
  }

  assert.doesNotThrow(() => createTransactionDarkHttpHandler({ host: async () => ({}) }));
});

test('the refusal ladder is ordered, and a disabled host answers before the token is read', async () => {

  const disabled = handlerOver({ enabled: false });

  const withoutToken = await read(await disabled(new Request('https://example.test/', { method: 'POST' })));
  assert.equal(withoutToken.status, 503, 'a disabled host answers even with no token at all');
  assert.equal(withoutToken.body.error, 'TRANSACTION_DISABLED');
  assert.equal(withoutToken.body.browserDispatchAllowed, false);

  const wrongMethod = await read(await disabled(new Request('https://example.test/', { method: 'GET' })));
  assert.equal(wrongMethod.body.error, 'TRANSACTION_DISABLED', 'and it does not become a 405 first');

  const live = handlerOver({ enabled: true });
  assert.equal((await read(await live(post({ operation: 'status' })))).status, 200);
});

test('the method, the token and the content type are each refused on their own', async () => {
  const handler = handlerOver({ enabled: true });

  const wrongMethod = await read(await handler(new Request('https://example.test/', { method: 'PUT' })));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.error, 'METHOD_NOT_ALLOWED');

  for (const [why, authorization] of [
    ['no header', undefined],
    ['not a bearer', 'Basic tok'],
    ['a token with a space', 'Bearer  tok'],
    ['an empty token', 'Bearer ']
  ]) {
    const headers = authorization === undefined ? { 'content-type': 'application/json' } : { authorization, 'content-type': 'application/json' };
    const response = await read(await handler(new Request('https://example.test/', { method: 'POST', headers, body: '{}' })));
    assert.equal(response.status, 401, `${why} is refused`);
    assert.equal(response.body.error, 'AUTHENTICATION_REQUIRED');
  }

  const badType = await read(await handler(post({}, { 'content-type': 'text/plain' })));
  assert.equal(badType.status, 415);
  assert.equal(badType.body.error, 'INVALID_CONTENT_TYPE');

  const withCharset = await read(await handler(post({ operation: 'status' }, { 'content-type': 'application/json; charset=utf-8' })));
  assert.equal(withCharset.status, 200, 'a charset parameter is still application/json');
});

test('the body limit is enforced while streaming, and the reader is cancelled', async () => {
  const handler = handlerOver({ enabled: true });

  const lying = await read(await handler(post({ operation: 'status' }, { 'content-length': '99999999' })));
  assert.equal(lying.status, 413, 'a declared length over the limit is refused before reading');

  const malformed = await read(await handler(post({ operation: 'status' }, { 'content-length': 'lots' })));
  assert.equal(malformed.status, 413, 'a length that is not a number is refused');

  let pulled = 0;
  const chunk = new Uint8Array(65536).fill(120);
  let served = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (served >= 40) { controller.close(); return; }
      served += 1;
      pulled += chunk.byteLength;
      controller.enqueue(chunk);
    }
  });

  const oversized = new Request('https://example.test/', {
    method: 'POST',
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
    body: stream,
    duplex: 'half'
  });

  const overStream = await read(await handler(oversized));
  assert.equal(overStream.status, 413, 'a body over the limit is refused even with no content-length');
  assert.equal(overStream.body.error, 'LIMIT_REACHED');
  assert.ok(pulled <= LIMIT + 65536,
    `the read stops at the limit instead of draining the body (pulled ${pulled} of ${40 * 65536})`);

  const under = await read(await handler(post({ operation: 'status', pad: 'y'.repeat(1000) })));
  assert.equal(under.status, 200, 'a body under the limit is accepted');
});

test('the payload is parsed strictly, the operation is allowlisted, and the host cannot reach a browser', async () => {
  const seen = [];
  const handler = createTransactionDarkHttpHandler({
    enabled: true,
    host: async (input, token) => { seen.push({ input, token }); return { ok: true, echo: input.operation }; }
  });

  for (const [why, body, expected] of [
    ['not JSON', 'not json at all', 400],
    ['a JSON array', '[]', 400],
    ['a JSON scalar', '"hello"', 400],
    ['an unknown operation', { operation: 'delete_everything' }, 400],
    ['no operation', { somethingElse: 1 }, 400]
  ]) {
    const response = await read(await handler(post(body)));
    assert.equal(response.status, expected, `${why} is refused`);
    assert.equal(response.body.error, 'INVALID_REQUEST');
  }

  for (const [why, bytes] of [
    ['invalid UTF-8 beside a valid operation', [0x7b, 0x22, 0x6f, 0x70, 0x65, 0x72, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x22, 0x3a, 0x22, 0x73, 0x74, 0x61, 0x74, 0x75, 0x73, 0x22, 0x2c, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]],
    ['a lone continuation byte', [0x7b, 0x22, 0x6f, 0x70, 0x65, 0x72, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x22, 0x3a, 0x22, 0x73, 0x74, 0x61, 0x74, 0x75, 0x73, 0x22, 0x2c, 0x22, 0x78, 0x22, 0x3a, 0x22, 0x80, 0x22, 0x7d]]
  ]) {
    const badUtf8 = await read(await handler(new Request('https://example.test/', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: new Uint8Array(bytes),
      duplex: 'half'
    })));
    assert.equal(badUtf8.status, 400, `${why} is refused, not silently replaced`);
    assert.equal(badUtf8.body.error, 'INVALID_REQUEST');
  }

  const literalReplacement = createTransactionDarkHttpHandler({ enabled: true, host: async () => ({ ok: true }) });
  assert.equal((await read(await literalReplacement(post({ operation: 'status', x: '�' })))).status, 200,
    'a literal U+FFFD sent on purpose is fine — the point is that we do not CREATE one');

  const good = await read(await handler(post({ operation: 'prepare', a: 1 })));
  assert.equal(good.status, 200);
  assert.deepEqual(good.body.result, { ok: true, echo: 'prepare' });
  assert.equal(good.body.browserDispatchAllowed, false, 'no answer may claim browser authority');
  assert.deepEqual(seen, [{ input: { operation: 'prepare', a: 1 }, token: 'tok' }],
    'the host receives the parsed body and the bearer token, nothing else');

  const cacheProbe = await handler(post({ operation: 'status' }));
  assert.equal(cacheProbe.headers.get('cache-control'), 'no-store');
  assert.equal(cacheProbe.headers.get('x-content-type-options'), 'nosniff');
});

test('a host failure is mapped by code, and an unknown failure is never leaked as itself', async () => {

  const cases = [
    ['AUTHENTICATION_REQUIRED', 401],
    ['TRANSACTION_DISABLED', 503],
    ['STORAGE_ERROR', 503],
    ['TRANSACTION_EXPIRED', 503],
    ['LIMIT_REACHED', 413],
    ['SOMETHING_NEW_AND_UNKNOWN', 400]
  ];

  const known = cases.filter(([code]) => code !== 'SOMETHING_NEW_AND_UNKNOWN');
  for (const [code, status] of known) {
    const handler = createTransactionDarkHttpHandler({
      enabled: true,
      host: async () => { const error = new Error('boom'); error.code = code; throw error; }
    });
    const response = await read(await handler(post({ operation: 'status' })));
    assert.equal(response.status, status, `${code} maps to ${status}`);
    assert.equal(response.body.error, code, `${code} is reported back, because the caller can act on it`);
    assert.equal(response.body.browserDispatchAllowed, false);
  }

  const unknown = createTransactionDarkHttpHandler({
    enabled: true,
    host: async () => { const error = new Error('boom'); error.code = 'SOMETHING_NEW_AND_UNKNOWN'; throw error; }
  });
  const collapsed = await read(await unknown(post({ operation: 'status' })));
  assert.equal(collapsed.status, 400);
  assert.deepEqual(collapsed.body, { error: 'INVALID_REQUEST', browserDispatchAllowed: false },
    'an unrecognised host code is NOT reflected back to the caller');

  const leaky = createTransactionDarkHttpHandler({
    enabled: true,
    host: async () => { throw new Error('connection to postgres://internal-host:5432 refused'); }
  });
  const stopped = await read(await leaky(post({ operation: 'status' })));
  assert.equal(stopped.status, 400);
  assert.deepEqual(stopped.body, { error: 'INVALID_REQUEST', browserDispatchAllowed: false });
});