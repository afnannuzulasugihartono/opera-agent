// @last-edited: 2026-11-11 UTC+7.
// @title: browser-identity - the browser names itself, and the page copy agrees with the worker copy.
// @state: the family each signal answers, the device name a new device takes, and the classic script's answer for the same browsers.
// @dependencies: node:test, node:assert/strict, ../extension/lib/browser-id.js, ../extension/lib/agent-log.js.

// WHY THIS GATE EXISTS.
// Brave, Edge, Opera and Vivaldi all send a Chrome user agent, so a browser that reads only the string calls all of them Chrome.
// The dashboard then showed the same word for every device, and a person with two browsers could not tell which card was which.
// The detection therefore prefers what the browser publishes about itself, and this file pins the order and the answers.

// WHY THE PAGE COPY IS PINNED TOO.
// The page's copy lives inside a classic script that cannot import, so it is a second copy of the rules.
// Two copies are a drift waiting to happen, so this file runs both over the same browsers and fails when they answer differently.

import test from 'node:test';
import assert from 'node:assert/strict';

import { browserFamily, deviceNameFor } from '../../extension/lib/browser-id.js';

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
const withToken = (token) => `${CHROME_UA} ${token}`;

test('the browser that says so is believed before the string is read', () => {
  assert.equal(browserFamily({ brave: true, ua: CHROME_UA }), 'Brave', 'navigator.brave is the answer Brave gives');
  assert.equal(browserFamily({ brands: [{ brand: 'Brave' }], ua: CHROME_UA }), 'Brave', 'and so is its brand');
  assert.equal(browserFamily({ brands: [{ brand: 'Microsoft Edge' }], ua: CHROME_UA }), 'Edge');
  assert.equal(browserFamily({ brands: [{ brand: 'Chromium' }], ua: CHROME_UA }), 'Chromium');
});

test('the string answers for the browsers that hide themselves in the brand list', () => {
  assert.equal(browserFamily({ ua: withToken('Brave/1.62.3') }), 'Brave');
  assert.equal(browserFamily({ ua: withToken('Edg/153.0.0.0') }), 'Edge');
  assert.equal(browserFamily({ ua: withToken('OPR/116.0.0.0') }), 'Opera');
  assert.equal(browserFamily({ ua: withToken('Vivaldi/7.0.3538.5') }), 'Vivaldi');
  assert.equal(browserFamily({ ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0' }), 'Firefox');
  assert.equal(browserFamily({ ua: CHROME_UA }), 'Chrome');
  assert.equal(browserFamily({ ua: '' }), 'Unknown', 'a browser that says nothing is named Unknown, not Chrome');
});

test('a new device takes the browser name, in lower case', () => {
  assert.equal(deviceNameFor('Brave'), 'brave');
  assert.equal(deviceNameFor('Chrome'), 'chrome');
  assert.equal(deviceNameFor('Edge'), 'edge');
  assert.equal(deviceNameFor('Unknown'), 'browser', 'a browser with no name still gets a usable name');
  assert.equal(deviceNameFor('Not A Name'), 'browser', 'and a name that is not a name is refused');
});

test('the page copy answers the same as the worker copy', async () => {
  const cases = [
    { ua: CHROME_UA },
    { ua: withToken('Brave/1.62.3') },
    { ua: withToken('Edg/153.0.0.0') },
    { ua: withToken('OPR/116.0.0.0') },
    { ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0' }
  ];

  for (const { ua } of cases) {
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua }, configurable: true });
    delete globalThis.OperaAgentBrowserId;
    await import(`../../extension/lib/agent-log.js?ua=${encodeURIComponent(ua)}`);
    const fromPage = globalThis.OperaAgentBrowserId?.browserName;
    assert.equal(fromPage, browserFamily({ ua }), `both copies call ${ua.slice(-24)} the same browser`);
  }
});
