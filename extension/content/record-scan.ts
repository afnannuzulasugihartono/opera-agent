/*
 * @last-edited: 2026-11-13 UTC+7.
 * @title: record-scan - the scan pipeline and the scroll, inside the page: the scan harvest and rewrite (outerHTML + inline), the dump the agent reads, and the smooth scroll the recorder rides on.
 * @state: exposed as globalThis.OperaAgentRecordScan; scan pipeline collect/inline, dumpPage, record_scroll.scroll; no network from the page's own realm, no mutation of the live DOM.
 * @dependencies: none.
 */

// WHY A SEPARATE CONTENT SCRIPT FOR THE PAGE-SIDE WORK: most of the pipeline belongs to the page's main realm (the encoder), what remains here is what needs a DOM copy to parse and the scroll that plays a sequence; the worker drives both through this one scope.
// WHY THE LIVE DOM IS NEVER MUTATED FOR THE SCAN: a scan is a reading, not a visit - the rewrite happens on a parsed copy, so the open page keeps its state, its handlers and its scroll.

// WHY A LOCAL GUARD: this file ships as a classic content script the manifest loads directly; a static import would be a SyntaxError at load time.
// Mirrors extension/lib/guards.ts.

declare global {
  var OperaAgentRecordScan: Record<string, ((payload?: unknown) => unknown) | undefined> | undefined;
  var __oaDocumentId: string | undefined;
}

(function () {
  'use strict';

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function recordScrollTo(args: unknown) {
    var options = isRecord(args) ? args : {};
    var duration = Math.min(15000, Math.max(600, Number(options.durationMs) || 3000));

    return new Promise<{ ok: boolean; scrolled: number; maxDoc: number }>(function (resolve) {
      var maxDoc = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

      if (maxDoc < 16) {
        resolve({ ok: true, scrolled: 0, maxDoc: maxDoc });
        return;
      }

      var start = performance.now();

      function ease(t: number): number {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      }

      function frame(now: number): void {
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

  function absolute(url: unknown, base: unknown): string | null {
    try {
      return new URL(String(url), typeof base === 'string' && base ? base : String(document.baseURI)).href;
    } catch {
      return null;
    }
  }

  function dumpPage(params: unknown) {
    var source = isRecord(params) ? params : null;
    var offsetValue = source ? source.offset : undefined;
    var limitValue = source ? source.limit : undefined;
    var offset = Math.max(0, Number.parseInt(offsetValue == null ? '' : String(offsetValue), 10) || 0);
    var limit = limitValue != null
      ? Math.min(200000, Math.max(0, Number.parseInt(String(limitValue), 10) || 0))
      : 12000;

    var rawText = document.body ? String(document.body.innerText || '') : '';
    var slice = rawText.slice(offset, offset + limit);
    var truncated = offset + limit < rawText.length;
    var title = String(document.title || '').trim().slice(0, 300);

    var headings: Array<{ level: number; text: string }> = [];
    var headingNodes = document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6');
    for (var i = 0; i < headingNodes.length && headings.length < 200; i += 1) {
      var headingNode = headingNodes[i];
      if (!headingNode) continue;
      var text = String(headingNode.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (text) headings.push({ level: Number(headingNode.tagName.slice(1)), text: text });
    }

    var links: Array<{ href: string; text: string }> = [];
    var seen = new Set<string>();
    var anchors = document.querySelectorAll<HTMLAnchorElement>('a[href]');
    for (var j = 0; j < anchors.length && links.length < 500; j += 1) {
      var anchor = anchors[j];
      if (!anchor) continue;
      var href = String(anchor.getAttribute('href') || '').trim();
      try { href = new URL(href, document.baseURI).href; } catch { /* keep the raw href if the URL parse fails */ }
      var anchorText = String(anchor.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      var key = href + '|' + anchorText;
      if (!href || seen.has(key)) continue;
      seen.add(key);
      links.push({ href: href, text: anchorText });
    }

    var scripts: Array<{ src: string | null; integrity: string | null; type: string | null }> = [];
    var scriptNodes = document.querySelectorAll('script');
    for (var k = 0; k < scriptNodes.length && scripts.length < 200; k += 1) {
      var script = scriptNodes[k];
      if (!script) continue;
      var src = script.getAttribute('src');
      if (!src && !script.getAttribute('integrity') && !script.getAttribute('type')) continue;
      scripts.push({ src: src || null, integrity: script.getAttribute('integrity') || null, type: script.getAttribute('type') || null });
    }

    var styles: Array<{ href: string }> = [];
    var styleLinks = document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]');
    for (var m = 0; m < styleLinks.length && styles.length < 200; m += 1) {
      var styleLink = styleLinks[m];
      if (!styleLink) continue;
      styles.push({ href: String(styleLink.getAttribute('href') || '') });
    }

    return {
      ok: true,
      url: String(document.baseURI),
      title: title,
      offset: offset,
      limit: limit,
      totalText: rawText.length,
      truncated: truncated,
      nextOffset: truncated && offset + limit < rawText.length ? offset + limit : null,
      text: slice,
      headings: headings,
      links: links,
      scripts: scripts,
      styles: styles
    };
  }

  function collectScanAssets() {
    var base = document.baseURI;
    var stylesheets: string[] = [];

    for (var i = 0; i < document.styleSheets.length; i += 1) {
      try {
        var sheet = document.styleSheets[i];
        if (sheet && sheet.href) stylesheets.push(sheet.href);
      } catch {

      }
    }

    var linkNodes = document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]');

    for (var j = 0; j < linkNodes.length; j += 1) {
      var link = linkNodes[j];
      if (!link) continue;
      var href = absolute(link.getAttribute('href'), base);
      if (href && stylesheets.indexOf(href) === -1) stylesheets.push(href);
    }

    var scripts: Array<{ url: string; type: string }> = [];

    var scriptNodes = document.querySelectorAll<HTMLScriptElement>('script[src]');

    for (var s = 0; s < scriptNodes.length; s += 1) {
      var node = scriptNodes[s];
      if (!node) continue;
      var url = absolute(node.getAttribute('src'), base);
      if (url) scripts.push({ url: url, type: node.getAttribute('type') || '' });
    }

    var images: Array<{ url: string }> = [];

    var imgNodes = document.querySelectorAll<HTMLImageElement>('img[src]');

    for (var m = 0; m < imgNodes.length; m += 1) {
      var img = imgNodes[m];
      if (!img) continue;
      var src = absolute(img.getAttribute('src'), base);
      if (src) images.push({ url: src });
    }

    var icons: Array<{ url: string }> = [];

    var iconNodes = document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"][href], link[rel~="apple-touch-icon"][href], link[rel="mask-icon"][href]');

    for (var c = 0; c < iconNodes.length; c += 1) {
      var icon = iconNodes[c];
      if (!icon) continue;
      var iconUrl = absolute(icon.getAttribute('href'), base);
      if (iconUrl) icons.push({ url: iconUrl });
    }

    var srcset = new Set<string>();

    var srcsetNodes = document.querySelectorAll<HTMLElement>('[srcset]');

    for (var q = 0; q < srcsetNodes.length; q += 1) {
      var srcsetNode = srcsetNodes[q];
      if (!srcsetNode) continue;
      var parts = String(srcsetNode.getAttribute('srcset') || '').split(',');

      for (var p = 0; p < parts.length; p += 1) {
        var part = parts[p];
        if (part == null) continue;
        var candidate = part.trim().split(/\s+/)[0];

        if (candidate) {
          var abs = absolute(candidate, base);
          if (abs) srcset.add(abs);
        }
      }
    }

    var sources: Array<{ url: string }> = [];

    var sourceNodes = document.querySelectorAll<HTMLSourceElement>('source[src]');

    for (var v = 0; v < sourceNodes.length; v += 1) {
      var sourceNode = sourceNodes[v];
      if (!sourceNode) continue;
      var media = absolute(sourceNode.getAttribute('src'), base);
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

  async function scanInline(args: unknown) {
    var argsRecord = isRecord(args) ? args : {};
    var assets: Record<string, unknown> = isRecord(argsRecord.assets) ? argsRecord.assets : {};

    var source = document.documentElement.outerHTML;

    var doc = new DOMParser().parseFromString(source, 'text/html');

    var inlined = { stylesheets: 0, scripts: 0, images: 0, icons: 0, srcset: 0 };
    var kept: string[] = [];

    function dataFor(url: unknown): Record<string, unknown> | null {
      if (!url) return null;

      try {
        var absoluteUrl = new URL(String(url), document.baseURI).href;
        var asset = assets[absoluteUrl];
        return isRecord(asset) ? asset : null;
      } catch {
        return null;
      }
    }

    var links = doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]');

    for (var i = 0; i < links.length; i += 1) {
      var link = links[i];
      if (!link) continue;
      var css = dataFor(link.getAttribute('href'));

      if (css && css.kind === 'css') {
        var style = doc.createElement('style');
        style.textContent = String(css.content);
        link.replaceWith(style);
        inlined.stylesheets += 1;
      } else {
        kept.push(String(css && css.url ? css.url : 'stylesheet'));
      }
    }

    var scripts = doc.querySelectorAll<HTMLScriptElement>('script[src]');

    for (var j = 0; j < scripts.length; j += 1) {
      var script = scripts[j];
      if (!script) continue;
      var asset = dataFor(script.getAttribute('src'));

      if (asset && asset.kind === 'text') {
        var inline = doc.createElement('script');

        for (var k = 0; k < script.attributes.length; k += 1) {
          var attr = script.attributes[k];
          if (!attr) continue;

          if (attr.name === 'src' || attr.name === 'integrity' || attr.name === 'crossorigin') continue;

          inline.setAttribute(attr.name, attr.value);
        }

        if (asset.integrity) inline.setAttribute('integrity', String(asset.integrity));

        inline.textContent = String(asset.content);
        script.replaceWith(inline);
        inlined.scripts += 1;
      } else {
        kept.push(String(asset && asset.url ? asset.url : 'script'));
      }
    }

    var images = doc.querySelectorAll<HTMLImageElement>('img[src]');

    for (var m = 0; m < images.length; m += 1) {
      var img = images[m];
      if (!img) continue;
      var src = dataFor(img.getAttribute('src'));

      if (src && src.kind === 'data') {
        img.setAttribute('src', String(src.dataUrl));
        inlined.images += 1;
      } else {
        kept.push(String(src && src.url ? src.url : 'image'));
      }
    }

    var iconLinks = doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon"][href], link[rel~="apple-touch-icon"][href], link[rel="mask-icon"][href]');

    for (var c = 0; c < iconLinks.length; c += 1) {
      var icon = iconLinks[c];
      if (!icon) continue;
      var iconAsset = dataFor(icon.getAttribute('href'));

      if (iconAsset && iconAsset.kind === 'data') {
        icon.setAttribute('href', String(iconAsset.dataUrl));
        inlined.icons += 1;
      } else {
        kept.push(String(iconAsset && iconAsset.url ? iconAsset.url : 'icon'));
      }
    }

    var withSrcset = doc.querySelectorAll<HTMLElement>('[srcset]');

    for (var q = 0; q < withSrcset.length; q += 1) {
      var el = withSrcset[q];
      if (!el) continue;
      var parts = String(el.getAttribute('srcset') || '').split(',');
      var rewritten: string[] = [];

      for (var p = 0; p < parts.length; p += 1) {
        var rawPart = parts[p];
        if (rawPart == null) continue;
        var raw = rawPart.trim();
        var tokens = raw.split(/\s+/);
        var candidate = tokens[0];

        if (!candidate) continue;

        var abs: string | null;

        try {
          abs = new URL(candidate, document.baseURI).href;
        } catch {
          rewritten.push(raw);
          continue;
        }

        var data = assets[abs];

        if (isRecord(data) && data.kind === 'data') {
          rewritten.push(String(data.dataUrl) + (tokens.length > 1 ? ' ' + tokens.slice(1).join(' ') : ''));
          inlined.srcset += 1;
        } else {
          rewritten.push(raw);
          kept.push(abs);
        }
      }

      el.setAttribute('srcset', rewritten.join(', '));
    }

    var html = doc.documentElement.outerHTML;

    return {
      ok: true,
      documentBytes: source.length,
      htmlBytes: html.length,
      html: html,
      inlined: inlined,
      kept: Array.from(new Set(kept)).slice(0, 64)
    };
  }

  globalThis.OperaAgentRecordScan = {
    recordScrollTo: recordScrollTo,
    collectScanAssets: collectScanAssets,
    scanInline: scanInline,
    dumpPage: dumpPage
  };

  function onMessage(message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void): boolean {
    if (!isRecord(message) || message.scope !== 'opera-agent-record-scan') return false;

    Promise.resolve()
      .then(function (): unknown {
        switch (message.method) {
          case 'ping': return { ok: true, documentId: String(globalThis.__oaDocumentId || '') };
          case 'record_scroll.scroll': return recordScrollTo(message.params);
          case 'page.scan_collect': return collectScanAssets();
          case 'page.scan_inline': return scanInline(message.params);
          case 'page.dump': return dumpPage(message.params);
          default: return { ok: false, error: 'Unknown record-scan method.' };
        }
      })
      .then(function (result) { sendResponse(result); })
      .catch(function (error: unknown) { sendResponse({ ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 1000) }); });

    return true;
  }

  try {
    chrome.runtime.onMessage.addListener(onMessage);
  } catch {

  }
})();
