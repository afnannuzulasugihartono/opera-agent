// @last-edited: 2026-10-11 UTC+7.
// @title: local-browsers — the Chromium browsers the local driver launches, where each lives, and that a stranger's machine resolves them.
// @state: 11 locks; one protocol across the family, environment expansion, separator-insensitive matching, and a launch that cannot be silently swallowed.
// @dependencies: node:test, strict, ../local/core/browsers.js.

// WHY THIS FILE EXISTS

// This driver is meant to be installed by people who have never seen this repository, on machines that were not part of any measurement.
// Two properties have to hold for that, and both failed the first time they were written.

// The first was the separator.
// The caller's config on Windows carries forward slashes; the installed binary path carries backslashes.
// Compared literally, the driver reported no browser at all on a machine that plainly had three.

// The second was the environment placeholder.
// Paths are listed as %LOCALAPPDATA% so they are not this machine's profile, but Node does not expand them, and an unexpanded placeholder is a path that exists nowhere on any machine.
// Expansion has to happen inside the module, because a caller who forgets it gets a silent miss rather than an error.

// Scope is the Chromium family and nothing else: Chrome, Edge, Brave, Opera, Vivaldi and Chromium are one engine speaking one protocol, so one driver genuinely covers all six.
// Firefox and Safari are absent rather than listed as partial, because a browser named in a list is a promise.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BROWSERS, detectBrowsers, expandPath, findBrowser, launchArgs, protocolsFor } from '../local/core/browsers.js';

test('the Chromium family is declared as one protocol, because it is one protocol', () => {
  assert.deepEqual(BROWSERS.map((b) => b.id).sort(),
    ['brave', 'chrome', 'chromium', 'edge', 'opera', 'vivaldi']);

  for (const entry of BROWSERS) {
    assert.equal(entry.protocol, 'cdp', `${entry.id} is Chromium and must speak cdp`);
    assert.equal(entry.full, undefined, `${entry.id} must not carry a partial-support flag`);
  }
});

test('every browser lists candidates for all three desktop platforms', () => {
  for (const entry of BROWSERS) {
    for (const platform of ['win32', 'darwin', 'linux']) {
      assert.ok(Array.isArray(entry.paths?.[platform]) && entry.paths[platform].length > 0,
        `${entry.id} has no ${platform} candidate`);
    }
  }
});

test('a %VAR% path is expanded before it is checked, because a caller cannot be trusted to expand it', () => {
  assert.equal(expandPath('%LOCALAPPDATA%/Google/Chrome/Application/chrome.exe',
    { LOCALAPPDATA: 'C:/Users/somebody/AppData/Local' }),
  'C:/Users/somebody/AppData/Local/Google/Chrome/Application/chrome.exe');
});

test('an unset variable is left visible rather than silently becoming an empty segment', () => {
  assert.equal(expandPath('%NOT_SET_ANYWHERE%/x', {}), '%NOT_SET_ANYWHERE%/x',
    'collapsing an unset variable would produce a path that could match the wrong binary');
});

test('matching survives a separator mismatch, because the caller does not control its separator', () => {
  const present = new Set(['c:/program files/google/chrome/application/chrome.exe']);
  const found = detectBrowsers({ platform: 'win32', env: {}, exists: (p) => present.has(p) });

  assert.deepEqual(found.map((b) => b.id), ['chrome'],
    'a caller holding a forward-slash path must still match a backslash path in the table');
});

test('detection returns the entry whose path resolved, not the raw candidate', () => {
  const found = detectBrowsers({
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:/Users/somebody/AppData/Local' },
    exists: (p) => p === 'c:/users/somebody/appdata/local/google/chrome/application/chrome.exe'
  });

  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'chrome');
  assert.equal(findBrowser(found[0].id), found[0], 'the detected entry must be the one launchArgs will be given');
});

test('detection on a machine with nothing installed returns an empty list rather than throwing', () => {
  assert.deepEqual(detectBrowsers({ platform: 'linux', env: {}, exists: () => false }), []);
});

test('a launch opens its own profile so an already-running browser cannot swallow the port', () => {
  const args = launchArgs({ browser: findBrowser('chrome'), port: 9333, userDataDir: '/tmp/oa' });

  assert.ok(args.includes('--remote-debugging-port=9333'));
  assert.ok(args.includes('--user-data-dir=/tmp/oa'), 'a shared profile makes the debugging port a no-op');
  assert.ok(args.some((a) => a.startsWith('--no-first-run')));
  assert.ok(args.some((a) => a.startsWith('--no-default-browser-check')));
});

test('launching an unknown browser yields no flags rather than half a command line', () => {
  assert.deepEqual(launchArgs({ browser: null, port: 9333, userDataDir: '/tmp/oa' }), []);
});

test('protocolsFor reports only what is actually installed, so a caller can refuse honestly', () => {
  assert.deepEqual(protocolsFor({ platform: 'win32', env: {}, exists: (p) => p.includes('chrome.exe') }), ['cdp']);
  assert.deepEqual(protocolsFor({ platform: 'win32', env: {}, exists: (p) => p.includes('brave.exe') }), ['cdp']);
  assert.deepEqual(protocolsFor({ platform: 'linux', env: {}, exists: () => false }), []);
});

test('a path in the table never names this machine, so the driver carries no local state', () => {
  for (const entry of BROWSERS) {
    for (const platform of ['win32', 'darwin', 'linux']) {
      for (const path of entry.paths[platform]) {
        assert.ok(!/ASUS|Users\\ASUS|opera-agent|opencode/i.test(path),
          `${entry.id} leaks a machine-specific path: ${path}`);
      }
    }
  }
});