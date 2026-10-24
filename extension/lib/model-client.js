// @last-edited: 2026-10-25 UTC+7.
// @title: model-client — device-local model compiler over the owner's endpoint.
// @state: The plan call streams (stream:true) and assembles the SSE deltas; a server that answers plain JSON instead is accepted too.
// The key travels only in the Authorization header to the configured endpoint; failures name codes, never credentials.
// @dependencies: options-store, goal-plan.

import { readModelConfig } from './options-store.js';
import { buildPlanRequest, compileGoalPlan } from './goal-plan.js';

export const MODEL_TIMEOUT_MS = 30000;
export const MODEL_MAX_TOKENS = 2000;

export function endpointOk(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

export function buildProbeRequest({ model }) {
  return { model, messages: [{ role: 'system', content: 'Reply with exactly {}.' }, { role: 'user', content: 'ping' }], temperature: 0, max_tokens: 16 };
}

export async function composeModelPlan({ storage, fetchImpl }, { goal, page, target, budgets }) {
  const cfg = await readModelConfig(storage);
  if (!cfg.configured) return { ok: false, code: 'MODEL_NOT_CONFIGURED', message: `Model not configured: missing ${cfg.missing.join(', ')}.`, missing: cfg.missing };
  if (!endpointOk(cfg.endpoint)) return { ok: false, code: 'MODEL_BAD_ENDPOINT', message: 'The model endpoint must be https or loopback http.' };
  const req = buildPlanRequest(goal, { page });
  if (!req.ok) return req;
  const body = { model: cfg.model, messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }], temperature: 0, max_tokens: MODEL_MAX_TOKENS, stream: true };
  let res;
  try {
    res = await fetchImpl(cfg.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${cfg.key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) });
  } catch (error) {
    const timedOut = String(error?.name || '') === 'TimeoutError';
    return { ok: false, code: timedOut ? 'MODEL_TIMEOUT' : 'MODEL_HTTP_ERROR', message: timedOut ? 'The model call timed out.' : 'The model call failed.' };
  }
  if (!res || !res.ok) return { ok: false, code: 'MODEL_HTTP_ERROR', message: `The model endpoint answered ${res?.status ?? 'nothing'}.` };
  const streamed = String(res.headers?.get?.('content-type') || '').includes('text/event-stream');
  let content;
  try {
    content = streamed ? await streamContent(res.body) : await jsonContent(res);
  } catch (error) {
    if (String(error?.name || '') === 'TimeoutError') return { ok: false, code: 'MODEL_TIMEOUT', message: 'The model call timed out.' };
    return { ok: false, code: 'MODEL_BAD_RESPONSE', message: 'The model endpoint did not answer readable text.' };
  }
  if (typeof content !== 'string' || !content) return { ok: false, code: 'MODEL_BAD_RESPONSE', message: 'The model endpoint answered without text.' };
  return compileGoalPlan(content, { target, budgets });
}

async function jsonContent(res) {
  const data = await res.json();
  return data?.choices?.[0]?.message?.content;
}

// The stream is OpenAI-compatible SSE: one JSON object per data: line, [DONE] last.
// Deltas are assembled into the one text the plan gate needs; a server that ignored stream:true is answered by jsonContent instead, so both shapes stay supported.
// A keep-alive or unparsable line is skipped, never fatal.

async function streamContent(body) {
  const reader = body?.getReader?.();
  if (!reader) throw new Error('The stream body is unreadable.');
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const scan = (text) => {
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
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
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
