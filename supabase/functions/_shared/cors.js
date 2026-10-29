// @last-edited: 2026-10-21 UTC+7.
// @title: cors — the one resolver every edge function asks which origin it may answer.
// @state: the allowlist of extension ids and site origins, and the fail-closed answer for anything else.
// @dependencies: none.

// WHY both extension ids: the CRX signing key produced a new one, so an install that has not been replaced yet still presents the old id and would be refused if only the new one were listed.
// WHY both site origins: the Cloudflare host is the product's front door and the Vercel one stays while installs in the wild still point at it, so neither origin is refused mid-migration.

const FALLBACK_ORIGINS = Object.freeze([
  'chrome-extension://ofgemipoobcnbjkfanmofjbdonjapmgl',
  'chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick',
  'https://opera-agent.pages.dev',
  'https://opera-agent.vercel.app'
]);

export const CORS_DEFAULT_ORIGINS = FALLBACK_ORIGINS;

export function resolveAllowedOrigin(
  req,
  defaults
) {
  const list = Array.isArray(defaults) && defaults.length > 0 ? defaults : FALLBACK_ORIGINS;

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
