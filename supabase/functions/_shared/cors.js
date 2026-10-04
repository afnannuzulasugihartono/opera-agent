// @last-edited: 2026-10-04 11:10 UTC.
// @title: cors — Repository file.
// @context: Deno edge function.
// @state: drop unknown-rule lint-ignore in cors helper (2.9.6 gate).
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: none.

const FALLBACK_ORIGINS = Object.freeze([
  'chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick',
  'https://oauth-consent-three.vercel.app'
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
