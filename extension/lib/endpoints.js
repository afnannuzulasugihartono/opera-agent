// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: endpoints — MV3 runtime library, shared with the Node suite..
// @state: MV3 runtime library, shared with the Node suite..
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
export const UPDATE_BASE_URL = `${SUPABASE_URL}/functions/v1/opera-agent-update`;
export const CONSENT_CONFIG_URL = `${SUPABASE_URL}/functions/v1/opera-agent-auth/config`;
export const SITE_ORIGIN = 'https://opera-agent.vercel.app';
export const CONSENT_URL = `${SITE_ORIGIN}/oauth/consent`;
