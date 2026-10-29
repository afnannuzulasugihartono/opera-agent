// @last-edited: 2026-10-30 UTC+7.
// @title: docstrings — find the exported functions and classes that carry no JSDoc block.
// @state: masks strings, comments and regexes, then matches export declarations and looks back for a `/**` block; the baseline of what is still undocumented lives in scripts/docstring-baseline.mjs.
// @dependencies: none.

// WHY THE SCANNER MASKS BEFORE IT MATCHES.
// An `export function` inside a string or a comment is not a declaration, and a regex that ignores that would count a doc example twice and report a function that does not exist.
// The mask keeps the text length and the newlines, so an index found in the mask is the same index in the source.

function mask(text) {
  let out = '';
  let state = 'code';
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line';
        out += '  ';
        i += 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'block';
        out += '  ';
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        state = 'string';
        quote = ch;
        out += ' ';
        continue;
      }
      out += ch;
      continue;
    }
    if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        out += '\n';
      } else out += ' ';
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code';
        out += '  ';
        i += 1;
      } else out += ch === '\n' ? '\n' : ' ';
      continue;
    }
    if (ch === '\\') {
      out += '  ';
      i += 1;
      continue;
    }
    if (ch === quote) {
      state = 'code';
      out += ' ';
      continue;
    }
    out += ch === '\n' ? '\n' : ' ';
  }
  return out;
}

const DECLARATIONS = [
  /export\s+(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(/g,
  /export\s+class\s+([A-Za-z_$][\w$]*)/g,
  /export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g
];

const KINDS = [
  'export function',
  'class',
  'export arrow'
];

// WHY THE LOOK-BACK READS THE WHOLE PREFIX AND NOT A WINDOW.
// A JSDoc block with a long @returns line is longer than any fixed window, so a window can start in the middle of the block and miss its `/**` opener, which would report a documented function as undocumented.
// Reading the whole prefix costs one slice per declaration, and the anchored pattern still only accepts a block that ends exactly at the declaration.

export function undocumentedExports(text) {
  const masked = mask(text);
  const found = [];
  DECLARATIONS.forEach((
    pattern,
    kindIndex
  ) => {
    for (const match of masked.matchAll(pattern)) {
      const before = text.slice(0, match.index);
      const documented = /\/\*\*[\s\S]*?\*\/\s*$/.test(before);
      if (documented) continue;
      const line = before.split('\n').length;
      found.push({
        kind: KINDS[kindIndex],
        name: match[1],
        line
      });
    }
  });
  return found.sort((
    a,
    b
  ) => a.line - b.line);
}
