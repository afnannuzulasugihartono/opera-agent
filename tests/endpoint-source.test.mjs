// @last-edited: 2026-10-06 02:41 UTC+7.
// @title: endpoint-source.test — source.test — Test.
// @state: activate the options tab before waiting on its async prefill.
// @dependencies: node:test, strict, promises, endpoints, extension-source.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extensionSource } from './helpers/extension-source.mjs';
import { CONSENT_CONFIG_URL, DEFAULT_BRIDGE_URL, LISTEN_BASE_URL, SUPABASE_PROJECT_REF, UPDATE_BASE_URL } from '../extension/lib/endpoints.js';

test('extension background has exactly one endpoint source', async () => {
  const bg = await extensionSource();
  assert.match(bg, /\.{1,2}\/lib\/endpoints\.js/);
  assert.equal((bg.match(/supabase\.co\/functions\/v1/g) || []).length, 0);
});

test('the consent screen is a page of the site, not a deployment of its own', async () => {
  const consent = await readFile(new URL('../landing/oauth/consent.html', import.meta.url), 'utf8');
  const endpoints = await import('../extension/lib/endpoints.js');

  assert.equal(endpoints.CONSENT_CONFIG_URL, `${CONSENT_CONFIG_URL.split('/functions')[0]}/functions/v1/opera-agent-auth/config`);
  assert.equal(endpoints.CONSENT_CONFIG_URL, CONSENT_CONFIG_URL, 'the shared constant is the one the extension uses');
  assert.match(consent, /AUTH_HOST = 'https:\/\/nenmkmtvjremqphfqnfw\.supabase\.co\/auth\/v1'/, 'the page reads the project Auth host');

  const consentCode = consent
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*|<!--)/.test(line))
    .join('\n');
  assert.doesNotMatch(consentCode, /esm\.sh|unpkg|jsdelivr|cdn\./i, 'the page loads no library from another origin');
  assert.doesNotMatch(consentCode, /<(script|img|link)[^>]+(src|href)="https?:/i, 'no tag points at a remote origin');

  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const siteUrl = /site_url\s*=\s*"([^"]+)"/.exec(config)?.[1];
  assert.equal(endpoints.SITE_ORIGIN, siteUrl, 'the extension names the same site origin the platform is configured with');
  assert.match(config, /authorization_path = "\/oauth\/consent"/, 'the consent path matches the page the site serves');
  assert.doesNotMatch(config, /oauth-consent-three/, 'the separate deployment is no longer referenced');
});

test('update function derives base from SUPABASE_URL, no literal ref', async () => {
  const src = await readFile(new URL('../supabase/functions/opera-agent-update/index.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(src, /nenmkmtvjremqphfqnfw/);

  assert.match(src, /\$\{SUPABASE_URL\.replace\(\/[^)]*\/,\s*["']["']\)\}/);
});

test('every exported endpoint constant is derived from the project ref', () => {
  const base = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
  assert.equal(DEFAULT_BRIDGE_URL, `${base}/functions/v1/opera-agent-bridge`);
  assert.equal(LISTEN_BASE_URL, `${base}/functions/v1/opera-agent-listen`);
  assert.equal(UPDATE_BASE_URL, `${base}/functions/v1/opera-agent-update`);
  assert.equal(CONSENT_CONFIG_URL, `${base}/functions/v1/opera-agent-auth/config`);
});
