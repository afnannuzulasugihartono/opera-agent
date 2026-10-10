// @last-edited: 2026-10-06 02:41 UTC+7.
// @title: index — Repository file.
// @state: edge-runtime imports via deno.json import maps, restore SBOM gate.
// @dependencies: edge-runtime.

import "@supabase/edge-runtime";
import { CORS_DEFAULT_ORIGINS, resolveAllowedOrigin } from "../_shared/cors.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

// WHY the wildcard is gone: this answered Access-Control-Allow-Origin: "*", so any
// page could read it. The allowlist is the one the gateway and the MCP function
// already use, and it covers both extension ids and both site origins.
//
// WHY the cache directive is no-store rather than public, max-age=300: the body is
// the project's public URL and anon key. Neither is a secret -- the anon key is
// designed to be public and ships in the site pages, and RLS is the boundary --
// but "public" told every shared cache along the path to keep a copy keyed by
// nothing at all, which turns a config read into a durable oracle for whatever the
// anon role can reach if that is ever widened. no-store keeps the read honest.

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff"
};

// WHY applied per request: the decision depends on the caller's Origin, so it
// cannot live in the const above.

function withCors(req: Request, res: Response): Response {
  const origin = resolveAllowedOrigin(req, CORS_DEFAULT_ORIGINS);
  const out = new Headers(res.headers);
  if (origin === null) out.delete("Access-Control-Allow-Origin");
  else out.set("Access-Control-Allow-Origin", origin);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}

function handle(req: Request) {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...headers, Allow: "GET" }
    });
  }

  const path = new URL(req.url).pathname;
  if (path.endsWith("/config")) {
    return new Response(JSON.stringify({ url: SUPABASE_URL, key: ANON_KEY }), { headers });
  }

  return new Response(JSON.stringify({
    ok: true,
    service: "opera-agent-auth-config",
    consentUrl: "https://opera-agent.pages.dev/oauth/consent"
  }), { headers: { ...headers, "Cache-Control": "no-store" } });
}

Deno.serve((req: Request) => withCors(req, handle(req)));
