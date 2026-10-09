// @last-edited: 2026-10-09 UTC+7.
// @title: external-origins — the origin allowlist for chrome.runtime.onMessageExternal.
// @state: exports EXTERNAL_CONFIG_ORIGINS and originAllowed; the site origin matches exactly, localhost matches by port prefix.
// @dependencies: endpoints.

// The origins allowed to push model config into the extension through
// chrome.runtime.onMessageExternal (applyModelConfig). The official site is the
// owner's own page; localhost stays for local development.

import { SITE_ORIGIN } from './endpoints.js';

export const EXTERNAL_CONFIG_ORIGINS = Object.freeze(['http://localhost:', 'https://localhost:', SITE_ORIGIN]);

// WHY exact match for the site origin: sender.origin for an https page is the
// bare origin, so a plain startsWith would also admit evil subdomains like
// https://opera-agent.pages.dev.evil.com. Entries ending in ':' keep the
// dynamic-port prefix match; every other entry must match exactly or be
// followed by '/'.

export function originAllowed(from) {
  const value = String(from || '');
  return EXTERNAL_CONFIG_ORIGINS.some((origin) => (
    origin.endsWith(':') ? value.startsWith(origin) : value === origin || value.startsWith(`${origin}/`)
  ));
}
