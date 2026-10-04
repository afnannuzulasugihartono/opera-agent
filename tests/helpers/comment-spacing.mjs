// @last-edited: 2026-10-04 19:14 UTC+7.
// @title: comment-spacing — shared classifier for the blank-line rule.
// @state: One implementation, used by the lock; string and template contents are never read as comments.
// @dependencies: none.

const MARKERS = {
  '.py': { line: ['#'] },
  '.yml': { line: ['#'] },
  '.yaml': { line: ['#'] },
  '.sql': { line: ['--'], needsSpace: true },
  '.css': { line: [] },
  '.json': { skip: true },
};

// WHY per dialect: `--` needs whitespace after it or a CSS custom property
// (`--bg`) reads as a comment; `#` is a comment in Python and YAML but an id
// selector in CSS and a json operator in SQL. A dialect that never carries a
// comment is skipped, so no data file is judged by this rule.

function classifyJs(text) {
  const lines = text.split('\n');
  const out = [];
  let mode = 'code';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const rec = { code: false, comment: false, string: false };
    for (let j = 0; j < line.length; j += 1) {
      const c = line[j];
      const d = line[j + 1];
      if (mode === 'code') {
        if (c === '/' && d === '/') { rec.comment = true; break; }
        if (c === '/' && d === '*') { rec.comment = true; mode = 'block'; j += 1; continue; }
        if (c === '"' || c === "'") { rec.string = true; mode = c; continue; }
        if (c === '`') { rec.string = true; mode = 'template'; continue; }
        rec.code = true;
      } else if (mode === 'block') {
        rec.comment = true;
        if (c === '*' && d === '/') { mode = 'code'; j += 1; }
      } else if (mode === 'template') {
        rec.string = true;
        if (c === '\\') { j += 1; continue; }
        if (c === '$' && d === '{') { mode = 'code'; j += 1; continue; }
        if (c === '`') mode = 'code';
      } else {
        rec.string = true;
        if (c === '\\') { j += 1; continue; }
        if (c === mode) mode = 'code';
      }
    }
    out.push(rec);
  }
  return out;
}

function classifyHash(text, markers) {
  const lines = text.split('\n');
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    const rec = { code: false, comment: false, string: false };
    if (inBlock) {
      rec.comment = true;
      if (/\*\//.test(line)) inBlock = false;
      out.push(rec);
      continue;
    }
    if (/^\s*\/\*/.test(line)) {
      rec.comment = true;
      if (!/\*\//.test(line)) inBlock = true;
      out.push(rec);
      continue;
    }
    const trimmed = line.trimStart();
    if (markers.line.some((m) => trimmed.startsWith(m) && (!markers.needsSpace || /^--\s/.test(trimmed)))) {
      rec.comment = true;
      out.push(rec);
      continue;
    }
    let quote = null;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (quote) {
        rec.string = true;
        if (c === '\\') { i += 1; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; rec.string = true; continue; }
      rec.code = true;
    }
    out.push(rec);
  }
  return out;
}

function classifyHtml(text) {
  return text.split('\n').map((line) => {
    const isComment = /^\s*<!--/.test(line) || /-->/.test(line);
    return { code: !isComment, comment: isComment, string: false };
  });
}

export function commentClasses(text, ext) {
  if (ext === '.html' || ext === '.htm') return classifyHtml(text);
  if (ext === '.mjs' || ext === '.cjs' || ext === '.js' || ext === '.ts') return classifyJs(text);
  if (MARKERS[ext] && MARKERS[ext].skip) return null;
  if (MARKERS[ext]) return classifyHash(text, MARKERS[ext]);
  return null;
}

function isCommentLine(lines, classes, i) {
  const c = classes[i];
  if (!c || !c.comment || c.string) return false;
  return !c.code || /^\s*(\*|\/\*|\*\/)/.test(lines[i]);
}

// WHY blocks and not lines: the rule is about the gap around a block, so only a
// block's first and last line are judged. Returns one message per violation.

export function spacingViolations(file, text, ext) {
  const classes = commentClasses(text, ext);
  if (!classes) return [];
  const lines = text.split('\n');
  const violations = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!isCommentLine(lines, classes, i)) continue;
    if (i > 0 && isCommentLine(lines, classes, i - 1)) continue;
    if (i > 0 && lines[i - 1].trim() !== '') violations.push(`${file}:${i + 1} no blank line before the comment block`);
    let end = i;
    while (end + 1 < lines.length && isCommentLine(lines, classes, end + 1)) end += 1;
    if (end + 1 < lines.length && lines[end + 1].trim() !== '') violations.push(`${file}:${end + 2} no blank line after the comment block`);
    i = end;
  }
  return violations;
}