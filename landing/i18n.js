/*
 * @last-edited: 2026-11-12 UTC+7.
 * @title: i18n - one shared language swap for every page of the site; the picker folds open like the portal.
 * @state: classic script, zero dependencies; builds the portal-style picker into its mount, reads oa-lang plus the page dict, swaps text and rich paragraphs, paints its own styles, never networks.
 * @dependencies: none.
 */

(function () {
  'use strict';

  var KEY = 'oa-lang';

  // WHY THE TRIGGER READS THE CANVAS TOKENS: it paints its own styles, so a paper-coloured control on a dark page would read at 2.9:1 - the one thing a language pick must never do.
  // WHY THE PANEL IS FLAT, NOT NESTED: the shared gate walks the mount's direct children to find the one button per language; a nested menu would hide the buttons from it (and from anything built like it).
  var LANGS = [
    { code: 'id', text: 'INDONESIA', name: 'Bahasa Indonesia', label: 'INDONESIA - Bahasa Indonesia' },
    { code: 'en', text: 'ENGLISH', name: 'English (US)', label: 'ENGLISH - English (US)' },
  ];

  var GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><ellipse cx="12" cy="12" rx="9" ry="4.1"></ellipse></svg>';
  var CHEVRON = '<svg class="oaLangChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>';
  var CHECK = '<svg class="oaLangCheck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-11"></path></svg>';

  var CSS = '.lang{position:relative;display:inline-flex;align-items:center;white-space:nowrap}'
    + '.oaLangTrigger{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(242,242,242,.55);border-radius:2px;background:transparent;color:var(--ink);font:700 12px/1 var(--font);letter-spacing:.14em;text-transform:uppercase;padding:9px 12px;cursor:pointer;white-space:nowrap;}'
    + '.oaLangTrigger:hover{border-color:var(--ink);background:rgba(255,255,255,.06)}'
    + '.oaLangTrigger[aria-expanded="true"]{border-color:var(--ink);background:rgba(255,255,255,.09)}'
    + '.oaLangTrigger:focus-visible{outline:2px solid var(--focus);outline-offset:2px}'
    + '.oaLangTrigger svg{width:15px;height:15px;flex:0 0 auto}'
    + '.oaLangChevron{display:inline-block}'
    + '.oaLangTrigger[aria-expanded="true"] .oaLangChevron{transform:rotate(180deg)}'
    + '.oaLangBanner,.oaLangItem{position:absolute;left:0;width:330px;z-index:30}'
    + '.oaLangBanner{top:calc(100% + 10px);display:flex;align-items:center;gap:10px;background:#ffffff;color:#141424;border-radius:10px 10px 0 0;padding:9px 14px;box-shadow:0 30px 70px rgba(2,2,40,.5)}'
    + '.oaLangBanner svg{width:18px;height:18px;stroke:#0000f2;flex:0 0 auto}'
    + '.oaLangBannerText{font:700 12px/1 var(--font);letter-spacing:.18em;text-transform:uppercase;color:#0000f2}'
    + '.oaLangBannerSub{font:600 10.5px/1 var(--font);letter-spacing:.08em;color:#565672;text-transform:uppercase}'
    + '.oaLangItem{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;border:0;background:#0000f2;color:#ffffff;font:400 21px/1 "Anton","Arial Narrow",sans-serif;letter-spacing:.03em;text-transform:uppercase;text-align:left;padding:11px 14px;cursor:pointer;}'
    + '.oaLangItem[data-lang="id"]{top:calc(100% + 10px + 40px)}'
    + '.oaLangItem[data-lang="en"]{top:calc(100% + 10px + 40px + 52px);border-radius:0 0 10px 10px}'
    + '.oaLangItem:hover,.oaLangItem:focus-visible{background:#1212f0}'
    + '.oaLangItem:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}'
    + '.oaLangItemSub{font:600 10px/1.4 var(--font);letter-spacing:.11em;color:rgba(255,255,255,.6);text-transform:uppercase;text-align:right}'
    + '.oaLangItem:hover .oaLangItemSub{color:rgba(255,255,255,.88)}'
    + '.oaLangCheck{width:15px;height:15px;stroke:#ffffff;opacity:0}'
    + '.oaLangItem[aria-pressed="true"] .oaLangCheck{opacity:1}'
   ;

  var painted = false;

  // WHY THE CONTROL IS BUILT HERE AND NOT COPIED INTO TWELVE PAGES.
  // The picker was authored markup on every page, so its label had to be corrected page by page and the copies drifted.
  // One builder means one place defines the trigger, the banner, the two choices and the check that shows which one is on.

  function build() {
    var mounts = document.querySelectorAll('[data-lang-toggle]');

    for (var i = 0; i < mounts.length; i += 1) {
      buildMount(mounts[i]);
    }

    function buildMount(mount) {
      if (mount.getAttribute('data-built') === 'true') return;

      mount.setAttribute('data-built', 'true');

      var trigger = document.createElement('button');
      trigger.setAttribute('type', 'button');
      trigger.setAttribute('class', 'oaLangTrigger');
      trigger.setAttribute('aria-haspopup', 'true');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-controls', 'oaLangPanel');
      trigger.innerHTML = GLOBE + '<span class="oaLangTriggerText">Bahasa</span>' + CHEVRON;
      mount.appendChild(trigger);

      var banner = document.createElement('span');
      banner.setAttribute('class', 'oaLangBanner');
      banner.setAttribute('id', 'oaLangPanel');
      banner.setAttribute('aria-hidden', 'true');
      banner.hidden = true;
      banner.innerHTML = GLOBE + '<span class="oaLangBannerText">Bahasa</span><span class="oaLangBannerSub">Indonesia / English</span>';
      mount.appendChild(banner);

      for (var j = 0; j < LANGS.length; j += 1) {
        var lang = LANGS[j];
        var item = document.createElement('button');
        item.setAttribute('type', 'button');
        item.setAttribute('class', 'oaLangItem');
        item.setAttribute('data-lang', lang.code);
        item.setAttribute('aria-pressed', lang.code === current ? 'true' : 'false');
        item.setAttribute('aria-label', lang.label);
        item.setAttribute('hidden', 'true');
        item.textContent = lang.text;
        var sub = document.createElement('span');
        sub.setAttribute('class', 'oaLangItemSub');
        sub.setAttribute('aria-hidden', 'true');
        sub.textContent = lang.name;
        item.appendChild(sub);
        item.appendChild(document.createElement('span'));
        item.children[item.children.length - 1].innerHTML = CHECK;
        item.children[item.children.length - 1].setAttribute('aria-hidden', 'true');
        mount.appendChild(item);
      }

      trigger.addEventListener('click', function () {
        setOpen(trigger.getAttribute('aria-expanded') !== 'true');
      });

      for (var k = 0; k < mount.children.length; k += 1) {
        var child = mount.children[k];
        if (!child.getAttribute || child.getAttribute('data-lang') === null) continue;
        if (child.getAttribute('data-lang')) {
          child.addEventListener('click', function () {
            setLang(this.getAttribute('data-lang'));
            setOpen(false);
            if (typeof trigger.focus === 'function') trigger.focus();
          });
        }
      }

      document.addEventListener('pointerdown', function (event) {
        if (trigger.getAttribute('aria-expanded') !== 'true') return;
        if (mount.contains(event.target)) return;
        setOpen(false);
      });

      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || trigger.getAttribute('aria-expanded') !== 'true') return;
        event.stopPropagation();
        setOpen(false);
        if (typeof trigger.focus === 'function') trigger.focus();
      });

      function setOpen(open) {
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        banner.hidden = !open;
        for (var m = 0; m < mount.children.length; m += 1) {
          var row = mount.children[m];
          if (row.getAttribute && row.getAttribute('data-lang')) row.hidden = !open;
        }
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
    } catch (error) {

    }
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

  function attrOriginalOf(element, attr) {
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
    } catch (error) {

    }

    apply();
  }

  function t(key, fallback) {
    var text = table()[key];

    if (typeof text === 'string' && text !== '') return text;
    if (typeof fallback === 'string' && fallback !== '') return fallback;

    return key;
  }

  function getLang() {
    return current;
  }

  function init() {
    build();
    paint();
    apply();
  }

  window.OperaAgentI18n = { t: t, setLang: setLang, getLang: getLang };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
