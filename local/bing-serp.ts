// @last-edited: 2026-11-13 UTC+7.
// @title: bing-serp - the Bing SERP as data: external results, in order, with their snippets.
// @state: the one SERP parser behind search_bing, on both roads; the local package reads a generated copy of this file, written by scripts/pack/pack-mcp.mjs and never committed.
// @dependencies: none.

// WHY THIS FILE LIVES IN shared/.
// The hosted road (edge function, Deno) bundles this folder via static import, and the local road (stdio server, Node) carries a copy written at pack time: one file in this tree, two consumers at build time, no drift to guard.

const BING_HOST = /(^|\.)bing\.com$/i;
const MICROSOFT_FW_LINK = /(^|\.)go\.microsoft\.com$/i;

// A display URL, as Bing renders it inside a result card: bare host, host with a path, or "host.tld/path https://host.tld/path".

const DISPLAY_URL_LINE = /^[\w-]+(\.[\w-]+)+(:[0-9]+)?(\/[\w./-]*)?$/;
const DISPLAY_MIXED = /^[\w-]+(\.[\w-]+)+(:[0-9]+)?(\/[\w./-]*)?\s+https?:\/\//i;
const DISPLAYISH = /^https?:\/\//i;

export interface SerpLink {
  href?: string | undefined;
  text?: string | undefined;
}

export interface SerpPage {
  text?: string | undefined;
  links?: SerpLink[] | undefined;
}

export interface SerpResult {
  rank: number;
  title: string;
  url: string;
  site: string;
  snippet: string;
}

export interface SerpParsed {
  results: SerpResult[];
  nextFirst: number | null;
}

function isDisplayText(text: string): boolean {
  return DISPLAY_URL_LINE.test(text) || DISPLAYISH.test(text) || DISPLAY_MIXED.test(text);
}

/**
 * @param href the link's href as Bing rendered it
 * @returns the lower-cased hostname, or an empty string for unparsable input
 */

export function hostOf(href: string): string {
  try {
    return new URL(href).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isExternal(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  const host = hostOf(href);
  if (!host) return false;
  if (BING_HOST.test(host) || MICROSOFT_FW_LINK.test(host)) return false;
  return true;
}

/**
 * Bing wraps organic cards in a redirect: https://www.bing.com/ck/a?...&u=a1<base64url-target>.
 * WHY THE UNWRAP IS RE-VALIDATED.
 * A redirect wrapper promises nothing about its target; the target is attacker-controlled.
 * Returning it without the same checks every other href goes through would let javascript: or file: leak out as "results".
 * So the target passes through isExternal before it is ever returned, and anything that fails stays dropped, exactly like the wrapper itself.
 * @param href the redirect URL as Bing rendered it
 * @returns the decoded target, or null when there is nothing to unwrap
 */

function unwrapBingRedirect(href: string): string | null {
  const host = hostOf(href);
  if (!host || !BING_HOST.test(host)) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!url.pathname.startsWith('/ck/')) return null;
  const packed = url.searchParams.get('u');
  if (!packed) return null;
  const encoded = packed.replace(/^a1/i, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = encoded.padEnd(encoded.length + ((4 - (encoded.length % 4)) % 4), '=');
  let target: string;
  try {
    const binary = atob(padded);
    target = new TextDecoder().decode(Uint8Array.from(binary, (c: string) => c.charCodeAt(0)));
  } catch {
    return null;
  }
  return isExternal(target) ? target : null;
}

// WHY RESULTS ARE ZIPPED FROM THE ANCHORS, NOT FROM THE HEADINGS.
// Bing emits two anchors per organic card and they share one href: first the display URL ("example.com https://example.com › a › b"), then the title, which is the same text as the h2/h3.
// Headings also catch People-Also-Ask questions and the "Related searches" and "Pagination" blocks, which have no external href - anchors cannot produce them.
// Rank is page-local; the caller re-numbers once the pages are concatenated.

interface CardGroup {
  url: string;
  site: string;
  texts: string[];
}

export function parseBingSerp({ text = '', links = [] }: SerpPage = {}, { currentFirst = 1 }: { currentFirst?: number } = {}): SerpParsed {
  const byHref = new Map<string, CardGroup>();
  for (const link of links) {
    const href = String(link?.href ?? '').trim();
    const external = unwrapBingRedirect(href) ?? href;
    if (!isExternal(external)) continue;
    const anchorText = String(link?.text ?? '').replace(/\s+/g, ' ').trim();
    const group = byHref.get(external) ?? { url: external, site: hostOf(external).replace(/^www\./, ''), texts: [] };
    if (anchorText) group.texts.push(anchorText);
    byHref.set(external, group);
  }

  const results: SerpResult[] = [];
  for (const group of byHref.values()) {
    const nonDisplay = group.texts.filter((t: string) => !isDisplayText(t));
    let title: string;
    if (nonDisplay.length) {
      title = (nonDisplay[nonDisplay.length - 1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    } else {
      title = (group.texts[group.texts.length - 1] ?? '');
      const arrow = title.indexOf('›');
      if (arrow >= 0) title = title.slice(0, arrow);
      title = title.replace(/https?:\/\/\S+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
    }
    if (!title || !group.url) continue;
    results.push({ rank: 0, title, url: group.url, site: group.site, snippet: '' });
  }

  // WHY NEXT FIRST IS DERIVED FROM THE PAGE, NOT ASSUMED.
  // Bing's page size changed between result sets before (30, then 10): the pagination links name the first result of each numbered page, so the next page is the smallest first= above the current one, whatever the page size is today.
  let nextFirst: number | null = null;
  for (const link of links) {
    const href = String(link?.href ?? '');
    const linkHost = hostOf(href);
    if (!linkHost || !BING_HOST.test(linkHost)) continue;
    const match = /[?&]first=(\d+)/.exec(href);
    const first = match?.[1];
    if (!first) continue;
    const candidate = Number(first);
    if (!Number.isFinite(candidate) || candidate <= currentFirst) continue;
    if (nextFirst === null || candidate < nextFirst) nextFirst = candidate;
  }

  // WHY THE SNIPPET WALK SKIPS LEADING BLANK LINES.
  // Bing puts a blank line between the title and its description, and a line that is only spaces counts as blank once trimmed: a parser that stopped at the first blank would return an empty snippet for every result.
  // WHY DUPLICATE TITLES CARRY A COUNT, NOT A DELETE.
  // Two cards may render the same title; a Set with one entry per title would drop the boundary for the second card after the first card's walk, and the snippet would bleed across cards.
  // A multiset keeps one boundary per remaining occurrence.
  const lines = String(text).split(/\r?\n/).map((line: string) => line.trim());
  const pending = new Map<string, number>();
  for (const result of results) pending.set(result.title, (pending.get(result.title) ?? 0) + 1);
  const hasPending = (line: string): boolean => (pending.get(line) ?? 0) > 0;
  let cursor = 0;
  const findTitle = (from: number, title: string): number => {
    for (let i = from; i < lines.length; i += 1) if (lines[i] === title) return i;
    for (let i = from; i < lines.length; i += 1) if (lines[i]?.startsWith(title)) return i;
    return -1;
  };
  for (const result of results) {
    pending.set(result.title, (pending.get(result.title) ?? 1) - 1);
    const at = findTitle(cursor, result.title);
    if (at < 0) continue;
    let k = at + 1;
    while (k < lines.length && !lines[k]) k += 1;
    const buf: string[] = [];
    while (k < lines.length) {
      const line = lines[k] as string;
      if (!line) break;
      if (DISPLAY_URL_LINE.test(line) || line.includes('›')) break;
      if (hasPending(line)) break;
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
