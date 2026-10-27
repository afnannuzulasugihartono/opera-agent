// @last-edited: 2026-10-26 UTC+7.
// @title: _worker — serves the invoice page from the product's own domain, because the function's domain refuses HTML.
// @state: proxies /invoice to the billing function with its query and body, relabels the page, and rewrites the refresh redirect back to /invoice; every other path is the asset server's.
// @dependencies: the deployed opera-agent-billing function, env.ASSETS.

// WHY THIS FILE EXISTS.
// Measured live on 2026-10-26: Supabase's shared function domain answered the function's HTML with Content-Type text/plain and content-security-policy default-src 'none'; sandbox.
// The browser showed the page as source and the refresh form could not be submitted, so a customer holding a real invoice had no way to pay it.
// The gateway does that on purpose on a domain shared by every project, so the page is served from the product's own domain and the function stays the only thing that knows the invoice.

// WHY THE WORKER IS THE WHOLE SITE ONCE IT EXISTS.
// A Pages project has one _worker.js, and every request passes through it.
// So this worker owns /invoice and hands every other request to the asset server unchanged: the site is one directory, and the page is one path in it.

// WHY THE PAGE'S HEADERS ARE SET HERE AND NOT READ FROM THE FUNCTION.
// The function sets them, and the gateway keeps the policy but replaces the content type with text/plain.
// A page that carries a token must not be cached, must not leak the link as a referrer, and must not be framed or indexed, so the worker states all of it on the answer the browser actually receives.

const FUNCTION_URL = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-billing';
const PAGE_PATH = '/invoice';
const PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const PAGE_HEADERS = Object.freeze({
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'x-robots-tag': 'noindex, nofollow',
  'content-security-policy': PAGE_POLICY
});

// WHY ONLY TWO HEADERS CROSS TO THE FUNCTION.
// The page link is a capability in the query string, and the function needs the method, the query, the body and its type to answer.
// A browser's cookies and origin headers belong to the site, not to this invoice, and forwarding them would hand the function a session it has no use for.

async function askFunction(request) {
  const target = new URL(FUNCTION_URL);
  target.search = new URL(request.url).search;
  const headers = new Headers();
  for (const name of ['accept', 'content-type']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
  return fetch(target.toString(), init);
}

// WHY A REDIRECT IS REWRITTEN INSTEAD OF FOLLOWED.
// The refresh form posts here, and the function answers 303 to the address it knows: its own path.
// Following that answer would leave the browser at the old address with a 200, so a reload would post the form again.
// Rewriting the Location keeps the address and the method honest, and only the function's own answer is rewritten, so another host cannot be turned into a link on the product's domain.

// WHY THE PATH THE FUNCTION SEES IS NOT THE PATH IN THIS FILE.
// Measured live on 2026-10-26: the same function answered a redirect to /opera-agent-billing, not to /functions/v1/opera-agent-billing, because the gateway strips the prefix before the function reads its own URL.
// So the rule is the shape of the answer, not a path this file guessed: a root-relative Location belongs to the function, and an absolute one is rewritten only when its host is the function's.

function pageLocation(location) {
  if (!location) return '';
  let at;
  try {
    at = new URL(location, FUNCTION_URL);
  } catch {
    return '';
  }
  const fn = new URL(FUNCTION_URL);
  const ours = location.startsWith('/') || at.origin === fn.origin;
  if (!ours) return '';
  return `${PAGE_PATH}${at.search}`;
}

// WHY THE BODY DECIDES WHAT THE PAGE IS, NOT THE CONTENT TYPE.
// The gateway labels every function answer text/plain, so the content type the function sent no longer says what the body is.
// The page starts with a doctype and an error is JSON, so the first characters are the only honest way to tell them apart.

const looksLikePage = (body) => /^\s*(<!doctype html|<html[\s>])/i.test(body);

// WHY A FAILURE IS A PAGE AND NOT A STACK TRACE.
// The customer cannot do anything with the worker's error, and the worker cannot say whether the invoice changed.
// So a failure says only that the page could not be loaded and that nothing has changed, and the reason goes to the Pages log.

function failure() {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invoice</title><style>body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:44rem;margin:1.5rem auto;padding:0 1rem;color:#111}</style></head><body><h1>The invoice could not be loaded just now.</h1><p>Nothing has changed. Try again in a moment.</p></body></html>';
  return new Response(html, { status: 502, headers: PAGE_HEADERS });
}

async function serveInvoice(request) {
  let upstream;
  try {
    upstream = await askFunction(request);
  } catch (error) {
    console.error('INVOICE_PROXY_FAILED', error instanceof Error ? error.message : String(error));
    return failure();
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get('location') || '';
    const headers = new Headers({ 'cache-control': 'no-store' });
    const rewritten = pageLocation(location);
    if (rewritten) headers.set('location', rewritten);
    else if (location) headers.set('location', location);
    return new Response(null, { status: upstream.status, headers });
  }
  const body = await upstream.text();
  const type = upstream.headers.get('content-type') || '';
  if (type.includes('text/html') || looksLikePage(body)) {
    return new Response(body, { status: upstream.status, headers: PAGE_HEADERS });
  }
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': type || 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow'
    }
  });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === PAGE_PATH || path === `${PAGE_PATH}/`) return serveInvoice(request);
    return env.ASSETS.fetch(request);
  }
};
