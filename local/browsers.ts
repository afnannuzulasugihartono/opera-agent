// @last-edited: 2026-11-14 UTC+7.
// @title: browsers - the Chromium browsers the local driver launches, where each lives, and the flags that make its port work.
// @state: seven Chromium browsers on one protocol; paths normalised so a caller's separator does not matter.
// @dependencies: node:fs.

// Scope is the Chromium family, and the reason is not tidiness: Chrome, Edge, Brave, Opera, Vivaldi and Chromium are one engine speaking one protocol, so one driver genuinely covers all seven.
// Firefox and Safari are deliberately absent rather than listed as partial.
// A browser named in a list is a promise, and a partial entry would still be a promise this driver does not keep yet.

// Path comparison is normalised because the caller does not control the separator it hands over: a config file on Windows carries forward slashes, the installed binary path carries backslashes, and a driver that compared them literally would report no browser on a machine that plainly has three.

// The launch flags are locked because getting them wrong is silent.
// A browser started against a profile that already has a running instance opens a second window and ignores the debugging port, and the only symptom is a connection refused with no hint as to why.

import { readdirSync } from 'node:fs';

const CHROMIUM_FLAGS = Object.freeze([
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding'
]);

export interface BrowserEntry {
  id: string;
  name: string;
  family: string;
  protocol: string;
  paths: Record<string, string[]>;
}

const browser = (id: string, name: string, paths: Record<string, string[]>): BrowserEntry => Object.freeze({ id, name, family: 'chromium', protocol: 'cdp', paths });

export const BROWSERS = Object.freeze([
  browser('chrome', 'Google Chrome', {
    win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      '%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe'],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser']
  }),
  browser('edge', 'Microsoft Edge', {
    win32: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'],
    darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    linux: ['/usr/bin/microsoft-edge']
  }),
  browser('brave', 'Brave', {
    win32: ['C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      '%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    darwin: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    linux: ['/usr/bin/brave-browser']
  }),
  browser('opera', 'Opera', {
    win32: ['C:\\Program Files\\Opera\\launcher.exe', '%LOCALAPPDATA%\\Programs\\Opera\\launcher.exe'],
    darwin: ['/Applications/Opera.app/Contents/MacOS/Opera'],
    linux: ['/usr/bin/opera']
  }),
  browser('vivaldi', 'Vivaldi', {
    win32: ['C:\\Program Files\\Vivaldi\\Application\\vivaldi.exe',
      '%LOCALAPPDATA%\\Vivaldi\\Application\\vivaldi.exe'],
    darwin: ['/Applications/Vivaldi.app/Contents/MacOS/Vivaldi'],
    linux: ['/usr/bin/vivaldi']
  }),
  browser('chromium', 'Chromium', {
    win32: ['C:\\Program Files\\Chromium\\Application\\chrome.exe'],
    darwin: ['/Applications/Chromium.app/Contents/MacOS/Chromium'],
    linux: ['/usr/bin/chromium', '/usr/bin/chromium-browser']
  }),
  // Chrome for Testing has no installer and no canonical path: it is a set of pinned test binaries, usually unzipped somewhere the person keeping it decided - most commonly Playwright's cache (chromium-<rev>/chrome-win[64]) or a tool folder.
  // The wildcard covers any chromium-<rev> folder the person may have; the Google folder is the official zip unzipped by hand.
  browser('chromeForTesting', 'Chrome for Testing', {
    win32: [
      '%LOCALAPPDATA%\\ms-playwright\\chromium-*\\chrome-win64\\chrome.exe',
      '%LOCALAPPDATA%\\ms-playwright\\chromium-*\\chrome-win\\chrome.exe',
      '%LOCALAPPDATA%\\Google\\Chrome for Testing\\Application\\chrome.exe',
      '%LOCALAPPDATA%\\Google\\Chrome for Testing\\chrome.exe',
      'C:\\Program Files\\Google\\Chrome for Testing\\chrome.exe'
    ],
    darwin: ['/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      '/opt/google/chrome-for-testing/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'],
    linux: ['/usr/bin/chrome-for-testing', '/opt/google/chrome-for-testing/chrome', '%HOME%/.local/bin/chrome-for-testing/chrome']
  })
]);

const normalise = (value: unknown) => String(value).replace(/\\/g, '/').toLowerCase();

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const joinPath = (base: string, segment: string): string => `${base === '' || base.endsWith('/') ? base : `${base}/`}${segment}`;

// A segment carrying `*` is a one-level glob (`chromium-*`), because Chrome for Testing ships only as pinned zips addressed by their revision.
// Matching it needs the parent directory listing, not a static exists check, so the check walks the pattern segment by segment.

function globPathExists(pattern: string, exists: (path: string) => boolean, readdir: (path: string) => import('node:fs').Dirent[]): boolean {
  const posix = pattern.startsWith('/');
  const winDrive = /^[a-z]:[\\/]/i.test(pattern);
  if (!posix && !winDrive) return exists(pattern);
  const rest = posix ? pattern.slice(1) : pattern.slice(3);
  const segments = rest.split('/').filter((part) => part && part !== '.');
  let dirs = [posix ? '/' : pattern.slice(0, 2)];
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index] as string;
    const isLast = index === segments.length - 1;
    const next: string[] = [];
    if (segment.includes('*')) {
      const re = new RegExp('^' + segment.split('*').map(escapeRe).join('.*') + '$');
      for (const dir of dirs) {
        let entries: import('node:fs').Dirent[] = [];
        try { entries = readdir(dir); } catch { continue; }
        for (const entry of entries) if (re.test(entry.name) && (isLast || entry.isDirectory())) next.push(joinPath(dir, entry.name));
      }
    } else {
      for (const dir of dirs) next.push(joinPath(dir, segment));
    }
    dirs = next;
    if (dirs.length === 0) return false;
  }
  return dirs.some((path) => exists(path));
}

export function expandPath(path: unknown, env: NodeJS.ProcessEnv = process.env): string {
  return String(path).replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (whole: string, name: string) => {
    const value = env[name];
    return value === undefined || value === '' ? whole : value;
  });
}

const defaultReaddir = (path: string): import('node:fs').Dirent[] => readdirSync(path, { withFileTypes: true });

export function detectBrowsers({ platform, exists, env = process.env, readdir = defaultReaddir }: { platform: string; exists: (path: string) => boolean; env?: NodeJS.ProcessEnv; readdir?: (path: string) => import('node:fs').Dirent[] }): BrowserEntry[] {
  return BROWSERS.filter((entry) =>
    (entry.paths[platform] ?? []).some((path) => {
      const expanded = normalise(expandPath(path, env));
      if (expanded.includes('*')) return globPathExists(expanded, exists, readdir);
      return exists(expanded);
    })
  ).map((entry) => entry);
}

export function findBrowser(id: unknown): BrowserEntry | null {
  return BROWSERS.find((entry) => entry.id === id) || null;
}

export function protocolsFor(options: Parameters<typeof detectBrowsers>[0]): string[] {
  return [...new Set(detectBrowsers(options).map((entry) => entry.protocol))];
}

export function launchArgs({ browser: entry, port, userDataDir, extraArgs = [] }: { browser?: BrowserEntry | null; port: number; userDataDir: string; extraArgs?: string[] }): string[] {
  if (!entry) return [];

  return [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    ...CHROMIUM_FLAGS,
    ...extraArgs,
    'about:blank'
  ];
}