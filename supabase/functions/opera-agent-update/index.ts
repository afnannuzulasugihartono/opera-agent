// @last-edited: 2026-10-06 12:20 UTC+7.
// @title: index — Repository file.
// @state: serves update.xml and the signed CRX per extension id, plus the newest build under two version-less download paths for the site.
// @dependencies: edge-runtime, supabase-js, cors.

import "@supabase/edge-runtime";
import { createClient } from "@supabase/supabase-js";
import { CORS_DEFAULT_ORIGINS, resolveAllowedOrigin } from "../_shared/cors.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const LEGACY_EXTENSION_ID = "pagjlnohdemoohcncicjmaejedcmcocm";
const CURRENT_EXTENSION_ID = "ofgemipoobcnbjkfanmofjbdonjapmgl";

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

// A CRX3 is the four magic bytes, a format word, the length of the signed header, that
// header, and then the extension tree as a plain zip. The header length is read from the
// file rather than assumed, so a format change fails loudly instead of slicing mid-zip.

const CRX_MAGIC = "Cr24";
const CRX_PREFIX_BYTES = 12;


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

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesFromBase64(value: string) {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// WHY the payload is sliced rather than repacked: the bytes after the signed header are
// already a zip holding the same tree, so "load unpacked" needs no second build of the
// extension and there is no second copy in existence that can disagree with the signed
// one. The shipped archive used to be a hand-built file in the tree that no workflow
// rebuilt, and it survived a key rotation still naming the old identity.

function zipPayloadOf(crx: Uint8Array): Uint8Array | null {
  if (crx.length < CRX_PREFIX_BYTES + 4) return null;
  const magic = new TextDecoder().decode(crx.subarray(0, 4));
  if (magic !== CRX_MAGIC) return null;
  const view = new DataView(crx.buffer, crx.byteOffset, crx.byteLength);
  const headerLength = view.getUint32(8, true);
  const start = CRX_PREFIX_BYTES + headerLength;
  if (start >= crx.length) return null;

  // WHY the zip is checked here and not at the call site: a payload that does not start
  // with PK means the layout changed, and serving those bytes as an archive would hand a
  // reader a file their unzip tool rejects with no explanation.
  if (crx[start] !== 0x50 || crx[start + 1] !== 0x4b) return null;
  return crx.subarray(start);
}

function requestedExtensionId(url: URL) {
  // Chromium update clients send their app metadata inside the `x` query
  // parameter (for example: ?x=id%...%26v%3D1.1.0). Supporting `id` too
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
    const base = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/opera-agent-update`;

    // WHY these two are answered before the identity is resolved: they carry no version
    // and no id. A link naming a build is a promise nothing enforces, so the download page
    // went on serving 1.6.15 after 1.6.16 shipped and no reader could tell. These resolve
    // to whatever is active now, which is what "the newest build" means to a stranger, and
    // it costs a release no edit to the page at all.
    if (path.endsWith("/download/opera-agent.crx") || path.endsWith("/download/opera-agent.zip")) {
      const wantsZip = path.endsWith("/download/opera-agent.zip");
      const current = await activeRelease(CURRENT_EXTENSION_ID);
      if (!current) return response(req, "No active release for extension ID", 404, { "Content-Type": "text/plain; charset=utf-8" });
      // WHY both log as "crx": the archive is the signed CRX's own payload, served for a
      // reader rather than an updater. Adding a kind would need a migration to widen a
      // check constraint, and the path column already tells the two apart.
      await logUpdateEvent("crx", req, current, url);
      const bytes = wantsZip
        ? zipPayloadOf(bytesFromBase64(current.crx_base64))
        : bytesFromBase64(current.crx_base64);
      if (!bytes) return response(req, "Release payload is not a zip", 500, { "Content-Type": "text/plain; charset=utf-8" });
      const filename = `opera-agent-${current.version}${wantsZip ? ".zip" : ".crx"}`;
      return response(req, req.method === "HEAD" ? null : new Uint8Array(bytes).buffer, 200, {
        "Content-Type": wantsZip ? "application/zip" : "application/x-chrome-extension",
        "Content-Length": String(bytes.byteLength),
        // WHY no-store and not the year the versioned paths carry: the bytes under this
        // path change on the next release, so a cached answer here is a stale answer the
        // reader has no way to notice.
        "Cache-Control": "no-store, max-age=0",
        // WHY the version rides in the filename: the link cannot change, but the file a
        // reader saves should still say which build it is, or two downloads are identical.
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Opera-Version": current.version,
        // WHY this digest is of the bytes in this response and not the release's: the
        // archive is the CRX payload, so the release sha256 names a different file. A
        // reader told to compare the two would get two different numbers and conclude
        // their download was corrupt.
        "X-Opera-Sha256": await sha256Hex(bytes)
      });
    }

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
