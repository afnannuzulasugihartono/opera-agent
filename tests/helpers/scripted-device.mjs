// @last-edited: 2026-11-09 UTC+7.
// @title: scripted-device — the socket a test drives, speaking the frames the real extension speaks.
// @state: hello, the heartbeat, the ping proof, the command, and the completion, driven over one socket against a real bridge.
// @dependencies: ../../extension/lib/socket-protocol.js.

// WHY THIS FILE EXISTS

// The bridge answers a real socket, and two suites in this repo prove it.
// Each suite used to carry its own copy of the scripted device, and the two copies drifted apart in what they were willing to answer — which is not a fact about the bridge, just about the copy.
// One helper answers a ping, answers a command with the caller's handler, and records everything it was asked, so a test asserts what the bridge actually sent.

import { completionFrame, handshakeFrame, normalizeCommand, pongFrame } from '../../extension/lib/socket-protocol.js';

export function createScriptedDevice({ url, handle = () => [], answerProof = true, deaf = false, instanceId = undefined, token = '', deviceName = 'scripted' } = {}) {
  const seen = [];
  const events = [];
  let socket = null;
  let open = false;
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });

  const connected = new Promise((resolve, reject) => {
    socket = new WebSocket(url);
    socket.addEventListener('open', () => {
      open = true;
      socket.send(handshakeFrame(token, deviceName, instanceId));
      resolve();
    });
    socket.addEventListener('error', () => reject(new Error('the scripted device could not connect')));
    socket.addEventListener('close', (event) => {
      open = false;
      resolveClosed({ code: Number(event?.code ?? 0), reason: String(event?.reason || '') });
    });
    socket.addEventListener('message', (event) => {
      let frame;
      try {
        frame = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        return;
      }
      events.push(frame);
      if (frame.type === 'ping') {
        if (!deaf) socket.send(pongFrame());
        return;
      }
      if (frame.type !== 'command') return;

      const command = normalizeCommand(frame);
      seen.push(command);
      if (deaf) return;
      if (command.method === 'ping') {
        if (answerProof) socket.send(completionFrame(command.id, true, { pong: true }));
        return;
      }
      Promise.resolve()
        .then(() => handle(command))
        .then((result) => { socket.send(completionFrame(command.id, true, result)); })
        .catch((error) => { socket.send(completionFrame(command.id, false, null, { code: 'EXECUTION_ERROR', message: String(error) })); });
    });
  });

  return {
    seen,
    events,
    closed,
    connected,
    pings: () => seen.filter((command) => command.method === 'ping').length,
    // WHY THIS CLOSE COMES WITH A SETTLE.
    // The close event races the end of the test; giving it a beat to land keeps the next test from being answered by a socket that was still dying.
    async stop() {
      if (open) socket.close();
      await Promise.race([connected, new Promise((resolve) => setTimeout(resolve, 250))]);
    }
  };
}

export function scriptedDevice(url, handle, { answerProof = true, deaf = false, instanceId = undefined } = {}) {
  return createScriptedDevice({ url, handle, answerProof, deaf, instanceId });
}
