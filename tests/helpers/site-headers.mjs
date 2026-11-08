// @last-edited: 2026-11-08 UTC+7.
// @title: site-headers - the site's header policy, read from the file Cloudflare Pages serves it with.
// @state: one shape for every test that asks what policy a path carries.
// @dependencies: node:fs.

import fs from 'node:fs';

const root = new URL('../../', import.meta.url);

export function siteRules() {
  const rules = [];
  let current = null;
  for (const line of fs.readFileSync(new URL('landing/_headers', root), 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { paths: line.split(',').map((part) => part.trim()), headers: {} };
      rules.push(current);
      continue;
    }
    const at = line.indexOf(':');
    current.headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return rules;
}

export function siteHeaders() {
  const text = fs.readFileSync(new URL('landing/_headers', root), 'utf8');
  const headers = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { source: line.trim(), headers: [] };
      headers.push(current);
      continue;
    }
    const at = line.indexOf(':');
    current.headers.push({ key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() });
  }
  return { headers };
}
