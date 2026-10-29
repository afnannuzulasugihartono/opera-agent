// @last-edited: 2026-10-21 UTC+7.
// @title: opera-agent-auth — the OAuth configuration the site and the extension read.
// @state: the public config the consent page needs, and the CORS answer every edge function gives.
// @dependencies: edge-runtime.

import "@supabase/edge-runtime";
import {
  CORS_DEFAULT_ORIGINS,
  resolveAllowedOrigin
} from "../_shared/cors.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff"
};

function withCors(req: Request, res: Response): Response {
  const origin = resolveAllowedOrigin(req, CORS_DEFAULT_ORIGINS);
  const out = new Headers(res.headers);
  if (origin === null) out.delete("Access-Control-Allow-Origin");
  else out.set("Access-Control-Allow-Origin", origin);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: out
  });
}

function handle(req: Request) {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: {
        ...headers,
        Allow: "GET"
      }
    });
  }

  const path = new URL(req.url).pathname;
  if (path.endsWith("/config")) {
    return new Response(JSON.stringify({
      url: SUPABASE_URL,
      key: ANON_KEY
    }), { headers });
  }

  return new Response(JSON.stringify({
    ok: true,
    service: "opera-agent-auth-config",
    consentUrl: "https://opera-agent.pages.dev/oauth/consent"
  }), { headers: {
    ...headers,
    "Cache-Control": "no-store"
  } });
}

Deno.serve((req: Request) => withCors(req, handle(req)));
