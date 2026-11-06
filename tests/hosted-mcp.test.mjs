// @last-edited: 2026-11-06 UTC+7.
// @title: hosted-mcp — what the hosted MCP surface answers a client that has no token.
// @state: the recorded discovery document, the 401, and the challenge that names where the token comes from.
// @dependencies: node:test, strict, node:fs, node:url.

// WHY THE RECORD EXISTS.
// The hosted server is the surface a reader is told to point a client at.
// A record of what it answers without a token says whether the OAuth path is live, and it says it without holding a credential.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const record = JSON.parse(fs.readFileSync(new URL('../proof/hosted-mcp.json', import.meta.url), 'utf8'));

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
