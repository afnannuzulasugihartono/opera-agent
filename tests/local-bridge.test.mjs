// @last-edited: 2026-10-14 UTC+7.
// @title: local-bridge — the local bridge end, proven against a scripted device over a real socket.
// @state: tab ops, CDP transport, error surfacing, the origin boundary, proof, trust, teardown.
// @dependencies: node:test, strict, ../local/bridge.js, ../local/cdp.js, ../extension/lib/socket-protocol.js.

// WHY A SCRIPTED DEVICE AND NOT THE REAL WORKER.
// The worker dials one fixed port, so two test files that both import it fight over the same connection — observed, and a green run would have meant nothing.
// The worker's own half is proven in tests/bridge-link.test.mjs against the real module over a real socket; this file proves the local API against a device that behaves the way the real one does: hello, answer, report.

// WHY ONE CLAIM CHANGED RATHER THAN DISAPPEARED.
// A held poll waited twelve seconds for a worker to turn up mid-command, so a command raised while nobody was listening still got answered.
// The socket refuses it instead, and says so in one sentence naming the one fix.
// That is the trade this file now locks: waiting at session-open (still proven below) buys the slow start, and a dead link mid-call is named immediately instead of hanging.

// WHY THE ORIGIN IS TESTED AT ALL.
// A Node WebSocket client sends no Origin header, so every other test here and in bridge-link.test.mjs passes against a server that would refuse the browser outright.
// Chrome does send one, so the header it sends is asserted here against the header the server expects.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';

import {
  bridgeAddress,
  bridgeReachable,
  closeBridge,
  closeBridgeTarget,
  connectBridgeTarget,
  listBridgeTargets,
  openBridgeTarget,
  waitForBridgeLink
} from '../local/bridge.js';
import { createCdpClient } from '../local/cdp.js';
import { createBridgeServer } from '../local/bridge-server.js';
import { completionFrame, handshakeFrame, normalizeCommand, pongFrame } from '../extension/lib/socket-protocol.js';

process.env.OPERA_BRIDGE_PORT = '0';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// WHY the device speaks the protocol rather than echoing bytes.
// The server settles a command on its completion frame and refuses anything else, so a device that made its own replies would prove nothing about the one the real extension sends.

// WHY THE HELLO GOES OUT ON OPEN.
// The real client announces itself the moment the socket opens, and the server holds every command until it hears it — which is the whole point, since the device drops anything that arrives before it has been given a `ready`.
// A device that waited for `ready` before saying hello would wait forever, and every command with it.

function scriptedDevice(url, handle, { answerProof = true, deaf = false } = {}) {
  const seen = [];
  let socket = null;
  let open = false;

  const connected = new Promise((resolve, reject) => {
    socket = new WebSocket(url);
    socket.addEventListener('open', () => {
      open = true;
      socket.send(handshakeFrame('', 'scripted'));
      resolve();
    });
    socket.addEventListener('error', () => reject(new Error('the scripted device could not connect')));
    socket.addEventListener('close', () => { open = false; });
    socket.addEventListener('message', (event) => {
      let frame;
      try {
        frame = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        return;
      }
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
        .then(
          (result) => socket.send(completionFrame(command.id, true, result)),
          (error) => socket.send(completionFrame(command.id, false, null, {
            code: 'BRIDGE_COMMAND_FAILED',
            message: error?.message || String(error)
          }))
        );
    });
  });
  connected.catch(() => {});

  return {
    seen,
    pings: () => seen.filter((command) => command.method === 'ping').length,
    connected,
    async stop() {
      if (open) socket.close();
      await Promise.race([connected, sleep(250)]);
    }
  };
}

// WHY a registry.
// A test that fails mid-body leaves its device attached, and the next test is then answered by a stranger — which reads as a flaky bridge rather than as a failed assertion.
// Observed: one red test turned two.

const live = [];
test.afterEach(async () => {
  for (const device of live.splice(0)) await device.stop();
  await closeBridge();
});

async function startDevice(handle, options) {
  const { url } = await bridgeAddress();
  const device = scriptedDevice(url, handle, options);
  live.push(device);
  await device.connected;
  const deadline = Date.now() + 3000;
  while (!(await waitForBridgeLink({ timeoutMs: 50 })) && Date.now() < deadline) await sleep(25);
  assert.equal(await waitForBridgeLink({ timeoutMs: 200 }), true, 'the device came up');
  return device;
}

test('a session waits for its device instead of failing a slow extension', async () => {
  const { port } = await bridgeAddress();
  assert.ok(port > 0, 'the bridge listened on a port of its own');
  assert.equal(await waitForBridgeLink({ timeoutMs: 60 }), false, 'nobody home yet');

  const device = scriptedDevice(`ws://127.0.0.1:${port}`, () => []);
  live.push(device);
  await device.connected;

  assert.equal(await waitForBridgeLink({ timeoutMs: 500 }), true);
});

test('tab operations round-trip through the device', async () => {
  const seen = [];
  const device = await startDevice((command) => {
    seen.push(command);
    if (command.method === 'tabs.list') return [{ id: 7, url: 'https://x/', title: 'X' }];
    if (command.method === 'tabs.open') return { id: 8, url: command.params.url, title: '' };
    return { id: command.params.tabId, closed: true };
  });

  assert.deepEqual(await listBridgeTargets(), [{ id: 7, url: 'https://x/', title: 'X' }]);
  assert.deepEqual(await openBridgeTarget('https://y/'), { id: 8, url: 'https://y/', title: '' },
    'an opened tab answers with the same shape a listed one has');
  assert.deepEqual(await closeBridgeTarget(8), { id: 8, closed: true });

  const operations = seen.filter((command) => command.method !== 'ping').map((command) => command.method);
  assert.deepEqual(operations, ['tabs.list', 'tabs.open', 'tabs.close'], 'one vocabulary, in order');
  assert.ok(seen.every((command) => typeof command.id === 'string' && command.id.length > 0),
    'every command carries an id the completion can settle against');
});

// WHY CLOSING IS ASSERTED AT ALL.
// The transport is a hand-off to cdp.js, so closing has to close it, and while the bridge handed back a bare function instead, `cdp.close()` threw a TypeError — which no call test would ever see, because nothing closes a client until somebody tears a session down.

test('a CDP client drives through the bridge transport and closes cleanly', async () => {
  const device = await startDevice(() => ({ value: 42 }));
  const cdp = createCdpClient(connectBridgeTarget(77));

  const out = await cdp.send('Runtime.evaluate', { expression: '6*7' });

  assert.deepEqual(out, { value: 42 });
  assert.equal(device.seen.at(-1).params.tabId, 77);
  assert.equal(device.seen.at(-1).params.method, 'Runtime.evaluate');

  cdp.close();
  assert.equal(cdp.closed, true);
  await assert.rejects(() => cdp.send('Page.bringToFront', {}), /closed/);
});

test('two sessions on one tab do not steal each other replies', async () => {
  const device = await startDevice(async (command) => {
    if (command.params.method === 'slow') await sleep(150);
    return { echo: command.params.method };
  });

  const first = createCdpClient(connectBridgeTarget(77));
  const second = createCdpClient(connectBridgeTarget(77));

  const order = [];
  const slow = first.send('slow', {}).then((value) => { order.push('first'); return value; });
  const quick = second.send('quick', {}).then((value) => { order.push('second'); return value; });

  assert.deepEqual(await Promise.all([slow, quick]), [{ echo: 'slow' }, { echo: 'quick' }]);
  assert.deepEqual(order, ['second', 'first'], 'the answers came back out of order');
  first.close();
  second.close();
});

test('an extension error arrives as a CDP error rather than silence', async () => {
  await startDevice(() => {
    throw new Error('No such tab');
  });

  const cdp = createCdpClient(connectBridgeTarget(99));
  await assert.rejects(() => cdp.send('Page.bringToFront', {}), /No such tab/);
  cdp.close();
});

test('a call with nobody home is named at once instead of hanging', async () => {
  const started = Date.now();
  await assert.rejects(() => listBridgeTargets(), /extension is not connected/);
  assert.ok(Date.now() - started < 3000, 'the one fix is named in milliseconds, not after a wait');
});

test('a call in flight when the device goes is named too', async () => {
  const device = await startDevice(() => new Promise(() => {}));

  const cdp = createCdpClient(connectBridgeTarget(4));
  const hanging = cdp.send('Page.bringToFront', {});
  await sleep(120);
  await device.stop();

  await assert.rejects(() => hanging, /disconnected|still in flight/);
  cdp.close();
});

test('a device that connects but answers nothing fails on the proof, not the command', async () => {
  await startDevice(() => [], { deaf: true });

  const started = Date.now();
  await assert.rejects(() => listBridgeTargets({ timeoutMs: 30000 }), /liveness proof/);
  const waited = Date.now() - started;
  assert.ok(waited < 12000, `the proof named it in ${waited} ms, not the 30000 ms command timeout`);
});

test('a CDP call is proved before it is sent, like every other command', async () => {
  const device = await startDevice(() => ({ value: 1 }));

  const cdp = createCdpClient(connectBridgeTarget(5));
  await cdp.send('Runtime.evaluate', { expression: '1' });

  assert.equal(device.seen[0].method, 'ping', 'the liveness proof goes first');
  assert.equal(device.seen[1].params.method, 'Runtime.evaluate');
  cdp.close();
});

// WHY the origin boundary is asserted by hand.
// Node sends no Origin header, so the scripted device above proves nothing about the header Chrome sends, and a server that refuses that header leaves every other test in this file green.
// The raw upgrade below is the only place the real header meets the real check.

// WHY THE REQUEST IS BOUNDED.
// A request that is neither answered nor refused leaves the promise pending forever, and node:test then cancels every test after it — which reads as four broken tests instead of one broken handshake.

// WHY THE HANDSHAKE KEY IS NOT THE SPEC'S OWN SAMPLE.
// RFC 6455 opens with the nonce 'the sample nonce', and the secret scanner reads any base64 sitting next to the word key as a credential - correctly, and wrongly here.
// The server accepts any sixteen-byte key, so these use sixteen zero bytes.

function upgradeStatus(port, origin) {
  return new Promise((resolve, reject) => {
    const headers = {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': 'AAAAAAAAAAAAAAAAAAAAAA=='
    };
    if (origin !== undefined) headers.Origin = origin;
    const req = httpRequest({ host: '127.0.0.1', port, path: '/', headers });
    const guard = setTimeout(() => {
      req.destroy();
      reject(new Error(`the upgrade for ${origin} was never answered`));
    }, 3000);
    const settle = (status) => {
      clearTimeout(guard);
      resolve(status);
    };
    req.on('upgrade', (res, socket) => { socket.destroy(); settle(res.statusCode); });
    req.on('response', (res) => { res.resume(); settle(res.statusCode); });
    req.on('error', (error) => { clearTimeout(guard); reject(error); });
    req.end();
  });
}

test('the origin Chrome sends is the origin the bridge accepts', async () => {
  const { port } = await bridgeAddress();

  for (const id of ['ofgemipoobcnbjkfanmofjbdonjapmgl', 'ohbbpamcljckmjhcpkcmefdobkoeaick']) {
    assert.equal(await upgradeStatus(port, `chrome-extension://${id}`), 101,
      `the installed extension ${id} must be able to reach the bridge`);
  }
  assert.equal(await upgradeStatus(port, 'http://127.0.0.1'), 101, 'the loopback itself is allowed');
  assert.equal(await upgradeStatus(port, 'http://localhost'), 101, 'and so is localhost by name');
});

// WHY THE LOOKALIKE IS NAMED IN THE TEST.
// The old rule accepted any origin ending in an allowed one, so a domain anybody can register — https://notlocalhost — drove the browser sitting on this machine.
// A suffix is not a host.

test('a lookalike host and an ordinary site are both refused', async () => {
  const { port } = await bridgeAddress();

  assert.notEqual(await upgradeStatus(port, 'https://notlocalhost'), 101, 'a suffix is not a host');
  assert.notEqual(await upgradeStatus(port, 'https://example.com'), 101, 'a site is not a client');
  assert.notEqual(await upgradeStatus(port, 'chrome-extension://someotherextensionid'), 101,
    'another extension is not this one');
});

// WHY a taken port is named and never poisons.
// Two sessions on one machine fight over the same loopback port, and the loser used to fail with a bare system error while keeping the dead server — so freeing the port healed nothing.
// The name tells the loser what happened; forgetting the dead server lets the next try listen.
// The name now says the holder is not a bridge, which is the only case that still refuses: a real bridge next door is adopted, not fought over.

test('a port held by something that is not a bridge is named, and freeing it heals the next try', async () => {
  const squatter = createServer((req, res) => res.end());
  await new Promise((resolve) => squatter.listen(0, '127.0.0.1', resolve));
  const taken = squatter.address().port;
  process.env.OPERA_BRIDGE_PORT = String(taken);
  try {
    await assert.rejects(() => bridgeAddress(), /held by another process that is not a bridge/);
  } finally {
    await new Promise((resolve) => squatter.close(resolve));
    process.env.OPERA_BRIDGE_PORT = '0';
  }
  const { port } = await bridgeAddress();
  assert.ok(port > 0, 'the next try listened instead of reusing the dead server');
});

// WHY the trust is observed through pings, not time.
// A clock assertion would be flaky under load; the ping count is exact: one proof costs exactly one ping against a healthy device, and a trusted call costs none.

test('a trusted window skips the proof ping, and zero trust proves every call', async () => {
  const device = await startDevice(() => [{ id: 7, url: 'https://x/', title: 'X' }]);
  const previous = process.env.OPERA_BRIDGE_TRUST_MS;
  try {
    delete process.env.OPERA_BRIDGE_TRUST_MS;
    await listBridgeTargets();
    await listBridgeTargets();
    assert.equal(device.pings(), 2, 'without trust every call proves');

    process.env.OPERA_BRIDGE_TRUST_MS = '50';
    await sleep(80);
    await listBridgeTargets();
    assert.equal(device.pings(), 3, 'an expired window proves again');
    await listBridgeTargets();
    assert.equal(device.pings(), 3, 'a trusted call sends no ping');
  } finally {
    if (previous === undefined) delete process.env.OPERA_BRIDGE_TRUST_MS;
    else process.env.OPERA_BRIDGE_TRUST_MS = previous;
  }
});

// WHY THE PORT CONFLICT HAS TO BE LOUD.
// A live extension was once sent silently back to the debugging port, because the real cause was not a missing extension but another process holding the loopback port.
// The drive carried on against a profile with nothing signed in, with no sign of why — which is the exact stuck-with-no-explanation this file exists to prevent.
// Adopting a real bridge does not weaken it: adoption is proven only against a server that answers as a bridge, so a stranger on the port is still refused.

test('a port held by a stranger is named, not swallowed into a wrong pipe', async () => {
  const squatter = createServer((req, res) => res.end());
  await new Promise((resolve) => squatter.listen(0, '127.0.0.1', resolve));
  const taken = squatter.address().port;
  process.env.OPERA_BRIDGE_PORT = String(taken);
  try {
    await assert.rejects(() => bridgeReachable(), /held by another process that is not a bridge/,
      'a conflict must name itself instead of answering "no extension"');
  } finally {
    await new Promise((resolve) => squatter.close(resolve));
    process.env.OPERA_BRIDGE_PORT = '0';
  }
});

// WHY THE GUEST IS ASKED RATHER THAN REMEMBERED, PROVEN IN THE SAME TEST.
// Its link flag remembers the last word it heard, so a guest that trusted it would push a command into a bridge with no device behind it and hang until the command budget ran out.
// Asking turns that into the one sentence that names the real problem, now.

// WHY THE GUEST COMES BACK WITH THE DEVICE.
// The device reconnects and the guest's own answer was asked fresh, so the driver that adopted during the gap believes the bridge is gone for the rest of its life — and drives a debugging port nobody is signed into instead.

// WHY A SECOND DRIVER DRIVES THE SAME BROWSER.
// Two sessions on one machine each spawn their own driver, and only one of them can own the loopback port.
// The loser used to exit at startup with "another dev shim owns this machine", which took a whole session's tools down while a healthy bridge held the browser a second away.
// This drives the real thing: a bridge server with a scripted device behind it, reached only through the door.

test('a driver that loses the port adopts the bridge that won it', async () => {
  const owner = createBridgeServer({ port: 0, heartbeatMs: 50 });
  const { port } = await owner.listen();
  const device = scriptedDevice(`ws://127.0.0.1:${port}/`, () => [{ id: 11, url: 'https://y/', title: 'Y' }]);
  live.push(device);
  await device.connected;
  const until = Date.now() + 3000;
  while (!owner.linked() && Date.now() < until) await sleep(25);
  assert.equal(owner.linked(), true, 'the owner has a device');

  process.env.OPERA_BRIDGE_PORT = String(port);
  try {
    assert.equal(await bridgeReachable(), true, 'the loser sees the link the winner holds');
    const tabs = await listBridgeTargets();
    assert.deepEqual(tabs, [{ id: 11, url: 'https://y/', title: 'Y' }], 'and drives it');

    await device.stop();
    const started = Date.now();
    await assert.rejects(() => listBridgeTargets(), /extension is not connected|liveness proof/,
      'a dead device is named instead of waited out');
    assert.ok(Date.now() - started < 5000, 'and named without burning the command budget');

    const revived = scriptedDevice(`ws://127.0.0.1:${port}/`, () => [{ id: 12, url: 'https://z/', title: 'Z' }]);
    live.push(revived);
    await revived.connected;
    const until = Date.now() + 3000;
    while (!owner.linked() && Date.now() < until) await sleep(25);
    assert.equal(await bridgeReachable(), true, 'the guest sees the link come back');
    assert.deepEqual(await listBridgeTargets(), [{ id: 12, url: 'https://z/', title: 'Z' }], 'and drives again');
  } finally {
    await closeBridge();
    await owner.close();
    process.env.OPERA_BRIDGE_PORT = '0';
  }
});
