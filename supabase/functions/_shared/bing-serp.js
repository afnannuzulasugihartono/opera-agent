// @last-edited: 2026-11-13 UTC+7.
// @title: bing-serp - the Bing SERP as data: external results, in order, with their snippets.
// @state: the one SERP parser behind search_bing, on both roads; the local package reads a generated copy of this file, written by scripts/pack-mcp.mjs and never committed.
// @dependencies: none.

// WHY THIS FILE LIVES IN _shared.
// The hosted road (edge function, Deno) bundles this folder into the deploy, and the local road (stdio server, Node) carries a copy written at pack time: one file in this tree, two consumers at build time, no drift to guard.

const BING_HOST = /(^|\.)bing\.com$/i;
const MICROSOFT_FW_LINK = /(^|\.)go\.microsoft\.com$/i;

// A display URL, as Bing renders it inside a result card: bare host, host with a path, or the anchor text that embeds the address.

const DISPLAY_URL_LINE = /^[\w-]+(\.[\w-]+)+(:[0-9]+)?(\/[\w./-]*)?$/;
const DISPLAYISH = /(https?:\/\/|›)/i;

/**
 * @param {string} href
 * @returns {string} the lower-cased hostname, or an empty string for unparsable input
 */

export function hostOf(href) {
  try {
    return new URL(href).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isExternal(href) {
  if (!/^https?:\/\//i.test(href)) return false;
  const host = hostOf(href);
  if (!host) return false;
  if (BING_HOST.test(host) || MICROSOFT_FW_LINK.test(host)) return false;
  return true;
}

// WHY RESULTS ARE ZIPPED FROM THE ANCHORS, NOT FROM THE HEADINGS.
// Bing emits two anchors per organic card and they share one href: first the display URL ("example.com https://example.com › a › b"), then the title, which is the same text as the h2/h3.
// Headings also catch People-Also-Ask questions and the "Related searches" and "Pagination" blocks, which have no external href - anchors cannot produce them.
// Rank is page-local; the caller re-numbers once the pages are concatenated.

/**
 * @param {{ text?: string, links?: Array<{ href?: string, text?: string }> }} input
 * @param {{ currentFirst?: number }} [options]
 * @returns {{ results: Array<{ rank: number, title: string, url: string, site: string, snippet: string }>, nextFirst: number | null }}
 */

export function parseBingSerp({ text = '', links = [] } = {}, { currentFirst = 1 } = {}) {
  const byHref = new Map();
  for (const link of links) {
    const href = String(link?.href ?? '').trim();
    if (!isExternal(href)) continue;
    const anchorText = String(link?.text ?? '').replace(/\s+/g, ' ').trim();
    const group = byHref.get(href) ?? { url: href, site: hostOf(href).replace(/^www\./, ''), texts: [] };
    if (anchorText) group.texts.push(anchorText);
    byHref.set(href, group);
  }

  const results = [];
  for (const group of byHref.values()) {
    const nonDisplay = group.texts.filter((t) => !DISPLAYISH.test(t));
    const fallback = (nonDisplay[nonDisplay.length - 1] ?? group.texts[group.texts.length - 1] ?? '')
      .replace(/\s*›.*$/, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
    const title = fallback || group.site;
    if (!title || !group.url) continue;
    results.push({ title, url: group.url, site: group.site, snippet: '' });
  }

  // WHY NEXT FIRST IS DERIVED FROM THE PAGE, NOT ASSUMED.
  // Bing's page size changed between result sets before (30, then 10): the pagination links name the first result of each numbered page, so the next page is the smallest first= above the current one, whatever the page size is today.
  let nextFirst = null;
  for (const link of links) {
    const href = String(link?.href ?? '');
    const linkHost = hostOf(href);
    if (!linkHost || !BING_HOST.test(linkHost)) continue;
    const match = /[?&]first=(\d+)/.exec(href);
    if (!match) continue;
    const candidate = Number(match[1]);
    if (!Number.isFinite(candidate) || candidate <= currentFirst) continue;
    if (nextFirst === null || candidate < nextFirst) nextFirst = candidate;
  }

  // WHY THE SNIPPET WALK SKIPS LEADING BLANK LINES.
  // Bing puts a blank line between the title and its description, and a line that is only spaces counts as blank once trimmed: a parser that stopped at the first blank would return an empty snippet for every result.
  const lines = String(text).split(/\r?\n/).map((line) => line.trim());
  const pending = new Set(results.map((result) => result.title));
  let cursor = 0;
  const findTitle = (from, title) => {
    for (let i = from; i < lines.length; i += 1) if (lines[i] === title) return i;
    for (let i = from; i < lines.length; i += 1) if (lines[i].startsWith(title)) return i;
    return -1;
  };
  for (const result of results) {
    pending.delete(result.title);
    const at = findTitle(cursor, result.title);
    if (at < 0) continue;
    let k = at + 1;
    while (k < lines.length && !lines[k]) k += 1;
    const buf = [];
    while (k < lines.length) {
      const line = lines[k];
      if (!line) break;
      if (DISPLAY_URL_LINE.test(line) || line.includes('›')) break;
      if (pending.has(line)) break;
      buf.push(line);
      if (buf.join(' ').length >= 600) break;
      k += 1;
    }
    result.snippet = buf.join(' ').replace(/\s+/g, ' ').trim().slice(0, 700);
    cursor = Math.max(cursor, k);
  }

  results.forEach((result, index) => { result.rank = index + 1; });
  return { results, nextFirst };
}
