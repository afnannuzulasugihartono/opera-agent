// @last-edited: 2026-10-13 UTC+7.
// @title: agent-drive — one driver, every canvas: locate by meaning, act, prove it.
// @state: transport-agnostic locate/act/verify with clocks and honest envelopes.
// @dependencies: none.
//
// WHY THIS FILE EXISTS
//
// Every canvas drive is the same loop — find the thing, touch it, prove it moved —
// and every failure in measurement came from skipping one of the three: stale
// coordinates clicked the wrong menu, unthrottled keys vanished into a busy editor,
// and one CDP call never answered at all. The driver makes the loop structural:
// location comes from a live tree read seconds before the action, every transport
// call carries its own deadline, and nothing claims success without evidence.
//
// WHY THE TRANSPORT ARRIVES INJECTED. The same drive runs over local CDP at one
// millisecond per primitive and over the remote relay at roughly a second per call.
// The driver does not know which it holds; it counts milliseconds either way and the
// caller picks the fastest transport that can reach the tab. Tests inject a scripted
// double with deterministic delays, so timing behavior is asserted, not hoped for.
//
// WHAT AN ENVELOPE PROMISES. Every method returns one object shaped for an agent to
// consume in a single glance: ok, ms, what was attempted, and the evidence. On failure
// it names what was visible instead plus the single next action worth trying. Nothing
// returns bare coordinates, bare booleans, or an error without its context.
//
// WHY EVERY CALL CARRIES ITS OWN DEADLINE. One CDP call in measurement never answered
// at all, so no transport call is ever trusted without one. A timeout names the
// operation that hung, because "slow" without a name cannot be fixed.

const DEFAULT_CALL_TIMEOUT_MS = 15000;

function rectangleCenter(quad) {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return {
    x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
    y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2)
  };
}

function nodeName(node) {
  return node?.name?.value ?? node?.name ?? '';
}

function nodeRole(node) {
  return node?.role?.value ?? node?.role ?? '';
}

export function createAgentDriver({ transport, callTimeoutMs = DEFAULT_CALL_TIMEOUT_MS, now = () => Date.now() } = {}) {
  if (!transport) throw new Error('createAgentDriver needs a transport.');
  const timings = [];

  const timed = async (op, fn) => {
    const started = now();
    const value = await withTimeout(fn(), callTimeoutMs, op);
    const ms = now() - started;
    timings.push({ op, ms });
    return { value, ms };
  };

  async function withTimeout(promise, ms, op) {
    let timer = null;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error(`${op} timed out after ${ms} ms`), { code: 'TIMEOUT', op })), ms);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const fail = (code, message, extra = {}) => ({ ok: false, code, message, ms: 0, ...extra });

  async function locate({ role, name }) {
    const started = now();
    let nodes;
    try {
      nodes = (await timed('axTree', () => transport.axTree()))?.value ?? [];
    } catch (error) {
      if (error?.code === 'TIMEOUT') return { ...fail('TIMEOUT', String(error.message)), ms: now() - started };
      throw error;
    }
    const matches = nodes.filter((node) => {
      if (role && nodeRole(node) !== role) return false;
      if (name && !nodeName(node).toLowerCase().includes(String(name).toLowerCase())) return false;
      return true;
    });
    if (!matches.length) {
      const visible = nodes
        .filter((node) => !role || nodeRole(node) === role)
        .map((node) => `${nodeRole(node)}:${nodeName(node)}`.slice(0, 60))
        .slice(0, 12);
      return {
        ...fail('NOT_FOUND', `no ${role ?? 'node'} matching "${name ?? ''}"`, { visible }),
        ms: now() - started,
        next: 'broaden the name substring or drop the role filter and inspect visible'
      };
    }
    const target = matches[0];
    if (target.backendDOMNodeId == null) {
      return {
        ...fail('NO_BOX', `matched "${nodeName(target)}" but it exposes no box`, { target: { role: nodeRole(target), name: nodeName(target) } }),
        ms: now() - started,
        next: 'pick another match or fall back to keyboard navigation'
      };
    }
    let quad;
    try {
      quad = (await timed('box', () => transport.box(target.backendDOMNodeId)))?.value ?? null;
    } catch (error) {
      if (error?.code === 'TIMEOUT') return { ...fail('TIMEOUT', String(error.message)), ms: now() - started };
      throw error;
    }
    if (!quad) {
      return { ...fail('NO_BOX', `box lookup failed for "${nodeName(target)}"`), ms: now() - started };
    }
    return {
      ok: true,
      ms: now() - started,
      target: { role: nodeRole(target), name: nodeName(target) },
      point: rectangleCenter(quad)
    };
  }

  async function click({ role, name }) {
    const started = now();
    const found = await locate({ role, name });
    if (!found.ok) return { ...found, steps: ['locate'] };
    let acted;
    try {
      acted = await timed('click', () => transport.click(found.point.x, found.point.y));
    } catch (error) {
      if (error?.code === 'TIMEOUT') {
        return { ...fail('TIMEOUT', String(error.message), { steps: ['locate', 'click'] }), ms: now() - started };
      }
      throw error;
    }
    return {
      ok: true,
      ms: now() - started,
      target: found.target,
      point: found.point,
      steps: ['locate', 'click'],
      evidence: acted.value ?? null
    };
  }

  async function typeText({ text, verify }) {
    const started = now();
    let acted;
    try {
      acted = await timed('type', () => transport.type(text));
    } catch (error) {
      if (error?.code === 'TIMEOUT') {
        return { ...fail('TIMEOUT', String(error.message)), ms: now() - started };
      }
      throw error;
    }
    if (typeof verify === 'function') {
      const verdict = await verify();
      if (!verdict?.ok) {
        return {
          ok: false,
          code: 'VERIFY_FAILED',
          message: 'the text did not land where expected',
          ms: now() - started,
          expected: verdict?.expected,
          found: verdict?.found,
          next: 're-establish focus (click the surface), then retype'
        };
      }
      return { ok: true, ms: now() - started, chars: String(text).length, evidence: verdict.evidence ?? acted.value ?? null };
    }
    return { ok: true, ms: now() - started, chars: String(text).length };
  }

  async function streamKeys({ events }) {
    const started = now();
    try {
      const out = await timed('keys', () => transport.keys(events));
      return { ok: true, ms: now() - started, events: events.length, execMs: out.value?.execMs ?? null };
    } catch (error) {
      if (error?.code === 'TIMEOUT') {
        return { ...fail('TIMEOUT', String(error.message)), ms: now() - started };
      }
      throw error;
    }
  }

  function summary() {
    const byOp = {};
    for (const t of timings) {
      byOp[t.op] = byOp[t.op] ?? { calls: 0, ms: 0 };
      byOp[t.op].calls += 1;
      byOp[t.op].ms += t.ms;
    }
    return {
      calls: timings.length,
      totalMs: timings.reduce((sum, t) => sum + t.ms, 0),
      byOp
    };
  }

  return { locate, click, typeText, streamKeys, summary };
}
