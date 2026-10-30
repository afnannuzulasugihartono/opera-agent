// @last-edited: 2026-10-25 UTC+7.
// @title: model-client — device-local model compiler over the owner's endpoint.
// @state: The plan call streams (stream:true) and assembles the SSE deltas; a server that answers plain JSON instead is accepted too.
// The key travels only in the Authorization header to the configured endpoint; failures name codes, never credentials.
// @dependencies: options-store, goal-plan.

import { readModelConfig } from './options-store.js';
import {
  buildPlanRequest,
  compileGoalPlan
} from './goal-plan.js';

export const MODEL_TIMEOUT_MS = 30000;
export const MODEL_MAX_TOKENS = 2000;

/**
 * Whether a model endpoint URL is acceptable: https anywhere, or http loopback only.
 * @param {*} value The endpoint URL.
 * @returns {boolean} True when acceptable.
 */

export function endpointOk(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:' && [
      '127.0.0.1',
      'localhost',
      '::1',
      '[::1]'
    ].includes(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Build the tiny probe request used to check the configured endpoint answers at all.
 * @param {{ model: string }} options The model name.
 * @returns {{ model: string, messages: object[], temperature: number, max_tokens: number }} The request body.
 */

export function buildProbeRequest({ model }) {
  return {
    model,
    messages: [
      {
        role: 'system',
        content: 'Reply with exactly {}.'
      },
      {
        role: 'user',
        content: 'ping'
      }
    ],
    temperature: 0,
    max_tokens: 16
  };
}

/**
 * Make the one device-local model call for a task and return the raw reply text.
 * The key travels only in the Authorization header to the owner's endpoint and never to our server, queue, database, or logs; an unconfigured device refuses with MODEL_NOT_CONFIGURED before any network call.
 * @param {{ storage: object, fetchImpl: typeof fetch }} deps Storage for the model config, and the fetch to use.
 * @param {{ system: string, user: string }} prompt The prompts to send.
 * @returns {Promise<{ ok: true, text: string } | { ok: false, code: string, message: string, missing?: string[] }>} The raw reply text, or the coded refusal.
 */

export async function callModelText({
  storage,
  fetchImpl
},
  {
    system,
    user
  }
) {
  const cfg = await readModelConfig(storage);
  if (!cfg.configured) return {
    ok: false,
    code: 'MODEL_NOT_CONFIGURED',
    message: `Model not configured: missing ${cfg.missing.join(', ')}.`,
    missing: cfg.missing
  };
  if (!endpointOk(cfg.endpoint)) return {
    ok: false,
    code: 'MODEL_BAD_ENDPOINT',
    message: 'The model endpoint must be https or loopback http.'
  };
  const body = {
    model: cfg.model,
    messages: [
      {
        role: 'system',
        content: system
      },
      {
        role: 'user',
        content: user
      }
    ],
    temperature: 0,
    max_tokens: MODEL_MAX_TOKENS,
    stream: true
  };
  let res;
  try {
    res = await fetchImpl(cfg.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${cfg.key}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
    });
  } catch (error) {
    const timedOut = String(error?.name || '') === 'TimeoutError';
    return {
      ok: false,
      code: timedOut ? 'MODEL_TIMEOUT' : 'MODEL_HTTP_ERROR',
      message: timedOut ? 'The model call timed out.' : 'The model call failed.'
    };
  }
  if (!res || !res.ok) return {
    ok: false,
    code: 'MODEL_HTTP_ERROR',
    message: `The model endpoint answered ${res?.status ?? 'nothing'}.`
  };
  const streamed = String(res.headers?.get?.('content-type') || '').includes('text/event-stream');
  let content;
  try {
    content = streamed ? await streamContent(res.body) : await jsonContent(res);
  } catch (error) {
    if (String(error?.name || '') === 'TimeoutError') return {
      ok: false,
      code: 'MODEL_TIMEOUT',
      message: 'The model call timed out.'
    };
    return {
      ok: false,
      code: 'MODEL_BAD_RESPONSE',
      message: 'The model endpoint did not answer readable text.'
    };
  }
  if (typeof content !== 'string' || !content) return {
    ok: false,
    code: 'MODEL_BAD_RESPONSE',
    message: 'The model endpoint answered without text.'
  };
  return {
    ok: true,
    text: content
  };
}

/**
 * Call the owner's model endpoint to compile a goal into a plan, streaming the SSE deltas (a plain JSON answer is accepted too).
 * The key travels only in the Authorization header.
 * @param {{ storage: object, fetchImpl: typeof fetch }} deps Storage for the model config, and the fetch to use.
 * @param {{ goal: string, page?: object, target?: object, budgets?: object }} input The goal and observed page.
 * @returns {Promise<object>} The compiled plan, or `{ ok: false, code, message }` with a code that names the failure, never the credentials.
 */

export async function composeModelPlan({
  storage,
  fetchImpl
},
  {
    goal,
    page,
    target,
    budgets
  }
) {
  const req = buildPlanRequest(goal, { page });
  if (!req.ok) return req;
  const answer = await callModelText({
    storage,
    fetchImpl
  }, {
    system: req.system,
    user: req.user
  });
  if (!answer.ok) return answer;
  return compileGoalPlan(answer.text, {
    target,
    budgets
  });
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
    const {
      done,
      value
    } = await reader.read();
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
