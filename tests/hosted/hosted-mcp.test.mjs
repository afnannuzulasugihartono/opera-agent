// @last-edited: 2026-11-06 UTC+7.
// @title: hosted-mcp — what the hosted MCP surface answers a client that has no token, and what its checker refuses to keep.
// @state: the recorded discovery document, the 401, the challenge that names where the token comes from, the authorize probe for the pinned client, and the token scrub.
// @dependencies: node:test, strict, node:http, node:fs, node:url, ../scripts/verify/hosted-mcp-check.mjs.

// WHY THE RECORD EXISTS.
// The hosted server is the surface a reader is told to point a client at.
// A record of what it answers without a token says whether the OAuth path is live, and it says it without holding a credential.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';

import { OAUTH_CLIENT_ID, OAUTH_REDIRECT_URI, checkHostedMcp, scrubbed } from '../../scripts/verify/hosted-mcp-check.mjs';

// WHY A JWT-SHAPED STRING IS BUILT, NOT WRITTEN.
// The scrub has to be tested against the shape of a real credential, and the tree scans itself with gitleaks, which reads a whole literal as one.
// Assembling the shape at runtime keeps the test honest and the tree clean; the payload is invented and matches no real token.

const jwtShaped = (head, body, signature) => `${head}.${body}.${signature}`;

const FAKE_JWT = jwtShaped('eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJwcm9vZiJ9', 'c3NpZ25hdHVyZQ');
const FAKE_JWT_HS = jwtShaped('eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJwcm9vZiJ9', 'c3NpZ25hdHVyZQ');

const record = JSON.parse(fs.readFileSync(new URL('../../docs/proof/hosted-mcp.json', import.meta.url), 'utf8'));

test('the hosted MCP surface answers a client that has no token', () => {
  assert.equal(record.discovery.status, 200);
  assert.equal(record.discovery.authorization_servers.length, 1);
  assert.equal(record.initialize.status, 401);
  assert.ok(record.initialize.wwwAuthenticate.includes('resource_metadata'));
  assert.ok(!JSON.stringify(record).includes('eyJ'), 'no token may be recorded');
});

test('the record names the server it asked', () => {
  assert.match(record.url, /opera-agent-mcp$/);
  assert.ok(record.discovery.resource.includes('opera-agent-mcp'), 'the discovery document names the resource');
  assert.ok(record.checkedAt, 'the record says when it was taken');
});

// WHY THE GUIDE'S CLIENT ID IS PINNED TO THE SCRIPT'S CONSTANT.
// The guide tells a reader which client to use; the constant is what the probe asks about.
// If the two ever differ, the guide names a client nobody checked.

test('the guide names the client the probe asks about', () => {
  const guide = fs.readFileSync(new URL('../../docs/agent-call.md', import.meta.url), 'utf8');
  assert.ok(guide.includes(OAUTH_CLIENT_ID), 'the guide pins the registered client id');
  assert.ok(guide.includes(OAUTH_REDIRECT_URI), 'the guide names the one redirect the client accepts');
});

// WHY THE AUTHORIZE PROBE IS IN THE RECORD.
// The guide pins one OAuth client id and one redirect; the register answer proves nothing about them.
// One probe with the pinned pair, recorded, is what makes the guide's claim checkable without an account.

test('the record proves the pinned OAuth client is still accepted', () => {
  assert.ok(record.authorize, 'the record carries the authorize probe');
  assert.equal(record.authorize.status, 302, 'the authorization server sends the client to the consent page');
  assert.equal(record.authorize.consentPath, '/oauth/consent', 'and the consent page is the one the site serves');
  assert.equal(record.authorize.clientId, 'bbc5eb76-f385-435b-8b13-8e339b45e633');
  assert.equal(record.authorize.redirectUri, 'http://127.0.0.1:19876/mcp/oauth/callback');
  assert.deepEqual(Object.keys(record.authorize).sort(), ['clientId', 'consentPath', 'redirectUri', 'status'], 'the probe keeps four fields');
  assert.ok(!JSON.stringify(record.authorize).includes('authorization_id'), 'the one-shot consent request id is not recorded');
});

// WHY A TOKEN-SHAPED STRING IS REFUSED BY THE CHECKER ITSELF.
// A server that ever echoes a credential into an error body would be written into the tree by the very script that promised not to record one.
// The probe keeps only status and error fields, and any token-shaped substring is replaced before it can reach the file.

// WHY THE DISCOVERY DOCUMENT IS SCRUBBED TOO.
// The claim is that no token-shaped string reaches the tree, and a discovery document is an answer like any other.
// The authorize path is asserted here rather than left to the live snapshot, because the mapping from a 302 to a consent path is the part the live run alone could not repeat.

test('the checker records only status and error fields, and never a token', async () => {
  const seen = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1:0');
    seen.push({ method: request.method, path: url.pathname });
    if (url.pathname.endsWith('/.well-known/oauth-protected-resource')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        resource: `${origin}/mcp`,
        authorization_servers: [`${origin}/auth`],
        bearer_methods_supported: ['header'],
        scopes_supported: ['openid'],
        leaked_token: FAKE_JWT
      }));
      return;
    }
    if (url.pathname === '/auth/oauth/authorize') {
      seen.push({ method: request.method, authorize: url.search });
      response.writeHead(302, { location: 'https://example.test/oauth/consent?authorization_id=onseshot' });
      response.end();
      return;
    }
    if (url.pathname === '/mcp') {
      response.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer resource_metadata="http://127.0.0.1:0/.well-known/oauth-protected-resource"'
      });
      response.end(JSON.stringify({
        error: 'unauthorized',
        error_description: `token ${FAKE_JWT_HS} is not a valid access token`,
        session_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  try {
    const answer = await checkHostedMcp({ base: `${origin}/mcp`, authority: `${origin}/auth` });
    assert.equal(answer.initialize.status, 401);
    assert.equal(answer.initialize.body.error, 'unauthorized');
    assert.ok(answer.initialize.body.error_description.includes('[redacted]'), 'a token-shaped string in an error body is redacted');
    assert.equal(answer.initialize.body.session_id, undefined, 'a field the record does not keep never reaches it');
    assert.equal(answer.discovery.leaked_token, undefined, 'an unexpected response field is dropped');
    assert.equal(answer.authorize.status, 302);
    assert.equal(answer.authorize.consentPath, '/oauth/consent');
    assert.ok(seen.some((entry) => entry.authorize?.includes('client_id=bbc5')), 'the probe asks about the pinned client');
    assert.ok(!JSON.stringify(answer).includes('eyJ'), 'no token-shaped string survives into the record');
    assert.ok(seen.some((entry) => entry.path.endsWith('/.well-known/oauth-protected-resource')), 'the resource document is asked first');
  } finally {
    server.close();
  }
});

test('a token-shaped string is replaced wherever it appears', () => {
  assert.equal(scrubbed(`token ${FAKE_JWT_HS}`), 'token [redacted]');
  assert.equal(scrubbed('refresh sb_1234567890abcdefghijklmnopqrst'), 'refresh [redacted]');
  assert.equal(scrubbed('plain words and https://example.test/path'), 'plain words and https://example.test/path');
});
