// @last-edited: 2026-10-25 UTC+7.
// @title: model-client — device-local model compiler over the owner's endpoint.
// @state: The plan call streams (stream:true) and assembles the SSE deltas; a server that answers plain JSON instead is accepted too.
// The key travels only in the Authorization header to the configured endpoint; failures name codes, never credentials.
// @dependencies: options-store, goal-plan.

import { readModelConfig, type StorageAreaLike } from './options-store.js';
import { buildPlanRequest, compileGoalPlan } from './goal-plan.js';
import { isRecord } from './guards.js';

export const MODEL_TIMEOUT_MS = 30000;
export const MODEL_MAX_TOKENS = 2000;

export function endpointOk(value: unknown): boolean {
  try {
    const url = new URL(String(value));
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

export function buildProbeRequest({ model }: { model?: string | undefined }) {
  return { model, messages: [{ role: 'system', content: 'Reply with exactly {}.' }, { role: 'user', content: 'ping' }], temperature: 0, max_tokens: 16 };
}

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;
interface ComposeModelPlanOptions { goal?: unknown; page?: unknown; target?: unknown; budgets?: Record<string, unknown> | undefined }

export async function composeModelPlan({ storage, fetchImpl }: { storage: StorageAreaLike; fetchImpl: FetchImpl }, { goal, page, target, budgets }: ComposeModelPlanOptions) {
  const cfg = await readModelConfig(storage);
  if (!cfg.configured) {
    const missing = Array.isArray(cfg.missing) ? cfg.missing : [];
    return { ok: false, code: 'MODEL_NOT_CONFIGURED', message: `Model not configured: missing ${missing.join(', ')}.`, missing };
  }
  // readModelConfig's inferred union still allows the unconfigured arm members; after the early return they carry strings.
  const endpoint = typeof cfg.endpoint === 'string' ? cfg.endpoint : '';
  const model = typeof cfg.model === 'string' ? cfg.model : '';
  const key = typeof cfg.key === 'string' ? cfg.key : '';
  if (!endpointOk(endpoint)) return { ok: false, code: 'MODEL_BAD_ENDPOINT', message: 'The model endpoint must be https or loopback http.' };
  const req = buildPlanRequest(goal, { page });
  if (!req.ok || !('system' in req)) return req;
  const body = { model, messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }], temperature: 0, max_tokens: MODEL_MAX_TOKENS, stream: true };
  let res: Response | undefined;
  try {
    res = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) });
  } catch (error) {
    const timedOut = isRecord(error) && error.name === 'TimeoutError';
    return { ok: false, code: timedOut ? 'MODEL_TIMEOUT' : 'MODEL_HTTP_ERROR', message: timedOut ? 'The model call timed out.' : 'The model call failed.' };
  }
  if (!res || !res.ok) return { ok: false, code: 'MODEL_HTTP_ERROR', message: `The model endpoint answered ${res?.status ?? 'nothing'}.` };
  const streamed = String(res.headers?.get?.('content-type') || '').includes('text/event-stream');
  let content: string | undefined;
  try {
    content = streamed ? await streamContent(res.body) : await jsonContent(res);
  } catch (error) {
    if (isRecord(error) && error.name === 'TimeoutError') return { ok: false, code: 'MODEL_TIMEOUT', message: 'The model call timed out.' };
    return { ok: false, code: 'MODEL_BAD_RESPONSE', message: 'The model endpoint did not answer readable text.' };
  }
  if (typeof content !== 'string' || !content) return { ok: false, code: 'MODEL_BAD_RESPONSE', message: 'The model endpoint answered without text.' };
  return compileGoalPlan(content, { target, budgets });
}

async function jsonContent(res: Response): Promise<string | undefined> {
  const data: unknown = await res.json();
  if (!isRecord(data)) return undefined;
  const choices = data.choices;
  if (!Array.isArray(choices)) return undefined;
  const first: unknown = choices[0];
  if (!isRecord(first)) return undefined;
  const message = first.message;
  if (!isRecord(message)) return undefined;
  const content = message.content;
  return typeof content === 'string' ? content : undefined;
}

// The stream is OpenAI-compatible SSE: one JSON object per data: line, [DONE] last.
// Deltas are assembled into the one text the plan gate needs; a server that ignored stream:true is answered by jsonContent instead, so both shapes stay supported.
// A keep-alive or unparsable line is skipped, never fatal.

async function streamContent(body: ReadableStream<Uint8Array> | null): Promise<string> {
  const reader = body?.getReader?.();
  if (!reader) throw new Error('The stream body is unreadable.');
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const scan = (text: string): boolean => {
    buffer += text;
    for (;;) {
      const cut = buffer.indexOf('\n');
      if (cut < 0) return false;
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return true;
      try {
        const parsed: unknown = JSON.parse(payload);
        const choices = isRecord(parsed) ? parsed.choices : undefined;
        const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
        const delta = isRecord(first) && isRecord(first.delta) ? first.delta.content : undefined;
        if (typeof delta === 'string') content += delta;
      } catch {}
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      if (scan(decoder.decode(value, { stream: true }))) {
        await reader.cancel().catch(() => {});
        return content;
      }
    }
    if (done) break;
  }
  scan(decoder.decode());
  return content;
}
