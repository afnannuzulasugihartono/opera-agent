// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: endpoints — MV3 runtime library, shared with the Node suite..
// @context: MV3 runtime library, shared with the Node suite.
// @state: MV3 runtime library, shared with the Node suite..
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: none.

// Single source of deployment endpoint truth for the extension deploy
// unit. oauth-consent/ deploys separately and keeps its own literal,
// locked equal by tests/endpoint-source.test.mjs. manifest.json
// update_url is static by platform rule (documented exception), as are
// applied migrations (never rewritten), release.yml, and historical docs.
export const SUPABASE_PROJECT_REF = 'nenmkmtvjremqphfqnfw';
const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
export const DEFAULT_BRIDGE_URL = `${SUPABASE_URL}/functions/v1/opera-agent-bridge`;
export const UPDATE_BASE_URL = `${SUPABASE_URL}/functions/v1/opera-agent-update`;
export const CONSENT_CONFIG_URL = `${SUPABASE_URL}/functions/v1/opera-agent-auth/config`;
