// @last-edited: 2026-10-26 UTC+7.
// @title: i18n — one shared language swap for every page of the site.
// @state: classic script, zero dependencies; builds the toggle into its mount, reads oa-lang plus the page dict, swaps text and rich paragraphs, paints its own styles, never networks.
// @dependencies: none.

(function () {
  'use strict';

  var KEY = 'oa-lang';

  var LANGS = [
    {
      code: 'id',
      text: 'ID',
      name: 'Bahasa Indonesia'
    },
    {
      code: 'en',
      text: 'EN',
      name: 'English'
    }
  ];

  var CSS = '.lang{display:inline-flex;align-items:center;border:1px solid rgba(22,21,19,.14);border-radius:980px;padding:2px;white-space:nowrap}'
    + '.lang button{width:auto;margin:0;border:0;background:transparent;color:#64615a;font:inherit;font-size:11.5px;font-weight:600;line-height:1;padding:5px 9px;border-radius:980px;cursor:pointer}'
    + '.lang button:hover{color:#161513}'
    + '.lang button[aria-pressed="true"]{background:rgba(11,107,82,.1);color:#0b6b52}'
    + '.lang span[aria-hidden="true"]{display:none}';

  var painted = false;

  // WHY THE CONTROL IS BUILT HERE AND NOT COPIED INTO TWELVE PAGES.
  // The toggle was authored markup on every page, so its label had to be corrected page by page and the copies drifted.
  // One builder means one place defines the two buttons, their separator, and a name that contains the text a reader sees.

  function build() {
    var mounts = document.querySelectorAll('[data-lang-toggle]');

    for (var i = 0; i < mounts.length; i += 1) {
      var mount = mounts[i];

      if (mount.getAttribute('data-built') === 'true') continue;

      mount.setAttribute('data-built', 'true');

      for (var j = 0; j < LANGS.length; j += 1) {
        if (j > 0) {
          var bar = document.createElement('span');
          bar.setAttribute('aria-hidden', 'true');
          bar.textContent = '|';
          mount.appendChild(bar);
        }

        var button = document.createElement('button');
        button.setAttribute('type', 'button');
        button.setAttribute('data-lang', LANGS[j].code);
        button.setAttribute('aria-pressed', LANGS[j].code === current ? 'true' : 'false');
        button.setAttribute('aria-label', LANGS[j].text + ' — ' + LANGS[j].name);
        button.textContent = LANGS[j].text;
        mount.appendChild(button);
      }
    }
  }

  function paint() {
    if (painted) return;

    painted = true;

    try {
      if (typeof document.createElement !== 'function') return;

      var head = document.head;

      if (!head || typeof head.appendChild !== 'function') return;

      var style = document.createElement('style');

      style.setAttribute('data-oa-i18n', 'lang');
      style.textContent = CSS;
      head.appendChild(style);
    } catch (error) {}
  }

  var originals = new Map();
  var attrOriginals = new Map();

  function readStored() {
    try {
      return localStorage.getItem(KEY) === 'en' ? 'en' : 'id';
    } catch (error) {
      return 'id';
    }
  }

  function readDict() {
    try {
      var node = document.getElementById('i18n-dict');

      if (!node) return {};

      var parsed = JSON.parse(node.textContent);

      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  var dict = readDict();
  var current = readStored();

  function originalOf(element) {
    if (!originals.has(element)) originals.set(element, element.textContent);

    return originals.get(element);
  }

  function attrOriginalOf(
    element,
    attr
  ) {
    var saved = attrOriginals.get(element);

    if (!saved) {
      saved = {};
      attrOriginals.set(element, saved);
    }

    if (!(attr in saved)) saved[attr] = element.getAttribute(attr);

    return saved[attr];
  }

  function table() {
    return (dict && dict[current]) || {};
  }

  function apply() {
    var entries = table();
    var nodes = document.querySelectorAll('[data-i18n]');

    for (var i = 0; i < nodes.length; i += 1) {
      var element = nodes[i];
      var authored = originalOf(element);
      var text = entries[element.getAttribute('data-i18n')];

      element.textContent = (typeof text === 'string' && text !== '') ? text : authored;
    }

    var rich = document.querySelectorAll('[data-i18n-html]');

    for (var k = 0; k < rich.length; k += 1) {
      var paragraph = rich[k];

      if (!originals.has(paragraph)) originals.set(paragraph, paragraph.innerHTML);

      var authoredHtml = originals.get(paragraph);
      var markup = entries[paragraph.getAttribute('data-i18n-html')];

      paragraph.innerHTML = (typeof markup === 'string' && markup !== '') ? markup : authoredHtml;
    }

    var attributed = document.querySelectorAll('[data-i18n-attr]');

    for (var a = 0; a < attributed.length; a += 1) {
      var target = attributed[a];
      var specs = (target.getAttribute('data-i18n-attr') || '').split(';');

      for (var s = 0; s < specs.length; s += 1) {
        var sep = specs[s].indexOf(':');

        if (sep <= 0) continue;

        var attr = specs[s].slice(0, sep).trim();
        var key = specs[s].slice(sep + 1).trim();

        if (!attr || !key) continue;

        var authoredAttr = attrOriginalOf(target, attr);
        var value = entries[key];

        if (typeof value === 'string' && value !== '') {
          target.setAttribute(attr, value);
        } else if (typeof authoredAttr === 'string') {
          target.setAttribute(attr, authoredAttr);
        }
      }
    }

    document.documentElement.lang = current;

    var buttons = document.querySelectorAll('button[data-lang]');

    for (var j = 0; j < buttons.length; j += 1) {
      buttons[j].setAttribute('aria-pressed', buttons[j].getAttribute('data-lang') === current ? 'true' : 'false');
    }
  }

  function setLang(lang) {
    current = lang === 'en' ? 'en' : 'id';

    try {
      localStorage.setItem(KEY, current);
    } catch (error) {}

    apply();
  }

  function t(
    key,
    fallback
  ) {
    var text = table()[key];

    if (typeof text === 'string' && text !== '') return text;
    if (typeof fallback === 'string' && fallback !== '') return fallback;

    return key;
  }

  function getLang() {
    return current;
  }

  function wire() {
    var buttons = document.querySelectorAll('button[data-lang]');

    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener('click', function () {
        setLang(this.getAttribute('data-lang'));
      });
    }
  }

  function init() {
    build();
    paint();
    apply();
    wire();
  }

  window.OperaAgentI18n = {
    t: t,
    setLang: setLang,
    getLang: getLang
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
