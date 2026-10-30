// @last-edited: 2026-10-13 UTC+7.
// @title: endpoints — the single source of deployment endpoint truth for the deploy unit.
// @state: the Supabase project ref, the function URLs derived from it, and the Cloudflare Pages site origin; tests/endpoint-source.test.mjs asserts the derivation.
// @dependencies: none.

// Single source of deployment endpoint truth for the extension deploy unit.
// The OAuth consent screen is a page of the site rather than its own deployment, so the site origin below is its only literal, locked equal by tests/endpoint-source.test.mjs.
// manifest.json update_url is static by platform rule (documented exception), as are applied migrations (never rewritten), release.yml, and historical docs.

export const SUPABASE_PROJECT_REF = 'nenmkmtvjremqphfqnfw';
const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
export const DEFAULT_BRIDGE_URL = `${SUPABASE_URL}/functions/v1/opera-agent-bridge`;
export const LISTEN_BASE_URL = `${SUPABASE_URL}/functions/v1/opera-agent-listen`;
export const UPDATE_BASE_URL = `${SUPABASE_URL}/functions/v1/opera-agent-update`;
export const CONSENT_CONFIG_URL = `${SUPABASE_URL}/functions/v1/opera-agent-auth/config`;

// WHY every cloud call is pinned to Singapore.
// Edge functions run closest to the requester, and from this machine that is Tokyo while the database sits in Singapore — measured live as DENO_REGION ap-northeast-1 against a db host in ap-southeast-1.
// Every database crossing then pays Tokyo-Singapore instead of rack-local, several times per command.
// The pin rides a header on HTTPS and a query parameter on sockets, where no header can be set; any gateway that does not understand it ignores it.

const EDGE_REGION = 'ap-southeast-1';

/**
 * Convert a bridge HTTP(S) URL into the WebSocket URL that carries the same region pin.
 * @param {string} bridgeUrl The bridge URL, http(s) or ws(s), possibly empty.
 * @returns {string} The ws(s) URL with forceFunctionRegion appended, or '' when empty.
 */

export function socketUrl(bridgeUrl) {
  const raw = String(bridgeUrl || '').trim();
  if (!raw) return '';
  const convert = raw.startsWith('wss://')
    ? raw
    : raw.startsWith('https://')
      ? `wss://${raw.slice('https://'.length)}`
      : raw.startsWith('http://')
        ? `ws://${raw.slice('http://'.length)}`
        : raw;
  const separator = convert.includes('?') ? '&' : '?';
  return `${convert}${separator}forceFunctionRegion=${EDGE_REGION}`;
}

export const SITE_ORIGIN = 'https://opera-agent.pages.dev';
