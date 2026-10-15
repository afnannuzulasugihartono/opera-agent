// dev-shim — a stdio proxy that holds the client's pipe while the worker behind
// it restarts: edit, save, and the new code is live without a toggle.
//
// WHY A PROXY AND NOT A RESTART. The client owns the pipe and does not
// reconnect: killing the server to reload its code leaves a dead MCP behind a
// human round trip. The shim keeps one pipe for the whole session and swaps
// the worker behind it, so a file save costs a second of reload instead of a
// toggle. Development only; production spawns the worker directly.
//
// WHY THE SHIM PARSES ONLY IDS. It forwards bytes it never interprets, except
// to learn which responses settle which requests: that table is what lets a
// swap wait for the in-flight instead of dropping it, and fail it by name
// when the wait runs out. Anything unparsable forwards blind in both
// directions.
//
// WHY INITIALIZE IS REPLAYED. The client shakes hands once, with whichever
// worker was alive first. The replay hands the stored handshake to the new
// worker and swallows its answer, so the client never sees a second hello.
//
// WHY A CRASHED WORKER IS REBUILT WITH A BUDGET. A worker that dies on its own
// comes back, because transient deaths happen; past three rebuilds in thirty
// seconds the worker is poisoned — a syntax error restarts forever — so the
// shim ends loudly instead of hiding the crash in a respawn loop.

export function createSupervisor({
  spawnWorker,
  watchFiles,
  input,
  output,
  log = () => {},
  onDead = () => {},
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
      forwardToClient(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }));
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
      log(`worker died ${deaths.length} times in ${respawnWindowMs} ms, giving up`);
      onDead();
      return;
    }
    log(`worker exited (${code ?? 'signal'}), rebuilding`);
    startChild();
    replayInit();
  };

  const reload = async () => {
    if (stopped || swapping) return;
    swapping = true;
    queue = [];
    log('files changed, swapping worker');
    const deadline = now() + settleMs;
    while (pending.size > 0 && now() < deadline && !stopped) {
      await new Promise((r) => setTimeout(r, 25));
    }
    failPending('dev server reloaded, retry');
    await killChild();
    if (stopped) return;
    startChild();
    replayInit();
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
