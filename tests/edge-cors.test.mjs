// @last-edited: 2026-10-06 02:41 UTC+7.
// @title: edge-cors.test — cors.test — Test.
// @state: shared CORS origin resolver with fail-closed defaults, and every edge function locked to it.
// @dependencies: node:test, strict, fs, module, vm, cors.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { CORS_DEFAULT_ORIGINS, resolveAllowedOrigin } from '../supabase/functions/_shared/cors.js';

const req = (origin) => ({ headers: { get: (name) => (name.toLowerCase() === 'origin' ? origin : null) } });

test('default origins are exactly the extension and the site', () => {
  // WHY the site and not a separate consent deployment: the consent screen is a page of
  // the site now, so the origin that may call the backend is the site's own origin.
  //
  // WHY two extension ids: the signing key produced a new one, and an install that
  // has not been replaced still presents the old id. WHY two site origins: Cloudflare
  // is the front door and Vercel stays reachable as the backup host.
  assert.deepEqual(CORS_DEFAULT_ORIGINS, [
    'chrome-extension://ofgemipoobcnbjkfanmofjbdonjapmgl',
    'chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick',
    'https://opera-agent.pages.dev',
    'https://opera-agent.vercel.app'
  ]);
});

test('exact allowlisted origin is echoed', () => {
  assert.equal(resolveAllowedOrigin(req('chrome-extension://ofgemipoobcnbjkfanmofjbdonjapmgl')), 'chrome-extension://ofgemipoobcnbjkfanmofjbdonjapmgl');
  assert.equal(resolveAllowedOrigin(req('https://opera-agent.pages.dev')), 'https://opera-agent.pages.dev');
});

test('lookalike evil origin is rejected', () => {
  assert.equal(resolveAllowedOrigin(req('https://opera-agent.pages.dev.evil.com')), null);
  assert.equal(resolveAllowedOrigin(req('https://opera-agent.vercel.app.evil.com')), null);
  assert.equal(resolveAllowedOrigin(req('https://evil.com')), null);
});

test('missing origin proceeds without ACAO header value', () => {
  assert.equal(resolveAllowedOrigin(req(null)), null);
  assert.equal(resolveAllowedOrigin(req('')), null);
});

test('env list overrides defaults', () => {
  process.env.CORS_ALLOWED_ORIGINS = 'https://a.example, https://b.example ';
  assert.equal(resolveAllowedOrigin(req('https://b.example')), 'https://b.example');
  assert.equal(resolveAllowedOrigin(req('chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick')), null);
  delete process.env.CORS_ALLOWED_ORIGINS;
});

// WHY this lock exists: six functions answered Access-Control-Allow-Origin: "*"
// while the other three used the resolver above, so the project carried two
// contradictory CORS policies and only the resolver's was tested. The helper can
// stay perfect while a function beside it ignores it, and the unit tests above
// would never notice — so every function is checked for the wildcard here.

const EDGE_FUNCTIONS = [
  'opera-agent-auth',
  'opera-agent-bridge',
  'opera-agent-ledger',
  'opera-agent-listen',
  'opera-agent-runner',
  'opera-agent-vm'
];

test('no edge function answers a wildcard origin any more', () => {
  for (const name of EDGE_FUNCTIONS) {
    const source = readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /"Access-Control-Allow-Origin":\s*"\*"/, `${name} must not answer a wildcard origin`);
    assert.match(source, /from "\.\.\/_shared\/cors\.js"/, `${name} must resolve the origin through the shared allowlist`);
    assert.match(source, /resolveAllowedOrigin\(req, CORS_DEFAULT_ORIGINS\)/, `${name} must decide the origin per request`);
  }
});

test('the config endpoint is not a publicly cacheable copy of the anon key', () => {
  // WHY: the anon key is public by design, so the cache directive is not the
  // secret here — it is that "public" lets any shared cache keep a copy keyed by
  // nothing, which outlives the question of whether the body is sensitive today.
  const source = readFileSync(new URL('../supabase/functions/opera-agent-auth/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /"Cache-Control":\s*"public/);
  assert.match(source, /"Cache-Control":\s*"no-store"/);
});

// WHY this is driven rather than read: the source assertions above would pass on a
// withCors that computes the right value and then never applies it, or one that
// always answers "*". The bridge is loaded and run, and the header is read off a
// real response, so the behaviour is measured rather than assumed.

function loadBridge() {
  const source = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/opera-agent-bridge/index.ts', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, ''));
  let handler;
  vm.runInNewContext(source, {
    createClient: () => ({ async rpc() { return { data: { ok: false } }; } }),
    createEdgeLog: () => ({ error() {} }),
    CORS_DEFAULT_ORIGINS, resolveAllowedOrigin,
    Deno: { env: { get: () => 'test' }, serve: (fn) => { handler = fn; } },
    Request, Response, Headers, URL, TextEncoder, TextDecoder, crypto
  });
  return (origin) => handler(new Request('https://example.test/functions/v1/opera-agent-bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: '{"action":"unknown"}'
  }));
}

test('a hostile origin gets no ACAO back, and an allowlisted one is echoed exactly', async () => {
  const call = loadBridge();

  const hostile = await call('https://evil.example');
  assert.equal(hostile.headers.get('access-control-allow-origin'), null,
    'a page on the internet must not be able to read a bridge response');

  const lookalike = await call('https://opera-agent.pages.dev.evil.example');
  assert.equal(lookalike.headers.get('access-control-allow-origin'), null,
    'a lookalike host must not pass as the site');

  const allowed = await call('https://opera-agent.pages.dev');
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://opera-agent.pages.dev');

  const extension = await call('chrome-extension://ofgemipoobcnbjkfanmofjbdonjapmgl');
  assert.equal(extension.headers.get('access-control-allow-origin'), 'chrome-extension://ofgemipoobcnbjkfanmofjbdonjapmgl');

  // A server-to-server caller sends no Origin at all, which is how the MCP
  // function reaches the VM: no header is the correct answer, not a wildcard.
  const none = await call(null);
  assert.equal(none.headers.get('access-control-allow-origin'), null);
});
