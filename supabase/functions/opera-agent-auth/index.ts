// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: index — Repository file.
// @state: edge-runtime imports via deno.json import maps, restore SBOM gate.
// @dependencies: edge-runtime.

import "@supabase/edge-runtime";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff"
};

Deno.serve((req: Request) => {
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
    consentUrl: "https://oauth-consent-three.vercel.app/oauth/consent"
  }), { headers: { ...headers, "Cache-Control": "no-store" } });
});
