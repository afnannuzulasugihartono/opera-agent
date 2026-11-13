// @last-edited: 2026-10-11 UTC+7.
// @title: browsers — the Chromium browsers the local driver launches, where each lives, and the flags that make its port work.
// @state: six Chromium browsers on one protocol; paths normalised so a caller's separator does not matter.
// @dependencies: none.

// Scope is the Chromium family, and the reason is not tidiness: Chrome, Edge, Brave, Opera, Vivaldi and Chromium are one engine speaking one protocol, so one driver genuinely covers all six.
// Firefox and Safari are deliberately absent rather than listed as partial.
// A browser named in a list is a promise, and a partial entry would still be a promise this driver does not keep yet.

// Path comparison is normalised because the caller does not control the separator it hands over: a config file on Windows carries forward slashes, the installed binary path carries backslashes, and a driver that compared them literally would report no browser on a machine that plainly has three.

// The launch flags are locked because getting them wrong is silent.
// A browser started against a profile that already has a running instance opens a second window and ignores the debugging port, and the only symptom is a connection refused with no hint as to why.

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
  })
]);

const normalise = (value: unknown) => String(value).replace(/\\/g, '/').toLowerCase();

export function expandPath(path: unknown, env: NodeJS.ProcessEnv = process.env): string {
  return String(path).replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (whole: string, name: string) => {
    const value = env[name];
    return value === undefined || value === '' ? whole : value;
  });
}

export function detectBrowsers({ platform, exists, env = process.env }: { platform: string; exists: (path: string) => boolean; env?: NodeJS.ProcessEnv }): BrowserEntry[] {
  return BROWSERS.filter((entry) =>
    (entry.paths[platform] ?? []).some((path) => exists(normalise(expandPath(path, env))))
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