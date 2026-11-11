// @last-edited: 2026-11-11 UTC+7.
// @title: start-bridge - the loopback bridge the extension links to, held open for whoever drives the browser locally.
// @state: the port it listens on and the fact that it is listening.
// @dependencies: local/bridge-ws.js.

// WHY THIS EXISTS.
// The local road is a loopback bridge: the extension dials it, and the same commands the relay sends travel over it without leaving the machine.
// The extension finds the bridge by probing the candidate ports and asking the bridge's own question, so the bridge has to be running before the browser is driven locally.
// This is that running, in one command, and it prints the address it holds.

import { createBridgeServer } from '../local/bridge-ws.js';

const PORT = Number(process.env.OPERA_BRIDGE_PORT || 9451);

const server = createBridgeServer({ port: PORT });
try {
  const address = await server.listen();
  console.log(JSON.stringify({ ok: true, address }));
} catch (error) {
  console.error('bridge failed:', error?.message ?? error);
  process.exit(1);
}

// WHY THE PROCESS STAYS ALIVE.
// The bridge is a socket the extension holds; closing it would close the road the local driver is about to use.

setInterval(() => {}, 60_000);
