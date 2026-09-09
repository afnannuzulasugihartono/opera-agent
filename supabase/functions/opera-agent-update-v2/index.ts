import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const BASE = "https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update-v2";

function response(body: BodyInit | null, status: number, headers: Record<string,string>) {
  return new Response(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
      ...headers
    }
  });
}

function bytesFromBase64(value: string) {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function activeRelease() {
  const { data, error } = await supabase
    .from("opera_v2_releases")
    .select("version, extension_id, crx_base64, sha256, size_bytes")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function logUpdateEvent(kind: "update_xml" | "crx", req: Request, release: any, url: URL) {
  const userAgent = req.headers.get("user-agent");
  const accept = req.headers.get("accept");
  const { error } = await supabase.from("opera_update_events").insert({
    request_kind: kind,
    method: req.method,
    path: url.pathname.slice(0, 1000),
    query_string: url.search.slice(0, 2000),
    served_version: release.version,
    release_sha256: release.sha256,
    user_agent: userAgent ? userAgent.slice(0, 512) : null,
    accept_header: accept ? accept.slice(0, 512) : null
  });
  if (error) console.warn("opera-agent-update-v2 telemetry", error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return response("Method Not Allowed", 405, { "Allow": "GET, HEAD" });
  }

  try {
    const release = await activeRelease();
    if (!release) return response("No active Opera Agent v2 release", 503, { "Content-Type": "text/plain; charset=utf-8" });

    const url = new URL(req.url);
    const path = url.pathname;

    if (path.endsWith("/update.xml")) {
      await logUpdateEvent("update_xml", req, release, url);
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n  <app appid="${release.extension_id}">\n    <updatecheck codebase="${BASE}/opera-agent-${release.version}.crx" version="${release.version}" />\n  </app>\n</gupdate>\n`;
      return response(req.method === "HEAD" ? null : xml, 200, {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "no-store, max-age=0"
      });
    }

    if (path.endsWith(`/opera-agent-${release.version}.crx`)) {
      await logUpdateEvent("crx", req, release, url);
      const bytes = bytesFromBase64(release.crx_base64);
      return response(req.method === "HEAD" ? null : bytes, 200, {
        "Content-Type": "application/x-chrome-extension",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
        "ETag": `"${release.sha256}"`
      });
    }

    if (path.endsWith("/health") || path.endsWith("/opera-agent-update-v2") || path.endsWith("/")) {
      const body = JSON.stringify({
        ok: true,
        product: "Opera Agent",
        channel: "v2",
        version: release.version,
        protocolVersion: 2,
        extensionId: release.extension_id,
        sha256: release.sha256,
        sizeBytes: release.size_bytes,
        passiveUpdateTelemetry: true
      });
      return response(req.method === "HEAD" ? null : body, 200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
    }

    return response("Not Found", 404, { "Content-Type": "text/plain; charset=utf-8" });
  } catch (error) {
    console.error("opera-agent-update-v2", error instanceof Error ? error.message : String(error));
    return response("Update service error", 500, { "Content-Type": "text/plain; charset=utf-8" });
  }
});
