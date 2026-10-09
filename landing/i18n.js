// @last-edited: 2026-10-09 UTC+7.
// @title: i18n — one shared language swap for every page of the site.
// @state: classic script, zero dependencies; reads oa-lang plus the page dict, swaps text, never networks.
// @dependencies: none.

(function () {
  'use strict';

  // WHY one key for the whole site: the reader chooses once in any page nav and
  // every page honours it, so the toggle never disagrees with itself.
  var KEY = 'oa-lang';

  // WHY the authored Indonesian is the source of truth: the per-page dict carries
  // only English, so the swap back restores the stashed originals and a missing
  // key leaves the authored text instead of ever blanking it.
  var originals = new Map();

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

  function table() {
    return (dict && dict[current]) || {};
  }

  // WHY textContent and never innerHTML: a translation is a string, not markup,
  // so there is no parsed HTML for a dict to smuggle in.
  function apply() {
    var entries = table();
    var nodes = document.querySelectorAll('[data-i18n]');

    for (var i = 0; i < nodes.length; i += 1) {
      var element = nodes[i];
      var authored = originalOf(element);
      var text = entries[element.getAttribute('data-i18n')];

      element.textContent = (typeof text === 'string' && text !== '') ? text : authored;
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

  function t(key) {
    var text = table()[key];

    return (typeof text === 'string' && text !== '') ? text : key;
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
