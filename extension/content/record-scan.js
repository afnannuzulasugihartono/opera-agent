/*
 * @last-edited: 2026-11-12 UTC+7.
 * @title: record-scan - the scan pipeline and the scroll, inside the page: the scan harvest and rewrite (outerHTML + inline), and the smooth scroll the recorder rides on.
 * @state: exposed as globalThis.OperaAgentRecordScan; scan pipeline collect/inline and record_scroll.scroll; no network from the page's own realm, no mutation of the live DOM.
 * @dependencies: none.
 */

// WHY A SEPARATE CONTENT SCRIPT FOR THE PAGE-SIDE WORK: most of the pipeline belongs to the page's main realm (the encoder), what remains here is what needs a DOM copy to parse and the scroll that plays a sequence; the worker drives both through this one scope.
// WHY THE LIVE DOM IS NEVER MUTATED FOR THE SCAN: a scan is a reading, not a visit - the rewrite happens on a parsed copy, so the open page keeps its state, its handlers and its scroll.

(function () {
  'use strict';

  var record = null;

  function recordScrollTo(args) {
    var duration = Math.min(15000, Math.max(600, Number(args?.durationMs) || 3000));

    return new Promise(function (resolve) {
      var maxDoc = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

      if (maxDoc < 16) {
        resolve({ ok: true, scrolled: 0, maxDoc: maxDoc });
        return;
      }

      var start = performance.now();

      function ease(t) {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      }

      function frame(now) {
        var t = Math.min(1, (now - start) / duration);
        window.scrollTo(0, Math.round(ease(t) * maxDoc));

        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          resolve({ ok: true, scrolled: maxDoc, maxDoc: maxDoc });
        }
      }

      requestAnimationFrame(frame);
    });
  }

  function absolute(url, base) {
    try {
      return new URL(url, base || document.baseURI).href;
    } catch (error) {
      return null;
    }
  }

  function collectScanAssets() {
    var base = document.baseURI;
    var stylesheets = [];

    for (var i = 0; i < document.styleSheets.length; i += 1) {
      try {
        if (document.styleSheets[i].href) stylesheets.push(document.styleSheets[i].href);
      } catch (error) {

      }
    }

    for (var j = 0; j < document.querySelectorAll('link[rel~="stylesheet"][href]').length; j += 1) {
      var link = document.querySelectorAll('link[rel~="stylesheet"][href]')[j];
      var href = absolute(link.getAttribute('href'), base);
      if (href && stylesheets.indexOf(href) === -1) stylesheets.push(href);
    }

    var scripts = [];

    var scriptNodes = document.querySelectorAll('script[src]');

    for (var s = 0; s < scriptNodes.length; s += 1) {
      var node = scriptNodes[s];
      var url = absolute(node.getAttribute('src'), base);
      if (url) scripts.push({ url: url, type: node.getAttribute('type') || '' });
    }

    var images = [];

    var imgNodes = document.querySelectorAll('img[src]');

    for (var m = 0; m < imgNodes.length; m += 1) {
      var img = imgNodes[m];
      var src = absolute(img.getAttribute('src'), base);
      if (src) images.push({ url: src });
    }

    var icons = [];

    var iconNodes = document.querySelectorAll('link[rel~="icon"][href], link[rel~="apple-touch-icon"][href], link[rel="mask-icon"][href]');

    for (var c = 0; c < iconNodes.length; c += 1) {
      var icon = iconNodes[c];
      var iconUrl = absolute(icon.getAttribute('href'), base);
      if (iconUrl) icons.push({ url: iconUrl });
    }

    var srcset = new Set();

    var srcsetNodes = document.querySelectorAll('[srcset]');

    for (var q = 0; q < srcsetNodes.length; q += 1) {
      var parts = String(srcsetNodes[q].getAttribute('srcset') || '').split(',');

      for (var p = 0; p < parts.length; p += 1) {
        var candidate = parts[p].trim().split(/\s+/)[0];

        if (candidate) {
          var abs = absolute(candidate, base);
          if (abs) srcset.add(abs);
        }
      }
    }

    var sources = [];

    var sourceNodes = document.querySelectorAll('source[src]');

    for (var v = 0; v < sourceNodes.length; v += 1) {
      var media = absolute(sourceNodes[v].getAttribute('src'), base);
      if (media) sources.push({ url: media });
    }

    return {
      url: location.href,
      base: base,
      title: document.title || '',
      stylesheets: stylesheets,
      scripts: scripts,
      images: images,
      icons: icons,
      srcset: Array.from(srcset),
      sources: sources
    };
  }

  async function scanInline(args) {
    var assets = args?.assets || {};

    var source = document.documentElement.outerHTML;

    var doc = new DOMParser().parseFromString(source, 'text/html');

    var inlined = { stylesheets: 0, scripts: 0, images: 0, icons: 0, srcset: 0 };
    var kept = [];

    function dataFor(url) {
      if (!url) return null;

      try {
        var absoluteUrl = new URL(url, document.baseURI).href;
        return assets[absoluteUrl] || null;
      } catch (error) {
        return null;
      }
    }

    var links = doc.querySelectorAll('link[rel~="stylesheet"][href]');

    for (var i = 0; i < links.length; i += 1) {
      var link = links[i];
      var css = dataFor(link.getAttribute('href'));

      if (css && css.kind === 'css') {
        var style = doc.createElement('style');
        style.textContent = css.content;
        link.replaceWith(style);
        inlined.stylesheets += 1;
      } else {
        kept.push(String(css ? css.url || 'stylesheet' : 'stylesheet'));
      }
    }

    var scripts = doc.querySelectorAll('script[src]');

    for (var j = 0; j < scripts.length; j += 1) {
      var script = scripts[j];
      var asset = dataFor(script.getAttribute('src'));

      if (asset && asset.kind === 'text') {
        var inline = doc.createElement('script');

        for (var k = 0; k < script.attributes.length; k += 1) {
          var attr = script.attributes[k];

          if (attr.name === 'src' || attr.name === 'integrity' || attr.name === 'crossorigin') continue;

          inline.setAttribute(attr.name, attr.value);
        }

        if (asset.integrity) inline.setAttribute('integrity', asset.integrity);

        inline.textContent = asset.content;
        script.replaceWith(inline);
        inlined.scripts += 1;
      } else {
        kept.push(String(asset ? asset.url || 'script' : 'script'));
      }
    }

    var images = doc.querySelectorAll('img[src]');

    for (var m = 0; m < images.length; m += 1) {
      var img = images[m];
      var src = dataFor(img.getAttribute('src'));

      if (src && src.kind === 'data') {
        img.setAttribute('src', src.dataUrl);
        inlined.images += 1;
      } else {
        kept.push(String(src ? src.url || 'image' : 'image'));
      }
    }

    var iconLinks = doc.querySelectorAll('link[rel~="icon"][href], link[rel~="apple-touch-icon"][href], link[rel="mask-icon"][href]');

    for (var c = 0; c < iconLinks.length; c += 1) {
      var icon = iconLinks[c];
      var iconAsset = dataFor(icon.getAttribute('href'));

      if (iconAsset && iconAsset.kind === 'data') {
        icon.setAttribute('href', iconAsset.dataUrl);
        inlined.icons += 1;
      } else {
        kept.push(String(iconAsset ? iconAsset.url || 'icon' : 'icon'));
      }
    }

    var withSrcset = doc.querySelectorAll('[srcset]');

    for (var q = 0; q < withSrcset.length; q += 1) {
      var el = withSrcset[q];
      var parts = String(el.getAttribute('srcset') || '').split(',');
      var rewritten = [];

      for (var p = 0; p < parts.length; p += 1) {
        var raw = parts[p].trim();
        var tokens = raw.split(/\s+/);
        var candidate = tokens[0];

        if (!candidate) continue;

        var abs;

        try {
          abs = new URL(candidate, document.baseURI).href;
        } catch (error) {
          rewritten.push(raw);
          continue;
        }

        var data = assets[abs];

        if (data && data.kind === 'data') {
          rewritten.push(data.dataUrl + (tokens.length > 1 ? ' ' + tokens.slice(1).join(' ') : ''));
          inlined.srcset += 1;
        } else {
          rewritten.push(raw);
          kept.push(abs);
        }
      }

      el.setAttribute('srcset', rewritten.join(', '));
    }

    var html = doc.documentElement.outerHTML;

    if (args && typeof args.filename === 'string' && html.length > 0) {
      var blob = new Blob([html], { type: 'text/html' });
      var url = URL.createObjectURL(blob);
      var anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = args.filename;
      anchor.style.display = 'none';
      document.documentElement.appendChild(anchor);
      anchor.click();
      anchor.remove();
      await new Promise(function (resolve) { setTimeout(resolve, 900); });
      URL.revokeObjectURL(url);
    }

    return {
      ok: true,
      documentBytes: source.length,
      htmlBytes: html.length,
      inlined: inlined,
      kept: Array.from(new Set(kept)).slice(0, 64)
    };
  }

  globalThis.OperaAgentRecordScan = {
    recordScrollTo: recordScrollTo,
    collectScanAssets: collectScanAssets,
    scanInline: scanInline
  };

  function onMessage(message, _sender, sendResponse) {
    if (!message || message.scope !== 'opera-agent-record-scan') return false;

    Promise.resolve()
      .then(function () {
        switch (message.method) {
          case 'ping': return { ok: true, documentId: String(globalThis.__oaDocumentId || '') };
          case 'record_scroll.scroll': return recordScrollTo(message.params);
          case 'page.scan_collect': return collectScanAssets();
          case 'page.scan_inline': return scanInline(message.params);
          default: return { ok: false, error: 'Unknown record-scan method.' };
        }
      })
      .then(function (result) { sendResponse(result); })
      .catch(function (error) { sendResponse({ ok: false, error: String((error && error.message) || error).slice(0, 1000) }); });

    return true;
  }

  try {
    chrome.runtime.onMessage.addListener(onMessage);
  } catch (error) {

  }
})();
