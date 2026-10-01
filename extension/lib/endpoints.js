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
