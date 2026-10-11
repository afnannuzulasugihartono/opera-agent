// @last-edited: 2026-10-07 UTC+7.
// @title: chatgpt-plugin.test — Test..
// @state: Test..
// @dependencies: node:test, strict, promises.

// The ChatGPT plugin bundle lets any ChatGPT user drive their own paired
// browser through OAuth: the manifest points at the hosted OpenAPI file, and
// the gateway accepts a Supabase user JWT alongside the device token,
// resolving the caller's own device by user_id.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');

test('the plugin bundle exists and names the hosted files', async () => {
  const manifest = JSON.parse(await read('landing/chatgpt-plugin/ai-plugin.json'));
  assert.equal(manifest.schema_version, 'v1');
  assert.equal(manifest.name_for_model, 'opera_agent');
  assert.match(manifest.description_for_model, /read the envelope/i);
  assert.equal(manifest.auth?.type, 'oauth');
  assert.match(manifest.auth?.authorization_url || '', /supabase\.co\/auth\/v1\/authorize/);
  assert.equal(manifest.api?.type, 'openapi');
  assert.equal(manifest.api?.url, 'https://opera-agent.pages.dev/chatgpt-plugin/openapi.json');
  assert.equal(manifest.logo_url, 'https://opera-agent.pages.dev/icon.svg');
  const spec = JSON.parse(await read('landing/chatgpt-plugin/openapi.json'));
  assert.equal(spec.openapi, '3.0.0');
  assert.ok(spec.paths?.['/command']?.post, 'the bundled spec serves /command');
});

test('the gateway accepts a user JWT and resolves the caller device', async () => {
  const source = await read('supabase/functions/opera-agent-gateway/index.ts');

  assert.match(source, /await supabase\.auth\.getUser\(token\)/);
  assert.match(source, /\.from\("opera_devices"\)/);
  assert.match(source, /\.eq\("user_id", userId\)/);
  assert.match(source, /p_device_name: deviceName,/);
});

test('the plugin logo is the shipped mark', async () => {
  const icon = await read('landing/icon.svg');
  assert.match(icon, /<svg[^>]*viewBox='0 0 16 16'/);
});
