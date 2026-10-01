import "@supabase/edge-runtime";
import { createClient } from "@supabase/supabase-js";
import { CORS_DEFAULT_ORIGINS, resolveAllowedOrigin } from "../_shared/cors.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const LEGACY_EXTENSION_ID = "pagjlnohdemoohcncicjmaejedcmcocm";
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

function response(req: Request, body: BodyInit | null, status: number, headers: Record<string,string>) {
  // Fail-closed CORS: echo the origin ONLY for exact allowlist matches
  // (CORS_ALLOWED_ORIGINS env override, else the extension + consent page
  // defaults). A missing or non-allowlisted Origin gets no ACAO header.
  const origin = resolveAllowedOrigin(req, CORS_DEFAULT_ORIGINS);
  return new Response(body, {
    status,
    headers: {
      ...(origin === null ? {} : { "Access-Control-Allow-Origin": origin }),
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

function requestedExtensionId(url: URL) {
  // Chromium update clients send their app metadata inside the `x` query
  // parameter (for example: ?x=id%3D...%26v%3D1.1.0). Supporting `id` too
  // keeps the endpoint easy to diagnose without weakening the ID boundary.
  const nested = new URLSearchParams(url.searchParams.get("x") ?? "");
  const candidate = nested.get("id") ?? url.searchParams.get("id");
  if (candidate === null) return LEGACY_EXTENSION_ID;
  return EXTENSION_ID_PATTERN.test(candidate) ? candidate : null;
}

async function activeRelease(extensionId: string) {
  const { data, error } = await supabase
    .from("opera_releases")
    .select("version, extension_id, crx_base64, sha256")
    .eq("active", true)
    .eq("extension_id", extensionId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function logUpdateEvent(
  requestKind: "update_xml" | "crx",
  req: Request,
  release: { version: string; sha256: string },
  url: URL
) {
  const userAgent = req.headers.get("user-agent");
  const accept = req.headers.get("accept");
  const { error } = await supabase.from("opera_update_events").insert({
    request_kind: requestKind,
    method: req.method,
    path: url.pathname.slice(0, 1000),
    query_string: url.search.slice(0, 2000),
    served_version: release.version,
    release_sha256: release.sha256,
    user_agent: userAgent ? userAgent.slice(0, 512) : null,
    accept_header: accept ? accept.slice(0, 512) : null
  });
  if (error) console.warn("opera-agent-update telemetry", error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return response(req, "Method Not Allowed", 405, { "Allow": "GET, HEAD" });
  }
  try {
    const url = new URL(req.url);
    const path = url.pathname;
    const base = "https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update";
    // CRX downloads do not carry the updater's `x` metadata. Their canonical
    // path embeds the ID, so resolve that request from the path instead.
    const identityCrxMatch = path.match(/\/opera-agent-([a-p]{32})-([0-9]+\.[0-9]+\.[0-9]+)\.crx$/);
    const extensionId = identityCrxMatch?.[1] ?? requestedExtensionId(url);
    if (!extensionId) return response(req, "Invalid extension ID", 400, { "Content-Type": "text/plain; charset=utf-8" });
    const release = await activeRelease(extensionId);
    if (!release) return response(req, "No active release for extension ID", 404, { "Content-Type": "text/plain; charset=utf-8" });
    if (identityCrxMatch && identityCrxMatch[2] !== release.version) {
      return response(req, "Release not found", 404, { "Content-Type": "text/plain; charset=utf-8" });
    }

    if (path.endsWith("/update.xml")) {
      await logUpdateEvent("update_xml", req, release, url);
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n  <app appid="${release.extension_id}">\n    <updatecheck codebase="${base}/opera-agent-${release.extension_id}-${release.version}.crx" version="${release.version}" />\n  </app>\n</gupdate>\n`;
      return response(req, req.method === "HEAD" ? null : xml, 200, {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "no-store, max-age=0"
      });
    }

    const identityCrxPath = `/opera-agent-${release.extension_id}-${release.version}.crx`;
    const legacyCrxPath = release.extension_id === LEGACY_EXTENSION_ID
      ? `/opera-agent-${release.version}.crx`
      : null;
    if (path.endsWith(identityCrxPath) || (legacyCrxPath !== null && path.endsWith(legacyCrxPath))) {
      await logUpdateEvent("crx", req, release, url);
      const bytes = bytesFromBase64(release.crx_base64);
      return response(req, req.method === "HEAD" ? null : bytes, 200, {
        "Content-Type": "application/x-chrome-extension",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
        "ETag": `"${release.sha256}"`
      });
    }

    if (path.endsWith("/health") || path.endsWith("/opera-agent-update") || path.endsWith("/")) {
      const body = JSON.stringify({
        ok: true,
        product: "Opera Agent",
        version: release.version,
        extensionId: release.extension_id,
        sha256: release.sha256,
        passiveUpdateTelemetry: true
      });
      return response(req, req.method === "HEAD" ? null : body, 200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
    }

    return response(req, "Not Found", 404, { "Content-Type": "text/plain; charset=utf-8" });
  } catch (error) {
    console.error("opera-agent-update", error instanceof Error ? error.message : String(error));
    return response(req, "Update service error", 500, { "Content-Type": "text/plain; charset=utf-8" });
  }
});
