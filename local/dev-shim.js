// @last-edited: 2026-10-21 UTC+7.
// @title: dev-shim — the stdio proxy that swaps the worker behind the pipe without dropping the client.
// @state: the supervisor, the rebuild budget, and the notification that tells the client its tools moved.
// @dependencies: none.

// WHY A PROXY AND NOT A RESTART.
// The client owns the pipe and does not reconnect: killing the server to reload its code leaves a dead MCP behind a human round trip.
// The shim keeps one pipe for the whole session and swaps the worker behind it, so a file save costs a second of reload instead of a toggle.
// Development only; production spawns the worker directly.

// WHY THE SHIM PARSES ONLY IDS.
// It forwards bytes it never interprets, except to learn which responses settle which requests: that table is what lets a swap wait for the in-flight instead of dropping it, and fail it by name when the wait runs out.
// Anything unparsable forwards blind in both directions.

// WHY INITIALIZE IS REPLAYED.
// The client shakes hands once, with whichever worker was alive first.
// The replay hands the stored handshake to the new worker and swallows its answer, so the client never sees a second hello.

// WHY A CRASHED WORKER IS REBUILT WITH A BUDGET, AND WHY THE BUDGET DOES NOT KILL THE CONNECTION.
// A worker that dies on its own comes back, because transient deaths happen; past three rebuilds in thirty seconds it is poisoned — a syntax error restarts forever.
// The old answer was to end the shim, which handed the client a dead MCP and flipped its switch off: a person editing code watched the server toggle itself off, and the only way back was a manual toggle.
// So a poisoned worker now answers every request by name and keeps the pipe open.
// Nothing is hidden — every call says the worker is broken — and the client stays connected, so saving a fix brings the tools back on its own.

// WHY A RELOAD TELLS THE CLIENT ITS TOOLS MOVED.
// The client caches the tool list from the handshake, so a new tool stayed invisible until somebody toggled the server by hand — the exact round trip the shim was built to remove.
// The protocol has a notification for exactly that, and the shim is the only party that knows a swap happened, so the shim sends it.

// WHY NO SINGLETON LOCK SURVIVES HERE.
// One shim per machine was enforced by an atomic PID file, and the second shim was told to exit — which took a whole session's tools down while a healthy bridge sat one port away holding the browser.
// The bridge is now shareable (a driver that loses the port adopts the one that won it), so there is nothing left to enforce and nothing left to WHY THE WAIT ASKS A QUESTION.
// The flag is set by the stop handler, a different closure, and a loop that reads it directly reads a variable nothing in the loop can change - which is true of the code and still reads as a loop that cannot end.
// Asking keeps both: the stop handler still ends the wait, and the reader can see what the loop is waiting for.
// refuse: two shims, two sets of tools, one signed-in browser.

const TOOLS_CHANGED = JSON.stringify({
  jsonrpc: '2.0',
  method: 'notifications/tools/list_changed'
});

export function createSupervisor({
  spawnWorker,
  watchFiles,
  input,
  output,
  log = () => {},
  now = () => Date.now(),
  settleMs = 5000,
  debounceMs = 300,
  maxRespawns = 3,
  respawnWindowMs = 30000
} = {}) {
  let child = null;
  let watcher = null;
  let swapping = false;
  let stopped = false;
  let dirty = false;
  let poisoned = null;
  let initLine = null;
  let replayId = null;
  let queue = [];
  let debounceTimer = null;
  const pending = new Set();
  const deaths = [];

  const methodOf = (line) => {
    try {
      return JSON.parse(line).method ?? null;
    } catch {
      return null;
    }
  };

  const idOf = (line) => {
    try {
      const parsed = JSON.parse(line);
      return parsed && (typeof parsed.id === 'string' || typeof parsed.id === 'number') ? parsed.id : null;
    } catch {
      return null;
    }
  };

  const splitter = (onLine) => {
    let rest = '';
    return (chunk) => {
      rest += String(chunk);
      const lines = rest.split('\n');
      rest = lines.pop();
      for (const line of lines) onLine(line);
    };
  };

  const send = (line) => {
    if (child) child.stdin.write(`${line}\n`);
  };

  const forwardToClient = (line) => {
    output.write(`${line}\n`);
  };

  const failPending = (message) => {
    for (const id of [...pending]) {
      pending.delete(id);
      forwardToClient(JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message
        }
      }));
    }
  };

  const replayInit = () => {
    if (!initLine) return;
    replayId = idOf(initLine);
    send(initLine);
  };

  const onClientLine = (line) => {
    const text = line.trim();
    if (!text) return;
    if (poisoned) {
      const id = idOf(text);
      if (id !== null) {
        forwardToClient(JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32000,
            message: poisoned
          }
        }));
      }
      return;
    }
    if (swapping) {
      queue.push(text);
      return;
    }
    const id = idOf(text);
    if (id !== null) pending.add(id);
    if (methodOf(text) === 'initialize') initLine = text;
    send(text);
  };

  const onChildLine = (line) => {
    const text = line.trim();
    if (!text) return;
    const id = idOf(text);
    if (id !== null) {
      pending.delete(id);
      if (replayId !== null && id === replayId) {
        replayId = null;
        return;
      }
    }
    forwardToClient(text);
  };

  const killChild = () => new Promise((resolve) => {
    const dying = child;
    child = null;
    if (!dying) return resolve();
    dying.on('exit', () => resolve());
    try {
      dying.kill();
    } catch {
      resolve();
      return;
    }
    setTimeout(() => {
      try {
        dying.kill('SIGKILL');
      } catch {}
      resolve();
    }, 2000);
  });

  const noteDeath = () => {
    const at = now();
    deaths.push(at);
    while (deaths.length > 0 && deaths[0] < at - respawnWindowMs) deaths.shift();
  };

  const startChild = () => {
    const mine = spawnWorker();
    child = mine;
    if (typeof mine.stdout.setEncoding === 'function') mine.stdout.setEncoding('utf8');
    mine.stdout.on('data', splitter(onChildLine));
    mine.on('error', () => {
      if (child === mine) onChildExit('spawn-error');
    });
    mine.on('exit', (code) => {
      if (child === mine) onChildExit(code);
    });
  };

  const onChildExit = (code) => {
    if (stopped) return;
    child = null;
    failPending('dev server worker died, retry');
    noteDeath();
    if (deaths.length > maxRespawns) {
      poisoned = `the dev worker keeps dying (${deaths.length} times in ${respawnWindowMs} ms) — save a file to rebuild it`;
      log(poisoned);
      return;
    }
    log(`worker exited (${code ?? 'signal'}), rebuilding`);
    startChild();
    replayInit();
  };

  const reload = async () => {
    if (stopped || swapping) return;
    poisoned = null;
    swapping = true;
    queue = [];
    log('files changed, swapping worker');

    const deadline = now() + settleMs;

    const waiting = () => pending.size > 0 && now() < deadline && !stopped;
    while (waiting()) {
      await new Promise((r) => setTimeout(r, 25));
    }
    failPending('dev server reloaded, retry');
    await killChild();
    if (stopped) return;
    startChild();
    replayInit();
    forwardToClient(TOOLS_CHANGED);
    const held = queue;
    queue = [];
    swapping = false;
    for (const line of held) onClientLine(line);
    if (dirty && !stopped) {
      dirty = false;
      scheduleReload();
    }
  };

  const scheduleReload = () => {
    if (stopped) return;
    if (swapping) {
      dirty = true;
      return;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(reload, debounceMs);
  };

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(debounceTimer);
    try {
      watcher.close();
    } catch {}
    await killChild();
  };

  if (typeof input.setEncoding === 'function') input.setEncoding('utf8');
  input.on('data', splitter(onClientLine));
  startChild();
  try {
    watcher = watchFiles(scheduleReload);
  } catch (error) {
    log(`watch unavailable, serving without reload: ${error.message}`);
  }

  return { stop };
}
