// @last-edited: 2026-10-07 UTC+7.
// @title: index — ingest audio windows, transcribe, store segments, delete audio.
// @dependencies: edge-runtime, supabase-js, edge-log.

import "@supabase/edge-runtime";
import { createClient } from "@supabase/supabase-js";
import { createEdgeLog } from "../_shared/edge-log.js";
import { CORS_DEFAULT_ORIGINS, resolveAllowedOrigin } from "../_shared/cors.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") || "";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const cors = {
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store"
};

function withCors(req: Request, res: Response): Response {
  const origin = resolveAllowedOrigin(req, CORS_DEFAULT_ORIGINS);
  const headers = new Headers(res.headers);
  if (origin === null) headers.delete("Access-Control-Allow-Origin");
  else headers.set("Access-Control-Allow-Origin", origin);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const MAX_CHUNK_BYTES = 1024 * 1024;
const MAX_SESSION_MINUTES = 30;
const CHUNK_SECONDS = 10;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" }
  });
}

function validToken(token: unknown): token is string {
  return typeof token === "string" && /^[a-f0-9]{64}$/i.test(token);
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function transcribeWindow(windowChunks: Array<{ audio_base64: string; mime: string }>, language: string, offsetSeconds: number) {
  if (!GROQ_API_KEY) throw new Error("transcription is not configured");

  const parts: Uint8Array[] = [];
  let total = 0;
  for (const c of windowChunks) {
    const binary = atob(c.audio_base64.replace(/\s/g, ""));
    const u8 = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) u8[i] = binary.charCodeAt(i);
    parts.push(u8);
    total += u8.length;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  const mime = (windowChunks[0].mime as string) || "audio/webm";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), "chunk.webm");
  form.append("model", "whisper-large-v3");
  form.append("temperature", "0");
  form.append("response_format", "verbose_json");
  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: form
  });
  if (!response.ok) {

    const detail = await response.text().then((t) => t.slice(0, 200)).catch(() => "");
    throw new Error(`transcribe refused: http ${response.status} ${detail}`);
  }
  const body = await response.json();
  const segments = Array.isArray(body?.segments) ? body.segments : [];
  return segments

    .filter((s: { text?: unknown; no_speech_prob?: unknown }) =>
      typeof s.text === "string" && s.text.trim() &&
      (typeof s.no_speech_prob !== "number" || s.no_speech_prob <= 0.6))
    .map((s: { start?: unknown; end?: unknown; text: string }) => ({
      start: offsetSeconds + Math.max(0, Number(s.start) || 0),
      end: offsetSeconds + Math.max(0, Number(s.end) || 0),
      text: s.text.trim().slice(0, 2000)
    }));
}

async function transcribeDue(session: { id: string; device_id: string; window_secs: number; language: string }, force = false) {
  const needed = Math.max(1, Math.round(session.window_secs / CHUNK_SECONDS));
  const { data: chunks } = await supabase.from("opera_listen_chunks")
    .select("seq, audio_base64, mime").eq("session_id", session.id).order("seq").limit(needed);
  if (!chunks || !chunks.length) return 0;

  if (!force && chunks.length < needed) return 0;
  const windowChunks = chunks;
  let segments: Array<{ start: number; end: number; text: string }>;
  try {
    const baseSeq = windowChunks[0].seq as number;
    segments = await transcribeWindow(windowChunks as Array<{ audio_base64: string; mime: string }>, session.language, baseSeq * CHUNK_SECONDS);
  } catch (error) {

    await supabase.from("opera_audit").insert({
      event_type: "listen.transcribe_failed", device_id: session.device_id,
      details: { sessionId: session.id, reason: String(error instanceof Error ? error.message : error).slice(0, 200) }
    });
    throw error;
  }
  const baseSeq = windowChunks[0].seq as number;
  if (segments.length) {
    await supabase.from("opera_listen_segments").upsert(
      segments.map((s: { start: number; end: number; text: string }, i: number) => ({
        session_id: session.id, seq: baseSeq * 100 + i, start_s: s.start, end_s: s.end, text: s.text
      })),
      { onConflict: "session_id,seq", ignoreDuplicates: true }
    );
  }
  await supabase.from("opera_listen_chunks").delete()
    .eq("session_id", session.id).in("seq", windowChunks.map((c) => c.seq));
  return segments.length;
}

async function handle(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }
  const action = body.action;
  if (action !== "start" && action !== "append" && action !== "stop") {
    return json({ ok: false, error: "Unknown action." }, 400);
  }
  const token = body.token;
  if (!validToken(token)) return json({ ok: false, error: "Invalid token." }, 401);
  const tokenHash = await sha256((token as string).toLowerCase());

  try {
    if (action === "start") {
      const deviceName = typeof body.deviceName === "string" ? body.deviceName.trim().slice(0, 64) : "";
      const tabId = Number(body.tabId);
      if (!deviceName || !Number.isInteger(tabId) || tabId < 0) {
        return json({ ok: false, error: "deviceName and tabId are required." }, 400);
      }
      const { data: device } = await supabase.from("opera_devices")
        .select("id, user_id").eq("device_name", deviceName).eq("token_hash", tokenHash)
        .neq("status", "disabled").single();
      if (!device) return json({ ok: false, error: "Unauthorized device." }, 401);
      const { data: live } = await supabase.from("opera_listen_sessions")
        .select("id").eq("device_id", (device as { id: string }).id).eq("status", "live").limit(1);
      if (live && live.length) {
        return json({ ok: false, error: "A listening session is already live on this device. Stop it first." }, 409);
      }
      const language = typeof body.language === "string" && /^[a-z-]{2,8}$/i.test(body.language) ? body.language : "id";
      const { data: session, error } = await supabase.from("opera_listen_sessions").insert({
        device_id: (device as { id: string }).id,
        user_id: (device as { user_id: string | null }).user_id,
        tab_id: tabId, language, window_secs: 10, status: "live"
      }).select("id").single();
      if (error || !session) {

        const code = (error as { code?: string } | null)?.code;
        if (code === "23505") {
          const { data: winner } = await supabase.from("opera_listen_sessions")
            .select("id").eq("device_id", (device as { id: string }).id).eq("status", "live").limit(1).single();
          if (winner) {
            return json({ ok: false, error: "A listening session is already live on this device. Stop it first.", sessionId: (winner as { id: string }).id }, 409);
          }
        }
        throw new Error("could not start session");
      }
      await supabase.from("opera_audit").insert({
        event_type: "listen.started", device_id: (device as { id: string }).id,
        details: { sessionId: (session as { id: string }).id, tabId }
      });
      return json({ ok: true, sessionId: (session as { id: string }).id });
    }

    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return json({ ok: false, error: "sessionId is required." }, 400);
    const { data: session } = await supabase.from("opera_listen_sessions")
      .select("id, device_id, window_secs, language, started_at, status").eq("id", sessionId).single();
    if (!session || (session as { status: string }).status !== "live") {
      return json({ ok: false, error: "Session is not live." }, 404);
    }
    const { data: owner } = await supabase.from("opera_devices")
      .select("id").eq("id", (session as { device_id: string }).device_id)
      .eq("token_hash", tokenHash).neq("status", "disabled").single();
    if (!owner) return json({ ok: false, error: "Unauthorized device." }, 401);
    const ageMinutes = (Date.now() - Date.parse((session as { started_at: string }).started_at)) / 60000;

    if (action === "append") {
      if (ageMinutes > MAX_SESSION_MINUTES) {
        await supabase.from("opera_listen_sessions").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", sessionId);
        return json({ ok: false, error: "Session exceeded 30 minutes and was ended." }, 409);
      }
      const audio = typeof body.audio === "string" ? body.audio : "";
      const seq = Number(body.seq);
      if (!/^[A-Za-z0-9+/=]+$/.test(audio) || audio.length > MAX_CHUNK_BYTES * 1.4 || !Number.isInteger(seq) || seq < 0) {
        return json({ ok: false, error: "Invalid audio chunk." }, 400);
      }
      const mime = typeof body.mime === "string" ? body.mime.slice(0, 64) : "audio/webm";
      await supabase.from("opera_listen_chunks").upsert(
        { session_id: sessionId, seq, audio_base64: audio, mime },
        { onConflict: "session_id,seq", ignoreDuplicates: true }
      );
      const transcribed = await transcribeDue(session as { id: string; device_id: string; window_secs: number; language: string });
      return json({ ok: true, transcribed });
    }

    await transcribeDue(session as { id: string; device_id: string; window_secs: number; language: string }, true);
    await supabase.from("opera_listen_chunks").delete().eq("session_id", sessionId);
    await supabase.from("opera_listen_sessions")
      .update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", sessionId);
    return json({ ok: true });
  } catch (error) {
    createEdgeLog({}).error("opera-agent-listen", error instanceof Error ? error.message.slice(0, 500) : String(error));
    return json({ ok: false, error: "Internal server error." }, 500);
  }
}

Deno.serve((req: Request) => handle(req).then((res) => withCors(req, res)));
