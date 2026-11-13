// @last-edited: 2026-10-11 UTC+7.
// @title: transport — the WebSocket the CDP client rides on, and the browser endpoints that hand it out.
// @state: discovery, a named page, a connect with a timeout, and a wait that refuses to report a browser it did not reach.
// @dependencies: node:none — fetch and WebSocket arrive from the platform.

// A CDP client is a request/response multiplexer over one socket.
// This file owns the socket half: one URL in, one transport out, with the timeout the driver relies on.
// Everything here is injectable, so the transport rules are checked without a browser installed.

import type { CdpTransport } from './cdp.js';
import type { JsonRecord } from './types.js';

// A page target as Chrome's /json endpoints answer it.
// Only the four fields this file reads are named; the rest of the answer is ignored on purpose.

export interface PageSocket {
  id: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
}

export interface FetchOptions {
  fetch?: typeof fetch;
}

export interface WaitOptions extends FetchOptions {
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
}

interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data?: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export interface ConnectOptions {
  Socket?: new (url: string) => SocketLike;
  timeoutMs?: number;
}

const VERSION_PATH = '/json/version';

export async function discoverWebSocket(port: number, { fetch = globalThis.fetch }: FetchOptions = {}) {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}${VERSION_PATH}`);
  } catch (cause: unknown) {
    throw new Error(`Browser on port ${port} is not reachable: ${String((cause as Error)?.message ?? cause)}`);
  }
  if (!response?.ok) {
    throw new Error(`Browser on port ${port} is not reachable: HTTP ${response?.status ?? 'none'}.`);
  }

  const body = (await response.json()) as JsonRecord;
  const url = body?.webSocketDebuggerUrl;
  if (!url) throw new Error(`Browser on port ${port} answered without a websocket url.`);
  return String(url);
}

// WHY THE TARGET MUST BE NAMED

// discoverPageWebSocket returns whichever page happens to be first, and a drive that targets "the first page" writes into whatever the person happens to have open.
// That is how a latency test once left a run of x characters in the title of an unrelated document.
// A tab is therefore chosen by id, or by asking, never by position.

export async function listPageWebSockets(port: number, { fetch = globalThis.fetch }: FetchOptions = {}): Promise<PageSocket[]> {
  let list: unknown[] = [];
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (response?.ok) list = (await response.json()) as unknown[];
  } catch (cause: unknown) {
    throw new Error(`Browser on port ${port} is not reachable: ${String((cause as Error)?.message ?? cause)}`);
  }

  return (list || [])
    .filter((entry): entry is JsonRecord => typeof entry === 'object' && entry !== null)
    .filter((entry) => entry.type === 'page' && Boolean(entry.webSocketDebuggerUrl))
    .map((entry) => ({
      id: String(entry.id ?? ''),
      url: String(entry.url ?? ''),
      title: String(entry.title ?? ''),
      webSocketDebuggerUrl: String(entry.webSocketDebuggerUrl)
    }));
}

export async function pageWebSocketById(port: number, targetId: unknown, options: FetchOptions = {}) {
  const pages = await listPageWebSockets(port, options);
  if (!pages.length) throw new Error(`Browser on port ${port} has no page target to drive.`);
  // pages[0]!: the length check above just proved one exists.
  if (targetId === undefined || targetId === null || targetId === '') {
    const firstPage = pages[0];
    if (firstPage === undefined) throw new Error('bridge: the browser has no page to drive');
    return { url: firstPage.webSocketDebuggerUrl, targetId: firstPage.id, pages };
  }

  const match = pages.find((page) => page.id === targetId);
  if (!match) {
    const known = pages.map((page) => `${page.id} ${page.title ?? ''}`.trim()).join(' | ');
    throw new Error(`No page target ${targetId}. Open pages: ${known}`);
  }
  return { url: match.webSocketDebuggerUrl, targetId: match.id, pages };
}

export async function waitForBrowser(port: number, {
  timeoutMs = 10000,
  intervalMs = 100,
  now = Date.now,
  sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  fetch = globalThis.fetch
}: WaitOptions = {}) {
  const deadline = now() + timeoutMs;
  let lastError: unknown = null;

  for (;;) {
    try {
      return await discoverWebSocket(port, { fetch });
    } catch (error: unknown) {
      lastError = error;
    }
    if (now() >= deadline) {
      throw new Error(`No browser answered port ${port} within ${timeoutMs}ms. ${String((lastError as Error)?.message ?? '')}`.trim());
    }
    await sleep(intervalMs);
  }
}

export function connect(url: string, { Socket = globalThis.WebSocket as unknown as new (url: string) => SocketLike, timeoutMs = 10000 }: ConnectOptions = {}): Promise<CdpTransport> {
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

      // The socket hands back a string; the CDP client parses it, so the frame is opaque here.
      const transport: CdpTransport = {
        send: (raw: string) => socket.send(raw),
        onMessage: (fn) => { socket.onmessage = (event) => fn((event?.data ?? event) as { id: unknown }); },
        close: () => socket.close()
      };
      resolve(transport);
    };
  });
}

export async function discoverPageWebSocket(port: number, { fetch = globalThis.fetch }: FetchOptions = {}) {
  let list: unknown[] = [];
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (response?.ok) list = (await response.json()) as unknown[];
  } catch (cause: unknown) {
    throw new Error(`Browser on port ${port} is not reachable: ${String((cause as Error)?.message ?? cause)}`);
  }

  let page = list
    .filter((entry): entry is JsonRecord => typeof entry === 'object' && entry !== null)
    .find((entry) => entry.type === 'page' && Boolean(entry.webSocketDebuggerUrl));
  if (!page) {
    const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    if (!created?.ok) throw new Error(`Browser on port ${port} would not open a page to drive.`);
    page = (await created.json()) as JsonRecord;
  }

  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`Browser on port ${port} has no page target with a websocket url.`);
  }
  return String(page.webSocketDebuggerUrl);
}

// Opening a tab is the one thing a drive must never do to the person using the browser: navigating the page they already had open destroys whatever they were looking at.
// A new target leaves that page alone.
// The endpoint takes PUT and refuses GET, so a driver built on GET reports every open as a failure.

export async function openTab(port: number, url: string, { fetch = globalThis.fetch }: FetchOptions = {}) {
  let created: Response;
  try {
    created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  } catch (cause: unknown) {
    throw new Error(`Browser on port ${port} is not reachable: ${String((cause as Error)?.message ?? cause)}`);
  }
  if (!created?.ok) {
    throw new Error(`Browser on port ${port} would not open a tab: HTTP ${created?.status ?? 'none'}.`);
  }

  const page = (await created.json()) as JsonRecord;
  if (!page?.webSocketDebuggerUrl || !page?.id) {
    throw new Error(`Browser on port ${port} opened a tab without an addressable target.`);
  }
  return { id: String(page.id), webSocketDebuggerUrl: String(page.webSocketDebuggerUrl) };
}

export async function closeTab(port: number, targetId: unknown, { fetch = globalThis.fetch }: FetchOptions = {}) {
  let closed: Response;
  try {
    closed = await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(String(targetId))}`, { method: 'PUT' });
  } catch (cause: unknown) {
    throw new Error(`Browser on port ${port} is not reachable: ${String((cause as Error)?.message ?? cause)}`);
  }
  if (!closed?.ok) {
    throw new Error(`Browser on port ${port} would not close tab ${String(targetId)}: HTTP ${closed?.status ?? 'none'}.`);
  }
  return { id: targetId, closed: true };
}

export async function waitForPage(port: number, options: WaitOptions = {}) {
  const { timeoutMs = 10000, intervalMs = 100, now = Date.now, sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)), fetch = globalThis.fetch } = options;
  const deadline = now() + timeoutMs;
  let lastError: unknown = null;

  for (;;) {
    try {
      return await discoverPageWebSocket(port, { fetch });
    } catch (error: unknown) {
      lastError = error;
    }
    if (now() >= deadline) {
      throw new Error(`No browser answered port ${port} within ${timeoutMs}ms. ${String((lastError as Error)?.message ?? '')}`.trim());
    }
    await sleep(intervalMs);
  }
}

export async function attachToPage(port: number, { timeoutMs = 10000, Socket, fetch }: ConnectOptions & WaitOptions = {}) {
  // exactOptionalPropertyTypes: an injected fetch or Socket is only forwarded when the caller supplied one.
  const url = await waitForPage(port, { timeoutMs, ...(fetch ? { fetch } : {}) });
  const transport = await connect(url, { timeoutMs, ...(Socket ? { Socket } : {}) });
  return { url, transport };
}
