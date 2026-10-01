import test from 'node:test';
import assert from 'node:assert/strict';
import { CORS_DEFAULT_ORIGINS, resolveAllowedOrigin } from '../supabase/functions/_shared/cors.js';

const req = (origin) => ({ headers: { get: (name) => (name.toLowerCase() === 'origin' ? origin : null) } });

test('default origins are exactly the extension and consent page', () => {
  assert.deepEqual(CORS_DEFAULT_ORIGINS, [
    'chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick',
    'https://oauth-consent-three.vercel.app'
  ]);
});

test('exact allowlisted origin is echoed', () => {
  assert.equal(resolveAllowedOrigin(req('chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick')), 'chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick');
});

test('lookalike evil origin is rejected', () => {
  assert.equal(resolveAllowedOrigin(req('https://oauth-consent-three.vercel.app.evil.com')), null);
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
