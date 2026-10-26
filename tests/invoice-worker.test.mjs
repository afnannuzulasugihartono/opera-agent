// @last-edited: 2026-10-26 UTC+7.
// @title: invoice-worker — the page reaches the browser as a page, and every other path is still the site.
// @state: the proxy, the relabel, the redirect, the asset fallback, the failure page, and the absence of a secret.
// @dependencies: node:test, node:assert, node:fs, ../landing/_worker.js.

// WHY THE PROXY IS DRIVEN RATHER THAN DEPLOYED AND LOOKED AT.
// The page only became unreadable because a gateway relabelled it, and the fix is a relabel on the other side of a network hop this test can stand in for.
// So the function is replaced by a stub that returns exactly what the gateway returns, and the worker is read for what a browser would receive: the type, the policy, the redirect, and the fallback.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import worker from '../landing/_worker.js';

const PAGE = 'https://opera-agent.pages.dev/invoice?invoice_id=Uji%20Sandbox%3A2027-09&token=tok-1234';
const UPSTREAM = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-billing?invoice_id=Uji%20Sandbox%3A2027-09&token=tok-1234';

const calls = [];
const assetCalls = [];
let answer = () => new Response('');

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  return answer(String(url), init);
};
after(() => {
  globalThis.fetch = realFetch;
});

const env = {
  ASSETS: {
    async fetch(request) {
      assetCalls.push(request);
      return new Response('asset', { status: 200, headers: { 'content-type': 'text/plain' } });
    }
  }
};

function reset(next) {
  calls.length = 0;
  assetCalls.length = 0;
  answer = next;
}

test('the page is fetched from the function with the same query and answered as HTML', async () => {
  reset(() => new Response('<!doctype html><html lang="en"><body>Total Rp 99.000</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/plain' }
  }));

  const response = await worker.fetch(new Request(PAGE), env);

  assert.equal(calls.length, 1, 'one question to the function, not a second one');
  assert.equal(calls[0].url, UPSTREAM, 'the query is the page the customer opened');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8', 'the body is HTML, so it is labelled HTML');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  const policy = response.headers.get('content-security-policy');
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /style-src 'unsafe-inline'/);
  assert.match(policy, /form-action 'self'/, 'the refresh form posts back to this origin');
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(await response.text(), /Total Rp 99\.000/);
});

test('a JSON answer keeps its type and its status, because an error is not a page', async () => {
  reset(() => new Response('{"error":"that link does not open that invoice."}', {
    status: 401,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  }));

  const response = await worker.fetch(new Request(PAGE), env);

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('content-security-policy'), null);
  assert.equal(await response.text(), '{"error":"that link does not open that invoice."}');
});

test('the refresh form is forwarded whole, and its redirect comes back to the page address', async () => {
  const body = 'action=refresh-payment&invoice_id=Uji+Sandbox%3A2027-09&token=tok-1234';
  reset(() => new Response(null, {
    status: 303,
    headers: { location: UPSTREAM }
  }));

  const response = await worker.fetch(new Request('https://opera-agent.pages.dev/invoice', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  }), env);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.get('content-type'), 'application/x-www-form-urlencoded');
  assert.equal(Buffer.from(calls[0].init.body).toString(), body, 'the token in the form is the token the function checks');
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/invoice?invoice_id=Uji%20Sandbox%3A2027-09&token=tok-1234');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('a redirect written as a path is rewritten too, because the function only knows its own address', async () => {
  reset(() => new Response(null, {
    status: 303,
    headers: { location: '/opera-agent-billing?invoice_id=Uji%20Sandbox%3A2027-09&token=tok-1234&refresh=failed' }
  }));

  const response = await worker.fetch(new Request(PAGE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'action=refresh-payment'
  }), env);

  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/invoice?invoice_id=Uji%20Sandbox%3A2027-09&token=tok-1234&refresh=failed');
});

test('a redirect to another host is left alone rather than turned into a page on this one', async () => {
  reset(() => new Response(null, {
    status: 303,
    headers: { location: 'https://example.com/elsewhere' }
  }));

  const response = await worker.fetch(new Request(PAGE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'action=refresh-payment'
  }), env);

  assert.equal(response.headers.get('location'), 'https://example.com/elsewhere');
});

test('every other path is the asset server\'s, untouched and never sent to the function', async () => {
  reset(() => {
    throw new Error('the function must not be called for an asset');
  });

  const request = new Request('https://opera-agent.pages.dev/beranda');
  const response = await worker.fetch(request, env);

  assert.equal(calls.length, 0, 'the worker owns one path, not the site');
  assert.equal(assetCalls.length, 1);
  assert.equal(assetCalls[0], request, 'the asset server sees the request the browser sent');
  assert.equal(await response.text(), 'asset');
});

test('the trailing slash is the same page, so a form posted without an action still works', async () => {
  reset(() => new Response('<!doctype html><html lang="en"></html>', { status: 200 }));

  const response = await worker.fetch(new Request('https://opera-agent.pages.dev/invoice/?invoice_id=x&token=y'), env);

  assert.equal(response.status, 200);
  assert.equal(calls[0].url, 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-billing?invoice_id=x&token=y');
});

test('a function that cannot be reached answers with a page and no reason a customer cannot use', async () => {
  reset(() => {
    throw new Error('connect ECONNREFUSED 203.0.113.1:443');
  });

  const response = await worker.fetch(new Request(PAGE), env);

  assert.equal(response.status, 502);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  const html = await response.text();
  assert.match(html, /The invoice could not be loaded just now\./);
  assert.match(html, /Nothing has changed\./);
  assert.doesNotMatch(html, /ECONNREFUSED/, 'the worker\'s reason stays in the log');
});

test('the worker carries no secret, because a page worker is public code', () => {
  const source = fs.readFileSync(new URL('../landing/_worker.js', import.meta.url), 'utf8');
  for (const name of ['SERVICE_ROLE', 'MIDTRANS_SERVER_KEY', 'BILLING_TOKEN', 'BILLING_SECRET', 'Bearer ', 'eyJ']) {
    assert.ok(!source.includes(name), `the worker must not name ${name}`);
  }
});
