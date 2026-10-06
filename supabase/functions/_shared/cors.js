// @last-edited: 2026-10-06 02:41 UTC+7.
// @title: cors — Repository file.
// @state: allowlists both extension ids and both site origins during the host move.
// @dependencies: none.

// WHY both extension ids: the CRX signing key produced a new one, so an install
// that has not been replaced yet still presents the old id and would be refused
// if only the new one were listed. WHY both site origins: the Cloudflare host
// is the product's front door and the Vercel one stays while installs in the
// wild still point at it, so neither origin is refused mid-migration.

const FALLBACK_ORIGINS = Object.freeze([
  'chrome-extension://ofgemipoobcnbjkfanmofjbdonjapmgl',
  'chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick',
  'https://opera-agent.pages.dev',
  'https://opera-agent.vercel.app'
]);

export const CORS_DEFAULT_ORIGINS = FALLBACK_ORIGINS;

export function resolveAllowedOrigin(req, defaults) {
  const list = Array.isArray(defaults) && defaults.length > 0 ? defaults : FALLBACK_ORIGINS;

  // Dual-runtime guard: Deno edge has no `process`, node tests have no `Deno`.
  // Bare `process` read keeps the zero-import contract (the rule's node:process import hint would add an import).
  const raw = typeof Deno !== 'undefined' && Deno.env
    ? Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
    : (typeof process !== 'undefined' && process.env ? process.env.CORS_ALLOWED_ORIGINS || '' : '');
  const configured = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  const allowed = new Set(configured.length > 0 ? configured : list);
  const origin = req && req.headers && typeof req.headers.get === 'function'
    ? String(req.headers.get('origin') || '')
    : '';
  if (!origin) return null;
  return allowed.has(origin) ? origin : null;
}
