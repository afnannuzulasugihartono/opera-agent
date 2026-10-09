// @last-edited: 2026-10-06 02:41 UTC+7.
// @title: endpoints — the single source of deployment endpoint truth for the deploy unit.
// @state: the Supabase project ref, the function URLs derived from it, and the Cloudflare Pages site origin; tests/endpoint-source.test.mjs asserts the derivation.
// @dependencies: none.

// Single source of deployment endpoint truth for the extension deploy
// unit. The OAuth consent screen is a page of the site rather than its own
// deployment, so the site origin below is its only literal, locked equal by
// tests/endpoint-source.test.mjs. manifest.json update_url is static by
// platform rule (documented exception), as are applied migrations (never
// rewritten), release.yml, and historical docs.

export const SUPABASE_PROJECT_REF = 'nenmkmtvjremqphfqnfw';
const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
export const DEFAULT_BRIDGE_URL = `${SUPABASE_URL}/functions/v1/opera-agent-bridge`;
export const LISTEN_BASE_URL = `${SUPABASE_URL}/functions/v1/opera-agent-listen`;
export const UPDATE_BASE_URL = `${SUPABASE_URL}/functions/v1/opera-agent-update`;
export const CONSENT_CONFIG_URL = `${SUPABASE_URL}/functions/v1/opera-agent-auth/config`;
// WHY Cloudflare is the origin: Vercel Hobby allows a hundred deployments a day
// and a busy main spends that on its own, so the site moved to Cloudflare Pages.
// The consent screen is a page of the site, so it has to be this same origin or
// GoTrue refuses every approval call made from it.
export const SITE_ORIGIN = 'https://opera-agent.pages.dev';
export const CONSENT_URL = `${SITE_ORIGIN}/oauth/consent`;
