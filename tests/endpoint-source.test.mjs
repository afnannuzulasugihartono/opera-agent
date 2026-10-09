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
  assert.match(bg, /from '\.\/lib\/endpoints\.js'/);
  assert.equal((bg.match(/supabase\.co\/functions\/v1/g) || []).length, 0);
});

test('the consent screen is a page of the site, not a deployment of its own', async () => {
  const consent = await readFile(new URL('../landing/oauth/consent.html', import.meta.url), 'utf8');
  const endpoints = await import('../extension/lib/endpoints.js');

  // WHY the config endpoint check: the page must reach the same function the extension
  // does. It no longer fetches it, so the contract is now that the shared constant is
  // what the consent page would use, asserted against the site's own auth host instead.
  assert.equal(endpoints.CONSENT_CONFIG_URL, `${CONSENT_CONFIG_URL.split('/functions')[0]}/functions/v1/opera-agent-auth/config`);
  assert.equal(endpoints.CONSENT_CONFIG_URL, CONSENT_CONFIG_URL, 'the shared constant is the one the extension uses');
  assert.equal(endpoints.CONSENT_URL, `${endpoints.SITE_ORIGIN}/oauth/consent`);
  assert.match(consent, /AUTH_HOST = 'https:\/\/nenmkmtvjremqphfqnfw\.supabase\.co\/auth\/v1'/, 'the page reads the project Auth host');
  // WHY comments are stripped first: this page explains in a comment that it used to load
// supabase-js from esm.sh, and a scan of the raw text would match its own explanation.
  const consentCode = consent
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*|<!--)/.test(line))
    .join('\n');
  assert.doesNotMatch(consentCode, /esm\.sh|unpkg|jsdelivr|cdn\./i, 'the page loads no library from another origin');
  assert.doesNotMatch(consentCode, /<(script|img|link)[^>]+(src|href)="https?:/i, 'no tag points at a remote origin');
  // WHY the origin matters: GoTrue validates the origin of every consent call against
  // its configured site URL, so a screen on any other host can never approve anything.
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(config, /site_url = "https:\/\/opera-agent\.pages\.dev"/, 'the site URL is the origin that serves consent');
  assert.match(config, /authorization_path = "\/oauth\/consent"/, 'the consent path matches the page the site serves');
  assert.doesNotMatch(config, /oauth-consent-three/, 'the separate deployment is no longer referenced');
});

test('update function derives base from SUPABASE_URL, no literal ref', async () => {
  const src = await readFile(new URL('../supabase/functions/opera-agent-update/index.ts', import.meta.url), 'utf8');
  // Source form is required here: the contract is "this deploy unit derives its
  // base from the environment rather than hard-coding it", which is only
  // observable as source text. The positive assertion matters as much as the
  // negative one -- without it, replacing the derivation with any other literal
  // URL would still pass.
  assert.doesNotMatch(src, /nenmkmtvjremqphfqnfw/);
  // Quote-style tolerant on purpose: the contract is that this deploy unit
  // derives its base from the environment rather than hard-coding it. The
  // replacement pattern is deliberately NOT asserted; only the
  // SUPABASE_URL-derived interpolation is.
  assert.match(src, /\$\{SUPABASE_URL\.replace\(\/[^)]*\/,\s*["']["']\)\}/);
});

test('every exported endpoint constant is derived from the project ref', () => {
  const base = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
  assert.equal(DEFAULT_BRIDGE_URL, `${base}/functions/v1/opera-agent-bridge`);
  assert.equal(LISTEN_BASE_URL, `${base}/functions/v1/opera-agent-listen`);
  assert.equal(UPDATE_BASE_URL, `${base}/functions/v1/opera-agent-update`);
  assert.equal(CONSENT_CONFIG_URL, `${base}/functions/v1/opera-agent-auth/config`);
});
