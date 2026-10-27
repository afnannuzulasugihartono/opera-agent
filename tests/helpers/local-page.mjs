// @last-edited: 2026-10-27 UTC+7.
// @title: local-page — the fake pages the local driver's tests drive.
// @state: one recording CDP, one pipelined CDP, and one document url the canvas surfaces answer with.
// @dependencies: none.

// WHY THE FAKES LIVE APART FROM THE TESTS.
// Each module of the driver has its own test file now, and every one of them drives the same fake page: a page that remembers what was typed, so a correctly typed character is not called a failure.
// One fake in one place means the page behaves the same way in every file that drives it.

export function recordingCdp() {
  const calls = [];

  const page = { body: '9:body text', value: '', holds: true, tail: '' };
  return {
    calls,
    page,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Input.insertText') {
        const held = page.body.slice(page.body.indexOf(':') + 1);
        const grown = held + String(params.text ?? '');
        page.body = `${grown.length}:${grown}`;
      }
      if (method === 'Runtime.evaluate') {
        if (params.expression.includes('document.title')) {
          return { result: { value: { title: 't', url: 'u', text: 'body text', ready: 'complete' } } };
        }
        if (params.expression.includes('readyState')) return { result: { value: 'complete' } };
        if (params.expression.includes('devicePixelRatio')) {
          return { result: { value: { width: 1136, height: 770, dpr: 1.25 } } };
        }
        if (params.expression.includes('opera-locate')) {
          const held = page.body.slice(page.body.indexOf(':') + 1).replace(/\s+/g, ' ');
          const probe = JSON.parse(/const probe = ("(?:[^"\\]|\\.)*")/.exec(params.expression)[1]).replace(/\s+/g, ' ');
          const at = held.lastIndexOf(probe);
          const tail = page.tail ?? '';
          return { result: { value: {
            index: at,
            field: false,
            before: at < 0 ? held.slice(-40) : held.slice(Math.max(0, at - 40), at),
            after: at < 0 ? '' : held.slice(at + probe.length, at + probe.length + 40) + tail,
            len: held.length
          } } };
        }
        if (params.expression.includes('isContentEditable')) return { result: { value: { ...page } } };
        if (params.expression.includes('opera-settle-arm')) return { result: { value: { ok: true } } };
        if (params.expression.includes('opera-settle-read')) {
          return { result: { value: { changes: 1, quietMs: 40, elapsedMs: 40, visibility: 'hidden' } } };
        }
        if (params.expression.includes('opera-settle-disarm')) return { result: { value: true } };
        if (params.expression.includes('opera-hit')) {
          return { result: { value: { tag: 'BUTTON', role: 'button', name: 'Bold' } } };
        }
        return { result: { value: { title: 't', url: 'u', text: 'body text' } } };
      }
      if (method === 'Page.captureScreenshot') return { data: 'BASE64' };
      if (method === 'Page.getLayoutMetrics') {
        return { cssVisualViewport: { pageX: 0, pageY: 0 }, contentSize: { x: 0, y: 0, width: 1136, height: 2400 } };
      }
      return { result: {} };
    }
  };
}


export const DOC_URL = 'https://docs.google.com/document/d/abc/edit';

export function pipelinedCdp(handler = () => ({})) {
  const calls = [];
  let inflight = 0;
  let max = 0;
  const page = { body: '9:body text', value: '', holds: true };
  return {
    calls,
    page,
    stats: () => ({ max }),
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Input.insertText') {
        const held = page.body.slice(page.body.indexOf(':') + 1);
        const grown = held + String(params.text ?? '');
        page.body = `${grown.length}:${grown}`;
      }
      inflight += 1;
      max = Math.max(max, inflight);
      await Promise.resolve();
      await Promise.resolve();
      inflight -= 1;
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-locate')) {
        const held = page.body.slice(page.body.indexOf(':') + 1).replace(/\s+/g, ' ');
        const probe = JSON.parse(/const probe = ("(?:[^"\\]|\\.)*")/.exec(params.expression)[1]).replace(/\s+/g, ' ');
        const at = held.lastIndexOf(probe);
        return { result: { value: { index: at, field: false, before: '', after: '', len: held.length } } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('isContentEditable')) {
        return { result: { value: { ...page } } };
      }
      return handler(method, params);
    }
  };
}
