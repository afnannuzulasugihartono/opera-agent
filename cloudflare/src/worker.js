// @title: worker — edge entry: routes command calls and device sockets.
// @state: skeleton; full gateway lands in Task 3, Device shell in Task 2.
// @dependencies: ./device.js (Task 2).

export { Device } from './device.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, service: 'opera-agent', time: new Date().toISOString() });
    }
    return Response.json({ ok: false, error: { code: 'NOT_READY', message: 'Gateway lands in Task 3.' } }, { status: 503 });
  }
};
