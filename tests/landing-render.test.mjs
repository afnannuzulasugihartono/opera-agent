// @last-edited: 2026-10-05 15:55 UTC+7.
// @title: landing-render — both signed-in pages render their data, not just their markup.
// @state: 3 locks; the first one was red on the deployed site and found a live defect.
// @dependencies: node:test, node:assert, node:fs, node:vm.

// A page whose markup is perfect and whose script throws renders nothing. That is not
// hypothetical: Intl.RelativeTimeFormat.prototype.format() takes CLDR unit identifiers,
// so passing the Indonesian word "menit" throws at call time, and the deployed
// dashboard rendered zero device cards while its own status line said one was paired.
// A lock that reads the HTML cannot see that. This one executes each page's own module
// against a stub DOM and asserts the rendered output, because the failure mode is a
// silent empty list rather than a broken string.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');
const moduleOf = (name) => /<script type="module">([\s\S]*?)<\/script>/.exec(read(name))[1];

const TOKEN = 'test-access-token';
const USER = {
  id: '1ec02bc3-7c1b-45a2-b864-837e95ba3b24',
  email: 'afnan@example.com',
  last_sign_in_at: new Date(Date.now() - 3600_000).toISOString(),
  app_metadata: { provider: 'email', providers: ['email', 'google'] },
  user_metadata: { full_name: 'Afnan Nuzula Sugihartono', name: 'Afnan Nuzula Sugihartono', avatar_url: 'https://example.com/a.png' }
};
const DEVICE = {
  id: '47045394-b983-4299-a5de-ba6e4b64270d',
  name: 'opera',
  status: 'online',
  extensionVersion: '1.6.14',
  lastSeenAt: new Date(Date.now() - 7_200_000).toISOString(),
  completedCommands: 8970,
  totalCommands: 9000,
  commands: [{ method: 'tabs.list', status: 'completed' }]
};

// Run a page's module against a stub DOM and a stub network, and report both what it
// rendered and anything it rejected, because an unhandled rejection is the bug.
async function run(page, { devices = [DEVICE] } = {}) {
  const nodes = {};
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason?.message || String(reason));
  process.on('unhandledRejection', onRejection);
  const node = (id) => (nodes[id] ||= {
    id,
    textContent: '',
    innerHTML: '',
    className: '',
    value: '',
    disabled: false,
    title: '',
    hidden: false,
    dataset: {},
    children: { length: 0 },
    addEventListener() {},
    querySelectorAll: () => []
  });
  const context = vm.createContext({
    console, Intl, Date, JSON, Math, Number, String, Array, Object, RegExp, Error, setTimeout,
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: (key) => (key === 'opera-agent-access-token' ? TOKEN : null), removeItem() {} },
    location: { replace() {}, href: '' },
    confirm: () => true,
    document: { getElementById: node, querySelectorAll: () => [], querySelector: () => null, addEventListener() {} },
    fetch: async (url) => {
      if (url.includes('/auth/v1/user')) return { ok: true, json: async () => USER };
      if (url.includes('opera_my_devices')) return { ok: true, json: async () => ({ ok: true, devices }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, code: 'PAIRINGCODE', deviceName: 'opera' }) };
    }
  });
  context.globalThis = context;
  try {
    vm.runInContext(moduleOf(page), context, { filename: page });
    await new Promise((resolve) => setTimeout(resolve, 250));
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  return { nodes, rejections };
}

test('the dashboard renders a device card for a paired device', async () => {
  const { nodes, rejections } = await run('dashboard.html');
  assert.deepEqual(rejections, [], `the dashboard module rejected: ${rejections.join('; ')}`);
  assert.match(nodes.status.textContent, /1 device ter-pairing/, 'the status line counts the device');
  // WHY this assertion and not a count: the deployed bug produced a correct status line
  // with an empty list, because the throw happened while building the cards.
  assert.ok(nodes.devices.innerHTML.includes('opera'), 'the device name is rendered');
  assert.ok(nodes.devices.innerHTML.includes(DEVICE.id), 'the device id is rendered');
  assert.match(nodes.devices.innerHTML, /tabs\.list/, 'the recent commands are rendered');
  assert.match(nodes.devices.innerHTML, /Cabut device ini/, 'the revoke control is rendered');
});

test('the account page renders the identity facts', async () => {
  const { nodes, rejections } = await run('akun.html');
  assert.deepEqual(rejections, [], `the account module rejected: ${rejections.join('; ')}`);
  assert.equal(nodes.factEmail.textContent, 'afnan@example.com', 'the address is rendered');
  assert.equal(nodes.factProvider.textContent, 'Google', 'the resolved provider is rendered');
  assert.equal(nodes.factUserId.textContent, USER.id, 'the account id is rendered');
  assert.match(nodes.factLastSignIn.textContent, /jam|lama|detik|hari/, 'the last sign-in reads as relative Indonesian time');
  assert.match(nodes.deviceSummary.textContent, /1 device ter-pairing/, 'the device count is rendered');
});

test('relative time is formatted with CLDR units, which is what format() accepts', () => {
  // WHY the narrow test: format() rejects a localised unit name with "Invalid unit
  // argument", and only at call time, so a string comparison on the page would pass.
  const format = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });
  for (const unit of ['second', 'minute', 'hour', 'day', 'week', 'year']) {
    assert.doesNotThrow(() => format.format(-2, unit), `format() must accept the CLDR unit ${unit}`);
  }
  for (const page of ['akun.html', 'dashboard.html']) {
    const source = moduleOf(page);
    assert.doesNotMatch(source, /format\([^)]*'(?:detik|menit|jam|hari|minggu|bulan|tahun)'/, `${page} passes no Indonesian unit to format()`);
    assert.match(source, /'minute'/, `${page} uses the CLDR unit identifiers`);
  }
});