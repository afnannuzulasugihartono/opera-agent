// @title: device — one fleet Durable Object holding every device socket.
// @state: skeleton; full logic lands in Task 2.
// @dependencies: none yet.

// Alarm facts, verified against the Durable Objects docs before building on
// them: millisecond scheduling granularity, usually firing within milliseconds,
// but delayed up to a minute during maintenance failover. A delayed keepalive
// only costs a device-side watchdog reconnect (the device replaces a socket
// silent past 60 s on its own), so the failure mode is a routine reconnect,
// never a stuck device. Second: an in-flight request prevents hibernation, so
// a gateway call blocked waiting for a completion keeps the object — and its
// waiter map — alive until it answers.

export class Device {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch() {
    return Response.json({ ok: false, error: 'NOT_READY' }, { status: 503 });
  }
}
