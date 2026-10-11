// @last-edited: 2026-10-11 UTC+7.
// @title: transport — the real WebSocket, browser discovery, and a bounded wait for a launch that is not up yet.
// @state: discovery reads the version endpoint; waiting retries and reports its budget; connecting fails rather than hanging.
// @dependencies: none.

// cdp.js is tested against a fake transport on purpose, which is what makes it
// checkable anywhere, but it also means nothing has yet run against a real
// browser. This file is that seam.
//
// The waiting matters more than it looks. A browser process exists well before
// its debugging port answers, so connecting once and reporting failure makes
// every cold start look broken, and the usual repair is a fixed sleep that is
// slow when the browser is quick and flaky when it is not. Polling to a deadline
// is fast and repeatable.
//
// The deadline message carries the port and the budget, because "the browser is
// slow" and "there is no browser" are different problems and the person
// installing this needs to be able to tell them apart.

const VERSION_PATH = '/json/version';

export async function discoverWebSocket(port, { fetch = globalThis.fetch } = {}) {
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}${VERSION_PATH}`);
  } catch (cause) {
    throw new Error(`Browser on port ${port} is not reachable: ${cause.message}`);
  }
  if (!response?.ok) {
    throw new Error(`Browser on port ${port} is not reachable: HTTP ${response?.status ?? 'none'}.`);
  }

  const body = await response.json();
  const url = body?.webSocketDebuggerUrl;
  if (!url) throw new Error(`Browser on port ${port} answered without a websocket url.`);
  return url;
}

export async function waitForBrowser(port, {
  timeoutMs = 10000,
  intervalMs = 100,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  fetch
} = {}) {
  const deadline = now() + timeoutMs;
  let lastError = null;

  for (;;) {
    try {
      return await discoverWebSocket(port, { fetch });
    } catch (error) {
      lastError = error;
    }
    if (now() >= deadline) {
      throw new Error(`No browser answered port ${port} within ${timeoutMs}ms. ${lastError?.message ?? ''}`.trim());
    }
    await sleep(intervalMs);
  }
}

export function connect(url, { Socket = globalThis.WebSocket, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new Socket(url);
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch {}
      reject(new Error(`Could not connect to ${url} within ${timeoutMs}ms.`));
    }, timeoutMs);

    socket.onerror = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Could not connect to ${url}: ${event?.message || 'socket error'}`));
    };

    socket.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const transport = {
        send: (raw) => socket.send(raw),
        onMessage: (fn) => { socket.onmessage = (event) => fn(event?.data ?? event); },
        close: () => socket.close()
      };
      resolve(transport);
    };
  });
}

export async function discoverPageWebSocket(port, { fetch = globalThis.fetch } = {}) {
  let list = [];
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (response?.ok) list = await response.json();
  } catch (cause) {
    throw new Error(`Browser on port ${port} is not reachable: ${cause.message}`);
  }

  let page = (list || []).find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
  if (!page) {
    const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    if (!created?.ok) throw new Error(`Browser on port ${port} would not open a page to drive.`);
    page = await created.json();
  }

  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`Browser on port ${port} has no page target with a websocket url.`);
  }
  return page.webSocketDebuggerUrl;
}

// Opening a tab is the one thing a drive must never do to the person using the
// browser: navigating the page they already had open destroys whatever they were
// looking at. A new target leaves that page alone. The endpoint takes PUT and
// refuses GET, so a driver built on GET reports every open as a failure.

export async function openTabWebSocket(port, url, { fetch = globalThis.fetch } = {}) {
  let created;
  try {
    created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  } catch (cause) {
    throw new Error(`Browser on port ${port} is not reachable: ${cause.message}`);
  }
  if (!created?.ok) {
    throw new Error(`Browser on port ${port} would not open a tab: HTTP ${created?.status ?? 'none'}.`);
  }

  const page = await created.json();
  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`Browser on port ${port} opened a tab without a websocket url.`);
  }
  return page.webSocketDebuggerUrl;
}

export async function waitForPage(port, options = {}) {
  const { timeoutMs = 10000, intervalMs = 100, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), fetch } = options;
  const deadline = now() + timeoutMs;
  let lastError = null;

  for (;;) {
    try {
      return await discoverPageWebSocket(port, { fetch });
    } catch (error) {
      lastError = error;
    }
    if (now() >= deadline) {
      throw new Error(`No browser answered port ${port} within ${timeoutMs}ms. ${lastError?.message ?? ''}`.trim());
    }
    await sleep(intervalMs);
  }
}

export async function attachToBrowser(port, { timeoutMs = 10000, Socket, fetch } = {}) {
  const url = await waitForBrowser(port, { timeoutMs, fetch });
  const transport = await connect(url, { Socket });
  return { url, transport };
}

export async function attachToPage(port, { timeoutMs = 10000, Socket, fetch } = {}) {
  const url = await waitForPage(port, { timeoutMs, fetch });
  const transport = await connect(url, { Socket });
  return { url, transport };
}