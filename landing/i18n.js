// @last-edited: 2026-10-09 UTC+7.
// @title: i18n — one shared language swap for every page of the site.
// @state: classic script, zero dependencies; reads oa-lang plus the page dict, swaps text and rich paragraphs, paints its own toggle, never networks.
// @dependencies: none.

(function () {
  'use strict';

  // WHY one key for the whole site: the reader chooses once in any page nav and
  // every page honours it, so the toggle never disagrees with itself.
  var KEY = 'oa-lang';

  // WHY the toggle paints itself: every page shares one control, so the shared
  // file carries its paint and no page needs its own .lang CSS. A segmented
  // ID|EN pill in house colors, no animation, no dependency. Injected as one
  // <style> element, which the CSP already allows (style-src 'unsafe-inline').
  var CSS = '.lang{display:inline-flex;align-items:center;border:1px solid rgba(255,255,255,.16);border-radius:980px;padding:2px;white-space:nowrap}'
    + '.lang button{width:auto;margin:0;border:0;background:transparent;color:#86868b;font:inherit;font-size:12px;font-weight:600;line-height:1;padding:5px 10px;border-radius:980px;cursor:pointer}'
    + '.lang button:hover{color:#f5f5f7}'
    + '.lang button[aria-pressed="true"]{background:rgba(62,207,142,.16);color:#f5f5f7}'
    + '.lang span[aria-hidden="true"]{display:none}';

  var painted = false;

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
      // An unpainted toggle still swaps; the paint is cosmetic, the swap is not.
    }
  }

  // WHY the authored Indonesian is the source of truth: the per-page dict carries
  // only English, so the swap back restores the stashed originals and a missing
  // key leaves the authored text instead of ever blanking it.
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

  // WHY textContent and never innerHTML: a translation is a string, not markup,
  // so there is no parsed HTML for a dict to smuggle in.
  //
  // WHY data-i18n-html exists beside it: a mixed paragraph (links, code,
  // emphasis) cannot swap through textContent without destroying its child
  // nodes. The dict ships inside the page, never user input, so there is no
  // injection surface; CSP is unaffected — no script executes, the swapped
  // strings are markup the author wrote, parsed as HTML, never run.
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

    // WHY data-i18n-attr exists beside the text swap: a placeholder (or any
    // attribute) cannot swap through textContent. The spec reads
    // "attr:KEY" (semicolons separate pairs); a missing key leaves the
    // authored attribute instead of ever blanking it.
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
      // Private mode keeps the choice for this load only.
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

  function wire() {
    var buttons = document.querySelectorAll('button[data-lang]');

    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener('click', function () {
        setLang(this.getAttribute('data-lang'));
      });
    }
  }

  function init() {
    paint();
    apply();
    wire();
  }

  // WHY the helper is defined now but the swap waits for the document: a classic
  // script runs mid-parse, so on a page whose module sits halfway down the later
  // elements do not exist yet. Defining the helper synchronously keeps it
  // available to modules, and swapping on DOMContentLoaded meets the whole page.
  window.OperaAgentI18n = { t: t, setLang: setLang, getLang: getLang };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
