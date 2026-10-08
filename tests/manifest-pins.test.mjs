// @last-edited: 2026-10-08 UTC+7.
// @title: manifest-pins.test — Test.
// @state: locks the extension CSP shape the compiler needs.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const csp = manifest.content_security_policy.extension_pages;

test('the worker may reach the owner https endpoint and loopback, Supabase stays named', () => {
  assert.match(csp, /(^| )https:( |$|;)/);
  assert.match(csp, /http:\/\/127\.0\.0\.1:\*/);
  assert.match(csp, /https:\/\/\*\.supabase\.co/);
});
