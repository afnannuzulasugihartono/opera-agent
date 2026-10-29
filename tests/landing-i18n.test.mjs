// @last-edited: 2026-10-26 UTC+7.
// @title: landing-i18n — the shared toggle swaps English on, and only on, the pages that carry a dict.
// @state: 12 locks; the mechanism file is executed against a stub DOM, the pages are read as source.
// @dependencies: test, assert, fs, vm.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

const TOGGLE = '<span class="lang" data-lang-toggle></span>';

const DICT_PAGES = [
  'beranda.html',
  'unduh.html',
  'unduh-berkas.html',
  'fitur.html',
  'dukungan.html',
  '404.html',
  'privasi.html',
  'syarat.html',
  'index.html'
];
const TOGGLE_PAGES = [
  ...DICT_PAGES,
  'akun.html',
  'dashboard.html',
  'oauth/consent.html'
];

function attrKeys(page) {
  const html = read(`landing/${page}`);
  const marked = [...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map((m) => m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const part of m[1].split(';')) {
      const sep = part.indexOf(':');
      if (sep <= 0) continue;
      const key = part.slice(sep + 1).trim();
      if (key) marked.push(key);
    }
  }

  for (const m of html.matchAll(/(?:[^A-Za-z0-9_$])t\(\s*['"]([^'"]+)['"]/g)) {
    marked.push(m[1]);
  }
  return marked;
}

function pageDict(page) {
  const html = read(`landing/${page}`);
  const body = /<script type="application\/json" id="i18n-dict">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(body, `${page} carries its dict in the i18n-dict script`);
  return JSON.parse(body);
}

test('every marked string has English, and no dict carries a string nothing marks', () => {
  for (const page of DICT_PAGES) {
    const parsed = pageDict(page);
    assert.deepEqual(Object.keys(parsed), ['en'], `${page} dict carries English only; Indonesian stays authored`);

    const marked = [...new Set(attrKeys(page))].sort();
    const translated = Object.keys(parsed.en).sort();
    assert.ok(marked.length > 0, `${page} marks strings for translation`);
    assert.deepEqual(marked, translated, `${page}: marked keys and dict keys are the same set`);
  }
});

test('the pages without a dict mark nothing, so no toggle promises what is not there', () => {
  for (const page of ['akun.html', 'dashboard.html', 'oauth/consent.html']) {
    assert.doesNotMatch(read(`landing/${page}`), /i18n-dict/, `${page} carries no dict`);
    assert.deepEqual(attrKeys(page), [], `${page} marks no string without a dict to translate it`);
    assert.match(read(`landing/${page}`), /<script src="(?:\.\.?\/|\/)i18n\.js"><\/script>/, `${page} loads the mechanism so its toggle paints and persists`);
  }
});

test('the toggle is one identical mount on every page that may carry it', () => {
  for (const page of TOGGLE_PAGES) {
    const html = read(`landing/${page}`);
    const nav = html.match(/<nav>[\s\S]*?<\/nav>/)[0];
    assert.ok(nav.includes(TOGGLE), `${page} carries the mount inside its nav`);

    const count = html.split(TOGGLE).length - 1;
    assert.equal(count, 1, `${page} carries it exactly once`);
    assert.doesNotMatch(nav, /<button[^>]*data-lang=/, `${page} lets the mechanism build the buttons instead of copying them`);
  }
});

test('the toggle announces the text it shows, so the eye and the ear hear the same control', () => {
  // WHY THE VISIBLE TEXT MUST SIT INSIDE THE ACCESSIBLE NAME.
  // Lighthouse measured label-content-name-mismatch on 2026-10-26: the ID button's name was "Bahasa Indonesia" while its face says "ID", so a screen reader announced a different control from the one on screen.
  // The rule is a substring rule, and it also makes voice control work: "click ID" only lands if "ID" is part of the name.
  // The name is built beside the text, so no page can carry one without the other; every page that loads the mechanism is walked, not a hand-kept list.

  const pages = fs.readdirSync(new URL('landing/', root), { recursive: true })
    .map((name) => String(name).replaceAll('\\', '/'))
    .filter((name) => name.endsWith('.html'))
    .sort();
  assert.ok(pages.includes('oauth/consent.html'), 'the nested consent page is in scope');

  let mounts = 0;
  for (const page of pages) {
    const html = read(`landing/${page}`);
    const carries = html.includes(TOGGLE);
    assert.equal(carries, /i18n\.js/.test(html), `${page}: the mount and the mechanism arrive together`);
    if (carries) mounts += 1;
  }
  assert.ok(mounts >= TOGGLE_PAGES.length, 'every page that carries the toggle was walked');

  const run = runMechanism({ withHead: true });
  assert.equal(run.buttons.length, 2, 'the mechanism builds one button per language');
  for (const button of run.buttons) {
    const visible = button.textContent;
    const label = button.getAttribute('aria-label');
    const lang = button.getAttribute('data-lang');
    assert.ok(visible.trim(), `the ${lang} button shows text`);
    assert.ok(label.includes(visible), `the ${lang} label "${label}" contains the visible "${visible}"`);
    assert.match(label, lang === 'id' ? /Bahasa Indonesia/ : /English/, `the ${lang} label names the language in full`);
  }
});

test('the mechanism phones nowhere, ever', () => {
  assert.doesNotMatch(read('landing/i18n.js'), /fetch|XMLHttpRequest|sendBeacon|WebSocket/, 'no network call in the shared file');
});

test('the authored Indonesian stands byte-for-byte where the pins read it', () => {
  const sentinels = [
    [
      'landing/beranda.html',
      'Hak cipta dilindungi'
    ],
    [
      'landing/beranda.html',
      'Jembatan MCP aman'
    ],
    [
      'landing/beranda.html',
      'Bawa model Anda'
    ],
    [
      'landing/unduh-berkas.html',
      'Kalau kebijakan ditolak'
    ],
    [
      'landing/404.html',
      'Lima jalan keluar'
    ],
    [
      'landing/dukungan.html',
      'Menghubungkan AI harness (OpenCode, Kilo, ChatGPT, Claude)'
    ],
    [
      'landing/fitur.html',
      'Companion dengan AI di belakangnya'
    ],
  ];
  for (const [page, sentinel] of sentinels) {
    assert.ok(read(page).includes(sentinel), `${page} still carries ${JSON.stringify(sentinel)}`);
  }
});

function runMechanism({
  stored = null,
  dict = { en: {
    greeting: 'Hello',
    ph: 'Write here'
  } },
  readyState = 'complete',
  storageThrows = false,
  withHead = false
} = {}) {
  const store = stored === null ? {} : { 'oa-lang': stored };
  const listeners = {};
  const element = (
    tag,
    attrs,
    textContent
  ) => ({
    tag,
    textContent,
    innerHTML: textContent,
    attrs: { ...attrs },
    handlers: {},
    children: [],
    getAttribute(key) {
      return this.attrs[key];
    },
    setAttribute(
      key,
      value
    ) {
      this.attrs[key] = String(value);
    },
    addEventListener(
      event,
      handler
    ) {
      this.handlers[event] = handler;
    },
    appendChild(child) {
      this.children.push(child);
    },
  });
  const nodes = [
    element('p', { 'data-i18n': 'greeting' }, 'Halo'),
    element('p', { 'data-i18n': 'missing' }, 'Tetap')
  ];
  const rich = [element('p', { 'data-i18n-html': 'rich' }, 'Baca <a href="./x.html">panduan</a> dulu.')];
  const attributed = [
    element('input', {
      'data-i18n-attr': 'placeholder:ph',
      placeholder: 'Tulis di sini'
    }, ''),
    element('input', {
      'data-i18n-attr': 'placeholder:missing',
      placeholder: 'Tetap di sini'
    }, ''),
  ];
  const mount = element('span', {
    class: 'lang',
    'data-lang-toggle': ''
  }, '');
  const buttons = () => mount.children.filter((child) => child.attrs['data-lang']);
  const dictNode = { textContent: JSON.stringify(dict) };
  const head = {
    children: [],
    appendChild(child) {
      this.children.push(child);
    }
  };
  const documentStub = {
    readyState,
    documentElement: { lang: 'id' },
    getElementById: (id) => (id === 'i18n-dict' ? dictNode : null),
    createElement: (tag) => element(tag, {}, ''),
    querySelectorAll: (selector) => {
      if (selector === '[data-i18n]') return nodes;
      if (selector === '[data-i18n-html]') return rich;
      if (selector === '[data-i18n-attr]') return attributed;
      if (selector === '[data-lang-toggle]') return [mount];
      if (selector === 'button[data-lang]') return buttons();
      return [];
    },
    addEventListener: (
      event,
      handler
    ) => {
      listeners[event] = handler;
    },
  };
  if (withHead) {
    documentStub.head = head;
  }
  const context = vm.createContext({
    console,
    JSON,
    Map,
    localStorage: storageThrows
      ? {
        getItem() {
          throw new Error('denied');
        },
        setItem() {
          throw new Error('denied');
        }
      }
      : {
        getItem: (key) => (key in store ? store[key] : null),
        setItem: (
          key,
          value
        ) => {
          store[key] = String(value);
        },
      },
    document: documentStub,
    window: {},
  });
  vm.runInContext(read('landing/i18n.js'), context, { filename: 'i18n.js' });
  return {
    api: context.window.OperaAgentI18n,
    nodes,
    rich,
    attributed,
    mount,
    store,
    listeners,
    head,
    document: context.document,
    get buttons() {
      return buttons();
    },
    click: (button) => button.handlers.click.call(button),
  };
}

test('a stored choice swaps on load, presses its button, and never blanks a missing key', () => {
  const run = runMechanism({ stored: 'en' });
  assert.equal(run.nodes[0].textContent, 'Hello', 'a keyed string swaps');
  assert.equal(run.nodes[1].textContent, 'Tetap', 'a missing key leaves the authored text');
  assert.equal(run.document.documentElement.lang, 'en', 'the document language follows');
  assert.equal(run.buttons[0].attrs['aria-pressed'], 'false', 'the idle button unpresses');
  assert.equal(run.buttons[1].attrs['aria-pressed'], 'true', 'the active button presses');
  assert.equal(run.api.getLang(), 'en', 'the helper reports the choice');
  assert.equal(run.api.t('greeting'), 'Hello', 'and translates through it');
  assert.equal(run.api.t('missing'), 'missing', 'falling back to the key itself');

  run.click(run.buttons[0]);
  assert.equal(run.nodes[0].textContent, 'Halo', 'choosing Indonesian restores the authored text');
  assert.equal(run.document.documentElement.lang, 'id', 'and the document language with it');
  assert.equal(run.buttons[0].attrs['aria-pressed'], 'true', 'pressing follows the swap back');
  assert.equal(run.store['oa-lang'], 'id', 'the choice persists without a reload anywhere in the file');
  assert.doesNotMatch(read('landing/i18n.js'), /location\.reload|location\.assign|location\.href/, 'no reload call exists to make');

  run.click(run.buttons[1]);
  assert.equal(run.nodes[0].textContent, 'Hello', 'choosing English swaps again');
  assert.equal(run.store['oa-lang'], 'en', 'and persists again');
  assert.equal(run.api.getLang(), 'en');
});

test('without a stored choice the page renders Indonesian, even with storage denied', () => {
  const fresh = runMechanism({});
  assert.equal(fresh.nodes[0].textContent, 'Halo', 'the authored text renders untouched');
  assert.equal(fresh.document.documentElement.lang, 'id');
  assert.equal(fresh.buttons[0].attrs['aria-pressed'], 'true', 'Indonesian presses by default');
  assert.equal(fresh.api.getLang(), 'id');

  const denied = runMechanism({
    stored: 'en',
    storageThrows: true
  });
  assert.equal(denied.nodes[0].textContent, 'Halo', 'a denied read falls back instead of throwing');
  assert.equal(denied.api.getLang(), 'id');

  denied.api.setLang('en');
  assert.equal(denied.nodes[0].textContent, 'Hello', 'a denied write still swaps for this load');
  denied.api.setLang('fr');
  assert.equal(denied.api.getLang(), 'id', 'an unknown language normalises to Indonesian');
});

test('while the document still parses, the helper exists and the swap waits for it', () => {
  const run = runMechanism({
    stored: 'en',
    readyState: 'loading'
  });
  assert.ok(run.api, 'modules can call the helper before the document finishes');
  assert.equal(run.nodes[0].textContent, 'Halo', 'nothing swaps against a half-parsed page');

  run.listeners.DOMContentLoaded();
  assert.equal(run.nodes[0].textContent, 'Hello', 'the full page swaps once it exists');
  assert.equal(run.document.documentElement.lang, 'en');
  assert.equal(run.buttons.length, 2, 'the control is built');
  run.listeners.DOMContentLoaded();
  assert.equal(run.buttons.length, 2, 'a second event does not build it again');
});

test('a mixed paragraph swaps its markup and swaps it back, never blanking', () => {
  const authored = 'Baca <a href="./x.html">panduan</a> dulu.';
  const run = runMechanism({
    stored: 'en',
    dict: { en: {
      greeting: 'Hello',
      rich: 'Read the <a href="./x.html">guide</a> first.'
    } }
  });
  assert.equal(run.rich[0].innerHTML, 'Read the <a href="./x.html">guide</a> first.', 'the markup swaps with its links intact');

  run.click(run.buttons[0]);
  assert.equal(run.rich[0].innerHTML, authored, 'choosing Indonesian restores the authored markup');

  const missing = runMechanism({ stored: 'en' });
  assert.equal(missing.rich[0].innerHTML, authored, 'a missing key leaves the authored markup');
});

test('a placeholder swaps through its attribute and swaps back, never blanking', () => {
  const run = runMechanism({ stored: 'en' });
  assert.equal(run.attributed[0].attrs.placeholder, 'Write here', 'a keyed placeholder swaps');
  assert.equal(run.attributed[1].attrs.placeholder, 'Tetap di sini', 'a missing key leaves the authored placeholder');

  run.click(run.buttons[0]);
  assert.equal(run.attributed[0].attrs.placeholder, 'Tulis di sini', 'choosing Indonesian restores the authored placeholder');

  run.click(run.buttons[1]);
  assert.equal(run.attributed[0].attrs.placeholder, 'Write here', 'choosing English swaps again');
});

test('the toggle paints itself once, stays reachable, and presses the active language', () => {
  const run = runMechanism({
    stored: 'en',
    withHead: true
  });
  assert.equal(run.head.children.length, 1, 'one stylesheet is injected');
  const paint = run.head.children[0];
  assert.equal(paint.tag, 'style', 'it is a style element');
  assert.match(paint.textContent, /\.lang/, 'it paints the shared control');
  assert.match(paint.textContent, /aria-pressed/, 'the pressed button reads pressed');
  assert.doesNotMatch(paint.textContent, /@keyframes|transition|animation/, 'with no motion anywhere in it');
  assert.equal(run.buttons.length, 2, 'both buttons stay reachable');
  assert.equal(run.buttons[0].attrs['aria-pressed'], 'false', 'the idle button unpresses');
  assert.equal(run.buttons[1].attrs['aria-pressed'], 'true', 'the active button presses');

  const bare = runMechanism({ stored: 'en' });
  assert.equal(bare.nodes[0].textContent, 'Hello', 'without a head the swap still runs');
});
