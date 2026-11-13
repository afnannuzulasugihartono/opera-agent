// @last-edited: 2026-11-13 UTC+7.
// @title: bing-serp — declarations for the generated copy beside it, never committed at runtime.
// @state: compiles against the emitted shared/bing-serp.js copy; names mirror shared/bing-serp.ts exactly.
// @dependencies: none.

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
export function hostOf(href: string): string;
export function parseBingSerp(input?: SerpPage, currentFirst?: { currentFirst?: number }): SerpParsed;
