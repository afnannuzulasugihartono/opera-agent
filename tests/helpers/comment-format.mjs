// @last-edited: 2026-10-21 UTC+7.
// @title: comment-format — one structural rule for comment spacing and sentence lines.
// @state: A comment block at column zero is a section header and gets a blank line before and after.
// An indented block documents the code below it and is left alone.
// A sentence is written on one line; the formatter joins a wrapped sentence and splits a line that holds two.
// The classifier tracks block comments, templates, Python docstrings and YAML block scalars so embedded data is never rewritten.
// @dependencies: none.

const LINE_MARKERS = {
  '.js': ['//', '/*'],
  '.mjs': ['//', '/*'],
  '.cjs': ['//', '/*'],
  '.ts': ['//', '/*'],
  '.jsx': ['//', '/*'],
  '.tsx': ['//', '/*'],
  '.sql': ['--', '/*'],
  '.css': ['/*'],
  '.html': ['<!--', '//', '/*'],
  '.htm': ['<!--', '//', '/*'],
  '.py': ['#'],
  '.yml': ['#', '//'],
  '.yaml': ['#', '//'],
  '.toml': ['#'],
  '.example': ['#'],
  '.cmd': ['REM', '::'],
  '.bat': ['REM', '::'],
  '': ['#'],
};

const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.html', '.htm']);
const HTML_EXTENSIONS = new Set(['.html', '.htm']);

const DIRECTIVE = /^(?:eslint\b|@ts-[a-z-]+|prettier-ignore\b|#region\b|#endregion\b|istanbul\b|c8\b|v8\b|webpack\b|@flow\b|jshint\b|global\b|exported\b|sourceMappingURL\b|sourceURL\b|yaml-language-server\b|type:\s|pragma:\s|shellcheck\b|vim?:\s|fmt:\s|noqa\b|nosec\b|kics-scan\b|trivy\b|hadolint\b|pylint:\s|mypy:\s|ruff:\s|biome-ignore\b|rome-ignore\b|deno-(?:lint|fmt)\b)/;
const ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'etc', 'vs', 'cf', 'approx', 'resp', 'al',
  'dr', 'mr', 'mrs', 'ms', 'st', 'no', 'fig', 'eq', 'sec', 'ch',
  'vol', 'pp', 'ed', 'trans', 'rev', 'u.s', 'u.k', 'e.u', 'a.m', 'p.m',
]);

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function stripStar(text) {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('*')) return trimmed;
  return trimmed.slice(1).replace(/^\s/, '');
}

function yamlScalarRanges(lines) {
  const ranges = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^(\s*)[^\s#][^:]*:\s*[|>][-+]?\d?\s*$/.exec(lines[i]);
    if (!open) continue;
    const keyIndent = open[1].length;
    let end = i;
    let node = false;
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === '') { end = j; continue; }
      if (indentOf(line) <= keyIndent) break;
      if (/node\s+-e\s*"/.test(line)) node = true;
      end = j;
    }
    ranges.push({ start: i + 1, end, node });
    i = end;
  }
  return ranges;
}

function pythonStringMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let triple = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (triple) {
      mask[i] = true;
      if (line.includes(triple)) triple = null;
      continue;
    }
    if (line.trimStart().startsWith('#')) continue;
    for (const quote of ['"""', "'''"]) {
      const count = line.split(quote).length - 1;
      if (count % 2 === 1) { triple = quote; mask[i] = true; break; }
    }
  }
  return mask;
}

function regexEnd(line, start) {
  let inClass = false;
  for (let i = start + 1; i < line.length; i += 1) {
    const c = line[i];
    if (c === '\\') { i += 1; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === ']') { inClass = false; continue; }
    if (c === '/' && !inClass) return i;
  }
  return -1;
}

function regexAllowed(line, index) {
  let i = index - 1;
  while (i >= 0 && /\s/.test(line[i])) i -= 1;
  if (i < 0) return true;
  if ('([{,;:!?&|+-*%<>~=^/'.includes(line[i])) return true;
  const before = line.slice(0, i + 1);
  return /(?:^|[^\w$])(?:return|typeof|case|in|of|new|delete|void|instanceof|yield|await|else|do)$/.test(before);
}

function templateAfter(line, inTemplate) {
  let state = inTemplate ? 'template' : 'code';
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    const d = line[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') break;
      if (c === '/' && d === '*') {
        const end = line.indexOf('*/', i + 2);
        if (end === -1) break;
        i = end + 1;
        continue;
      }
      if (c === '/' && regexAllowed(line, i)) {
        const end = regexEnd(line, i);
        if (end !== -1) { i = end; continue; }
      }
      if (c === "'" || c === '"') {
        const quote = c;
        i += 1;
        while (i < line.length) {
          if (line[i] === '\\') { i += 2; continue; }
          if (line[i] === quote) break;
          i += 1;
        }
        continue;
      }
      if (c === '`') { state = 'template'; continue; }
    } else {
      if (c === '\\') { i += 1; continue; }
      if (c === '`') { state = 'code'; continue; }
    }
  }
  return state === 'template';
}

function markerOf(trimmed, ext) {
  for (const marker of LINE_MARKERS[ext] || []) {
    if (marker === 'REM') {
      if (/^@?rem(?:\s|$)/i.test(trimmed)) return 'REM';
      continue;
    }
    if (marker === '::' && trimmed.startsWith('::')) return '::';
    if (marker !== 'REM' && marker !== '::' && trimmed.startsWith(marker)) return marker;
  }
  return null;
}

function record(text, ext) {
  const lines = text.split('\n');
  const records = new Array(lines.length).fill(null);
  const isYaml = ext === '.yml' || ext === '.yaml';
  const scalarRanges = isYaml ? yamlScalarRanges(lines) : [];
  const pyMask = ext === '.py' ? pythonStringMask(lines) : null;
  const jsLike = JS_EXTENSIONS.has(ext);
  let block = null;
  let blockId = 0;
  let inTemplate = false;

  const scalarAt = (index) => scalarRanges.find((range) => index >= range.start && index <= range.end);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.slice(0, line.length - trimmed.length);

    if (block) {
      const close = block.family === 'html' ? '-->' : '*/';
      const at = trimmed.indexOf(close);
      const text = at === -1 ? trimmed : trimmed.slice(0, at).trim();
      records[i] = {
        kind: 'block',
        family: block.family,
        id: block.id,
        indent: block.indent,
        text: block.family === 'js' ? stripStar(text) : text,
        raw: line,
      };
      if (at !== -1) block = null;
      continue;
    }

    if (jsLike && inTemplate) {
      inTemplate = templateAfter(line, true);
      continue;
    }

    if (pyMask && pyMask[i]) continue;

    const scalar = isYaml ? scalarAt(i) : null;
    if (scalar) {
      if (scalar.node && trimmed.startsWith('//')) {
        records[i] = {
          kind: 'line',
          marker: '//',
          indent,
          text: trimmed.slice(2).replace(/^\s/, ''),
          raw: line,
        };
      }
      continue;
    }

    const continued = i > 0
      && records[i - 1] === null
      && lines[i - 1].trimEnd().endsWith('\\');
    if (continued) {
      if (jsLike) inTemplate = templateAfter(line, false);
      continue;
    }

    const isHtml = HTML_EXTENSIONS.has(ext);
    let family = null;
    let openLength = 0;
    let jsdoc = false;
    if (isHtml && trimmed.startsWith('<!--')) {
      family = 'html';
      openLength = 4;
    } else if (trimmed.startsWith('/*')
      && (JS_EXTENSIONS.has(ext) || ext === '.css' || ext === '.sql')) {
      family = 'js';
      openLength = 2;
      jsdoc = trimmed.startsWith('/**');
    }

    if (family) {
      const close = family === 'html' ? '-->' : '*/';
      let rest = trimmed.slice(openLength);
      if (jsdoc) rest = rest.slice(1);
      const at = rest.indexOf(close);
      const id = blockId;
      blockId += 1;
      if (at !== -1) {
        records[i] = {
          kind: 'block',
          family,
          id,
          indent,
          text: (family === 'js' ? stripStar(rest.slice(0, at)) : rest.slice(0, at)).trim(),
          raw: line,
          single: true,
          jsdoc,
        };
      } else {
        records[i] = {
          kind: 'block',
          family,
          id,
          indent,
          text: (family === 'js' ? stripStar(rest) : rest).trim(),
          raw: line,
          jsdoc,
        };
        block = { family, id, indent };
      }
      continue;
    }

    const marker = markerOf(trimmed, ext);
    if (marker) {
      if (marker === '#' && trimmed.startsWith('#!')) continue;
      let text;
      let outMarker = marker;
      if (marker === 'REM') {
        const rem = /^@?rem(?:\s|$)/i.exec(trimmed);
        text = trimmed.slice(rem[0].length);
        outMarker = 'REM';
      } else {
        text = trimmed.slice(marker.length);
      }
      records[i] = {
        kind: 'line',
        marker: outMarker,
        indent,
        text: text.replace(/^\s/, ''),
        raw: line,
      };
      continue;
    }

    if (jsLike) inTemplate = templateAfter(line, false);
  }
  return records;
}

function groupsOf(records) {
  const groups = [];
  for (let i = 0; i < records.length; i += 1) {
    const current = records[i];
    if (!current) continue;
    if (current.kind === 'line') {
      let end = i;
      while (end + 1 < records.length
        && records[end + 1]
        && records[end + 1].kind === 'line'
        && records[end + 1].marker === current.marker
        && records[end + 1].indent === current.indent) end += 1;
      groups.push({ kind: 'line', start: i, end, records: records.slice(i, end + 1) });
      i = end;
      continue;
    }
    let end = i;
    while (end + 1 < records.length
      && records[end + 1]
      && records[end + 1].kind === 'block'
      && records[end + 1].id === current.id) end += 1;
    groups.push({ kind: 'block', start: i, end, records: records.slice(i, end + 1) });
    i = end;
  }
  return groups;
}

function directiveTexts(texts) {
  const first = texts.find((text) => text.trim() !== '');
  return Boolean(first && DIRECTIVE.test(first.trim()));
}

function nonProse(texts) {
  return texts.some((text) => {
    const line = text.trim();
    if (!line) return false;
    if (/^(?:```|\||> |> )/.test(line)) return true;
    if (/^(?:py|python3?|node|npm|npx|pnpm|yarn|bun|deno|git|gh|curl|wget|supabase|docker)\s/.test(line)) return true;
    if (/^(?:\.{1,2}[\\/]|[A-Za-z]:[\\/]|https?:\/\/|wss?:\/\/)/.test(line)) return true;
    if (/^(?:const|let|var|function|class|import|export)\b.*[;{=]/.test(line)) return true;
    if (/^(?:if|for|while|switch|catch)\s*\(/.test(line)) return true;
    if (/^(?:return|throw)\b.*[;({[]/.test(line)) return true;
    if (/^(?:SELECT|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|WITH|BEGIN|COMMIT)\b.*[;(]/.test(line)) return true;
    if (/^[{};]/.test(line)) return true;
    if (/^\]/.test(line)) return true;
    if (/^\[[^\]]*\]\s*[,;.)\]]?$/.test(line)) return true;
    if (/^<[/!]?[a-z][^>]*>$/i.test(line)) return true;
    return false;
  });
}

function codeSpans(text) {
  const spans = [];
  for (const match of text.matchAll(/`[^`]*`/g)) spans.push([match.index, match.index + match[0].length]);
  return spans;
}

function quotedSpans(text) {
  const spans = [];
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\') { i += 1; continue; }
    if (text[i] !== '"') continue;
    if (start === -1) start = i;
    else { spans.push([start, i + 1]); start = -1; }
  }
  return spans;
}

function inSpans(index, spans) {
  return spans.some(([start, end]) => index >= start && index < end);
}

function sentenceCuts(text) {
  const code = codeSpans(text);
  const quotes = quotedSpans(text);
  const cuts = [];
  for (const match of text.matchAll(/[.!?]+["')\]]*\s+/g)) {
    const at = match.index;
    if (inSpans(at, code) || inSpans(at, quotes)) continue;

    const run = /^[.!?]+/.exec(match[0])[0];
    if (/^\.{2,}$/.test(run)) continue;

    const before = text.slice(0, at).trimEnd();
    const token = (/([A-Za-z][\w.]*|\d[\w.]*)$/.exec(before) || [])[1] || '';
    if (ABBREVIATIONS.has(token.toLowerCase())) continue;
    if (/^[A-Z]$/.test(token)) continue;

    const punctuation = /^[.!?]+["')\]]*/.exec(match[0])[0];
    const cut = at + punctuation.length;
    if (cut < text.length) cuts.push(cut);
  }
  return cuts;
}

function splitSentences(text) {
  const cuts = sentenceCuts(text);
  if (!cuts.length) return [text.trim()];
  const sentences = [];
  let start = 0;
  for (const cut of cuts) {
    sentences.push(text.slice(start, cut).trim());
    start = cut;
  }
  sentences.push(text.slice(start).trim());
  return sentences.filter(Boolean);
}

function paragraphsOf(texts) {
  const paragraphs = [];
  let current = [];
  const flush = () => {
    if (current.length) paragraphs.push(current);
    current = [];
  };
  for (const text of texts) {
    if (text.trim() === '') {
      flush();
      paragraphs.push(null);
      continue;
    }
    if (/^@[\w-]+/.test(text.trim())) {
      flush();
      current.push(text);
      continue;
    }
    if (/^(?:[-*+]|\d+[.)]|[A-Za-z][.)])\s/.test(text.trim())) {
      flush();
      current.push(text);
      continue;
    }
    current.push(text);
  }
  flush();
  return paragraphs;
}

function reflowTexts(texts) {
  if (directiveTexts(texts) || nonProse(texts)) return null;
  let listIndent = null;
  let afterBlank = true;
  for (const text of texts) {
    if (text.trim() === '') { afterBlank = true; listIndent = null; continue; }
    const match = /^(\s*)(?:[-*+]|\d+[.)]|[A-Za-z][.)])\s/.exec(text);
    if (!match) continue;
    const indent = match[1].length;
    if (afterBlank || listIndent === null) { listIndent = indent; afterBlank = false; continue; }
    if (indent > listIndent) return null;
  }
  const paragraphs = paragraphsOf(texts);
  const out = [];
  for (const paragraph of paragraphs) {
    if (paragraph === null) { out.push(null); continue; }
    const joined = paragraph.map((text) => text.trim()).filter(Boolean).join(' ');
    if (!joined) continue;
    const list = /^([-*+]|\d+[.)]|[A-Za-z][.)])\s+/.exec(joined);
    if (list) {
      const body = joined.slice(list[0].length);
      if (nonProse([body])) return null;
      const sentences = splitSentences(body);
      out.push(`${list[1]} ${sentences[0]}`);
      const pad = ' '.repeat(list[0].length);
      for (const sentence of sentences.slice(1)) out.push(`${pad}${sentence}`);
      continue;
    }
    if (nonProse([joined])) return null;
    for (const sentence of splitSentences(joined)) out.push(sentence);
  }
  return out;
}

function formatLineGroup(group) {
  const first = group.records[0];
  const texts = group.records.map((line) => line.text);
  const original = group.records.map((line) => line.raw);
  if (first.marker === '#' && first.text.startsWith('!')) return original;

  const prefix = `${first.indent}${first.marker} `;

  if (first.marker === 'REM' || first.marker === '::') {
    const merged = [];
    for (const line of group.records) {
      const text = line.text.trim();
      if (!text) { merged.push(null); continue; }
      const previous = merged[merged.length - 1];
      const continuation = typeof previous === 'string'
        && previous.split(/\s+/).length >= 3
        && !/[.!?]["')\]]?$/.test(previous)
        && /^[a-z]/.test(text);
      if (continuation) merged[merged.length - 1] = `${previous} ${text}`;
      else merged.push(text);
    }
    while (merged.length && merged[0] === null) merged.shift();
    while (merged.length && merged[merged.length - 1] === null) merged.pop();
    if (merged.length === 0) return [''];
    const out = [];
    for (const text of merged) {
      if (text === null) { out.push(''); continue; }
      for (const sentence of splitSentences(text)) out.push(`${prefix}${sentence}`);
    }
    return out;
  }

  const reflowed = reflowTexts(texts);
  if (!reflowed) return original;
  while (reflowed.length && reflowed[0] === null) reflowed.shift();
  while (reflowed.length && reflowed[reflowed.length - 1] === null) reflowed.pop();
  if (reflowed.length === 0) return [''];

  return reflowed.map((text) => (text === null ? '' : `${prefix}${text}`));
}

function formatBlockGroup(group) {
  const first = group.records[0];
  const original = group.records.map((line) => line.raw);
  if (first.raw.trimStart().startsWith('/*!')) return original;

  const texts = group.records.map((line) => line.text);
  if (directiveTexts(texts) || nonProse(texts)) return original;
  if (first.family === 'html' && texts.join(' ').includes('<')) return original;
  if (first.family === 'html' && texts.join(' ').includes('--')) return original;
  if (!texts.some((text) => text.trim() !== '')) return original;

  const body = texts.slice();
  while (body.length && body[0].trim() === '') body.shift();
  while (body.length && body[body.length - 1].trim() === '') body.pop();

  const reflowed = reflowTexts(body);
  if (!reflowed) return original;

  const onlyOne = reflowed.filter((text) => text !== null).length === 1;
  if (first.single && onlyOne && reflowed[0] === first.text.trim()) return original;

  if (first.family === 'html') {
    const indent = first.indent;
    const out = [];
    for (const text of reflowed) {
      if (text === null) out.push('');
      else out.push(`${indent}<!-- ${text} -->`);
    }
    return out;
  }

  const indent = first.indent;
  const opening = first.jsdoc ? `${indent}/**` : `${indent}/*`;
  const out = [opening];
  for (const text of reflowed) {
    out.push(text === null ? `${indent} *` : `${indent} * ${text}`);
  }
  out.push(`${indent} */`);
  return out;
}

function formatSentences(text, ext) {
  const lines = text.split('\n');
  const groups = groupsOf(record(text, ext));
  const byStart = new Map(groups.map((group) => [group.start, group]));
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const group = byStart.get(i);
    if (!group) { out.push(lines[i]); continue; }
    const formatted = group.kind === 'line' ? formatLineGroup(group) : formatBlockGroup(group);
    out.push(...formatted);
    i = group.end;
  }
  return out.join('\n');
}

function addSpacing(text, ext) {
  const lines = text.split('\n');
  const records = record(text, ext);
  const groups = groupsOf(records);
  const byStart = new Map(groups.map((group) => [group.start, group]));
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const group = byStart.get(i);
    if (!group) { out.push(lines[i]); continue; }

    const first = group.records[0];
    const header = first.indent === '' && !directiveTexts(group.records.map((line) => line.text));
    if (header && out.length > 0 && out[out.length - 1].trim() !== '' && records[i - 1] === null) {
      out.push('');
    }
    for (let n = group.start; n <= group.end; n += 1) out.push(lines[n]);
    if (header
      && group.end + 1 < lines.length
      && lines[group.end + 1].trim() !== ''
      && records[group.end + 1] === null) {
      out.push('');
    }
    i = group.end;
  }
  return out.join('\n');
}

export function formatComments(text, ext = '') {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const normalized = eol === '\n' ? text : text.split('\r\n').join('\n');
  const sentences = formatSentences(normalized, ext);
  const spaced = addSpacing(sentences, ext);
  return eol === '\n' ? spaced : spaced.split('\n').join('\r\n');
}

export function commentLineMask(text, ext = '') {
  return record(text, ext).map(Boolean);
}
