// @last-edited: 2026-10-29 UTC+7.
// @title: format-delimiters — the K&R brace rule, the one-item-per-line list rule, and the two-space indent rule, in one formatter.
// @state: `--write` rewrites every source file to the canonical form, and `--check` exits non-zero when any file is not canonical.
// @dependencies: node:fs/promises, node:path, node:url.

// WHY THIS PROGRAM EXISTS.
// A list and a block are boxes.
// A box whose opening edge is glued to the text above it hides where it starts, and the reader has to guess whether `) {` opens a block or ends a call.
// Written the canonical way, every box announces its own edges: the opener sits on its own line, the items sit one per line, and the closer sits on its own line.
// The rule is a formatter, so the gate is an equality: format(file) === file.

// WHY THIS IS A PARSER AND NOT A REGEX.
// A regex cannot tell an object literal from a block, a parameter list from a call, or a comma inside a string from a comma between two items.
// This program masks strings, templates, comments, and regexes first, then walks the remaining brackets as a tree, so the same answer comes out every time.

// WHY EVERY OPENER STAYS ON ITS LINE.
// The tree writes K&R: the brace, the parenthesis, and the bracket all sit at the end of the line that opens them, so `function foo(a, b) {` and `const items = [` read as one edge.
// Nothing is moved down to a line of its own, which keeps the diff to the shape of the lists and the depth of the indentation rather than to where every delimiter stands.

// WHY A DESTRUCTURED PARAMETER HUGS ITS PARENTHESIS.
// A parameter list whose first parameter is a pattern puts that pattern right after the parenthesis, because `({` reads as one edge and a pattern on its own line reads as a second box that was never opened.
// An array does not do this: every element stands on its own line, so `[` is followed by a break rather than by another opener.

import {
  readFile,
  writeFile,
  readdir
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const EXTENSIONS = new Set(
[
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.jsx',
  '.tsx',
]);

const SKIP_DIRS = new Set(
[
  '.git',
  'node_modules',
  '.kilo',
  'dist',
  'build',
  'tmp',
  'coverage',
  '.next',
  '.vercel',
  '__pycache__',
  '.temp',
]);

const CONTROL = new Set(
[
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'with',
]);

// WHY `async` KEEPS ITS PARENTHESIS ATTACHED.
// A line break between `async` and the parameter list turns the arrow into a call, so `const f = async (a) => a` would parse as a call whose result is then handed a body.
// The same restricted-production rule covers `return`, `throw`, `yield`, and `await`, where a line break ends the statement early.

const GLUE = new Set(
[
  'return',
  'throw',
  'yield',
  'await',
  'async',
  '++',
  '--',
]);

const OBJECT_BEFORE = new Set(
[
  '=',
  '(',
  '[',
  ',',
  ':',
  '?',
  'return',
  'const',
  'let',
  'var',
  'typeof',
  'void',
  'delete',
  'case',
  'default',
  'in',
  'of',
  'new',
  'yield',
  'await',
]);

const LIST_KINDS = new Set(
[
  'array',
  'object',
  'params',
  'import',
]);

function regexAllowed
(
  text,
  index
)
{
  let i = index - 1;
  while (i >= 0 && /\s/.test(text[i])) i -= 1;
  if (i < 0) return true;
  if ('([{,;:!?&|+-*%<>~=^/'.includes(text[i])) return true;
  const before = text.slice(Math.max(0, i - 12), i + 1);
  return /(?:^|[^\w$])(?:return|typeof|case|in|of|new|delete|void|instanceof|yield|await|else|do)$/.test(before);
}

function regexEnd
(
  text,
  start
)
{
  let inClass = false;
  for (let i = start + 1; i < text.length; i += 1)
  {
    const ch = text[i];
    if (ch === '\\')
    {
      i += 1;
      continue;
    }
    if (ch === '\n') return -1;
    if (ch === '[')
    {
      inClass = true;
      continue;
    }
    if (ch === ']')
    {
      inClass = false;
      continue;
    }
    if (ch === '/' && !inClass) return i;
  }
  return -1;
}

function mask
(
  text
)
{
  let out = '';
  let state = 'code';
  let quote = '';
  for (let i = 0; i < text.length; i += 1)
  {
    const ch = text[i];
    const next = text[i + 1];
    if (state === 'code')
    {
      if (ch === '/' && next === '/')
      {
        state = 'line';
        out += '  ';
        i += 1;
        continue;
      }
      if (ch === '/' && next === '*')
      {
        state = 'block';
        out += '  ';
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`')
      {
        state = 'string';
        quote = ch;
        out += ' ';
        continue;
      }
      if (ch === '/' && regexAllowed(text, i))
      {
        const end = regexEnd(text, i);
        if (end !== -1)
        {
          out += ' '.repeat(end - i + 1);
          i = end;
          continue;
        }
      }
      out += ch;
      continue;
    }
    if (state === 'line')
    {
      if (ch === '\n')
      {
        state = 'code';
        out += '\n';
        continue;
      }
      out += ' ';
      continue;
    }
    if (state === 'block')
    {
      if (ch === '*' && next === '/')
      {
        state = 'code';
        out += '  ';
        i += 1;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      continue;
    }
    if (ch === '\\')
    {
      out += '  ';
      i += 1;
      continue;
    }
    if (ch === quote)
    {
      state = 'code';
      out += ' ';
      continue;
    }
    if (ch === '\n' && quote !== '`')
    {
      state = 'code';
      out += '\n';
      continue;
    }
    out += ch === '\n' ? '\n' : ' ';
  }
  return out;
}

function previousToken
(
  masked,
  index
)
{
  let i = index - 1;
  while (i >= 0 && /\s/.test(masked[i])) i -= 1;
  if (i < 0)
  {
    return {
      text: '',
      char: ''
    };
  }
  const ch = masked[i];
  if (!/[A-Za-z0-9_$]/.test(ch))
  {
    return {
      text: ch,
      char: ch
    };
  }
  let start = i;
  while (start > 0 && /[A-Za-z0-9_$]/.test(masked[start - 1])) start -= 1;
  return {
    text: masked.slice(start, i + 1),
    char: ch
  };
}

function nextToken
(
  masked,
  index
)
{
  let i = index + 1;
  while (i < masked.length && /\s/.test(masked[i])) i += 1;
  if (i >= masked.length) return '';
  const ch = masked[i];
  if (!/[A-Za-z0-9_$]/.test(ch))
  {
    if (ch === '=')
    {
      let j = i + 1;
      while (j < masked.length && /\s/.test(masked[j])) j += 1;
      if (masked[j] === '>') return '=>';
    }
    return ch;
  }
  let end = i;
  while (end + 1 < masked.length && /[A-Za-z0-9_$]/.test(masked[end + 1])) end += 1;
  return masked.slice(i, end + 1);
}

// WHY A COLON IS READ TWO WAYS.
// A colon before a brace is a ternary colon when a question mark stands at the same depth earlier in the enclosing pair, and it is a label colon when it does not.
// The two need different answers, because a ternary branch is an object literal whose brace stays attached and a label opens a block whose brace takes its own line.

function ternaryColon
(
  masked,
  pair
)
{
  const parent = pair.parent;
  if (!parent) return false;
  let depth = 0;
  for (let i = parent.open + 1; i < pair.open; i += 1)
  {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{')
    {
      depth += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}')
    {
      depth -= 1;
      continue;
    }
    if (depth !== 0 || ch !== '?') continue;
    const next = masked[i + 1];
    if (next !== '.' && next !== '?') return true;
  }
  return false;
}

function classify
(
  masked,
  pair,
  before,
  after,
  parent
)
{
  if (pair.char === '(')
  {
    if (CONTROL.has(before)) return 'control';
    if (after === '=>') return 'params';
    if (after === '{')
    {
      if (before === 'function' || before === 'async' || before === '*') return 'params';
      if (/^[A-Za-z_$][\w$]*$/.test(before)) return 'params';
    }
    return 'call';
  }
  if (pair.char === '[')
  {
    if (/^[A-Za-z_$][\w$]*$/.test(before)) return 'member';
    if (before === ')' || before === ']' || before === '}') return 'member';
    return 'array';
  }
  if (before === 'import' || before === 'export') return 'import';
  if (before === ':')
  {
    if (parent && parent.kind === 'object') return 'object';
    if (ternaryColon(masked, pair)) return 'object';
    return 'block';
  }
  if (OBJECT_BEFORE.has(before)) return 'object';
  return 'block';
}

function scan
(
  masked
)
{
  const pairs = [];
  const stack = [];
  for (let i = 0; i < masked.length; i += 1)
  {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{')
    {
      stack.push({
        open: i,
        char: ch,
        commas: [],
        parent: null
      });
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}')
    {
      const pair = stack.pop();
      if (!pair) continue;
      pair.close = i;
      pair.parent = stack.length ? stack[stack.length - 1] : null;
      pairs.push(pair);
      continue;
    }
    if (ch === ',' && stack.length) stack[stack.length - 1].commas.push(i);
  }
  pairs.sort(
  (
    a,
    b
  ) => a.open - b.open);
  return pairs;
}

function lineStarts
(
  text
)
{
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

// WHY A BLOCK TAKES ITS OWNING STATEMENT'S INDENT.
// A brace that closes a condition sits at the end of the condition's last line, and that line is a continuation whose indent belongs to the wrapped expression, not to the block.
// Reading the indent off that line puts the block a level too deep, so the brace's indent is read off the statement that owns it instead.

// WHY THE WALK NEVER CROSSES A LINE BREAK.
// A break means the header began on the brace's own line, so the brace's line is the answer and the walk stops there.
// Crossing it would read the indent off the line above, which belongs to whatever closed there and is usually a level too deep.

function statementStart
(
  masked,
  pair,
  closeToOpen
)
{
  let j = pair.open - 1;
  while (j >= 0)
  {
    while (j >= 0 && (masked[j] === ' ' || masked[j] === '\t')) j -= 1;
    if (j < 0) return 0;
    const ch = masked[j];
    if (ch === '\n' || ch === '\r') return j + 1;
    if (ch === ')')
    {
      const open = closeToOpen.get(j);
      if (open === undefined) return j + 1;
      j = open - 1;
      continue;
    }
    if (/[A-Za-z0-9_$]/.test(ch))
    {
      while (j >= 0 && /[A-Za-z0-9_$]/.test(masked[j])) j -= 1;
      continue;
    }
    return j + 1;
  }
  return 0;
}

// WHY A COMMENT LINE IS RECOGNISED BY ITS MARKER AND NOT BY THE MASK.
// The mask blanks comments out, so a comment line looks like an empty line to it; the raw line is the only place the marker survives.

function isCommentLine(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

function indentAt
(
  text,
  starts,
  index
)
{
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi)
  {
    const mid = Math.ceil((lo + hi) / 2);
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  const start = starts[lo];
  let end = start;
  while (end < text.length && text[end] !== '\n') end += 1;
  return /^[ \t]*/.exec(text.slice(start, end))[0].length;
}

function itemRanges
(
  text,
  pair
)
{
  const items = [];
  let cursor = pair.open + 1;
  for (const comma of pair.commas)
  {
    items.push(
    [
      cursor,
      comma
    ]);
    cursor = comma + 1;
  }
  const tail = text.slice(cursor, pair.close);
  pair.trailingComma = false;
  if (tail.trim() === '')
  {
    pair.trailingComma = pair.commas.length > 0;
    return items;
  }
  items.push(
  [
    cursor,
    pair.close
  ]);
  return items;
}

function plan
(
  text,
  masked,
  pairs
)
{
  const starts = lineStarts(text);
  const closeToOpen = new Map(
    pairs.map(
      (pair) =>
      [
        pair.close,
        pair.open
      ]
    )
  );
  const byOpen = new Map();
  for (const pair of pairs)
  {
    const before = previousToken(masked, pair.open);
    const after = nextToken(masked, pair.close);
    pair.kind = classify(masked, pair, before.text, after, pair.parent);
    pair.indent = indentAt(text, starts, pair.open);
    if (pair.kind === 'block')
    {
      pair.indent = indentAt(text, starts, statementStart(masked, pair, closeToOpen));
    }
    pair.glued = GLUE.has(before.text);
    pair.items = itemRanges(text, pair).map(
    ([
      start,
      end
    ]) =>
    {
      const raw = text.slice(start, end);
      const lead = raw.length - raw.replace(/^\s+/, '').length;
      const content = raw.trim();
      return {
        start: start + lead,
        end: start + lead + content.length,
        text: content
      };
    });
    const multiline = text.slice(pair.open, pair.close + 1).includes('\n');
    pair.vertical = LIST_KINDS.has(pair.kind) && pair.items.length >= 2;
    byOpen.set(pair.open, pair);
  }
  return {
    pairs,
    byOpen,
    starts
  };
}

function findNext
(
  ctx,
  after,
  limit
)
{
  const pairs = ctx.pairs;
  let lo = 0;
  let hi = pairs.length;
  while (lo < hi)
  {
    const mid = Math.floor((lo + hi) / 2);
    if (pairs[mid].open <= after) lo = mid + 1;
    else hi = mid;
  }
  if (lo >= pairs.length) return null;
  if (pairs[lo].open >= limit) return null;
  return pairs[lo];
}

// WHY A SHIFTED LINE KEEPS ITS TAIL.
// The shift moves a line's leading indent and nothing else, so the characters after the indent are copied verbatim.
// Trimming the tail would eat the space that separates a keyword from the bracket that follows it, and `if (x)` would become `if(x)`.

function shiftLines
(
  text,
  delta
)
{
  if (!delta) return text;
  const lines = text.split('\n');
  const shifted = lines.map(
    (
      line,
      index
    ) =>
    {
      if (index === 0) return line;
      const body = line.replace(/^[ \t]*/, '');
      if (body.trim() === '') return line;
      const indent = line.length - body.length;
      return ' '.repeat(Math.max(0, indent + delta)) + body;
    }
  );
  return shifted.join('\n');
}

function renderRange
(
  text,
  ctx,
  from,
  to,
  delta
)
{
  let out = '';
  let i = from;
  while (i < to)
  {
    const pair = ctx.byOpen.get(i);
    if (pair && pair.close < to)
    {
      out += renderPair(text, ctx, pair, delta);
      i = pair.close + 1;
      continue;
    }
    const next = findNext(ctx, i, to);
    const end = next ? next.open : to;
    out += shiftLines(text.slice(i, end), delta);
    i = end;
  }
  return out;
}

// WHY A BLANK LINE NEXT TO A COMMENT IS NEVER STRIPPED.
// The comment rule puts a blank line around every comment block, and a comment can be the first thing in a body or an item inside a list, so the blank line beside it is that rule working, not stray space.
// Stripping it made the two formatters fight over the same line: the comment formatter put the blank line back, this one took it away, and neither ever reached a fixed point.

function renderPair
(
  text,
  ctx,
  pair,
  delta,
  hug
)
{
  const opener = text[pair.open];
  const closer = text[pair.close];
  const out = hug ?? pair.indent + delta;
  const pad = ' '.repeat(out);

  if (pair.kind === 'block')
  {

    // WHY THE WHOLE BODY IS SHIFTED, NOT ONLY ITS FIRST LINE.
    // A body's first line is re-indented to one level below the brace, and every line after it is shifted by the same distance, so a source that was already one level shallow comes out level instead of half-corrected.
    // The distance is measured from the first thing in the body, because that is the line the correction is anchored to.

    let first = pair.open + 1;
    while (first < pair.close && /\s/.test(text[first])) first += 1;
    const firstIndent = first < pair.close ? indentAt(text, ctx.starts, first) : pair.indent;

    // WHY AN EMPTY BLOCK STAYS ON ONE LINE.
    // A brace and its closer with nothing between them carry no body to announce, so a line each says less than the pair does on one.

    const body = renderRange(text, ctx, pair.open + 1, pair.close, (out + 2) - firstIndent);
    const lines = body.split('\n');
    while (lines.length && lines[0].trim() === '' && !isCommentLine(lines[1] ?? '')) lines.shift();
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if (!lines.length) return '{}';
    lines[0] = lines[0].replace(/^[ \t]*/, '');
    return `{\n${pad}  ${lines.join('\n')}\n${pad}}`;
  }

  if (!pair.vertical)
  {
    const inner = renderRange(text, ctx, pair.open + 1, pair.close, delta);
    return opener + inner + closer;
  }

  let textOut = opener;

  const firstGap = text.slice(pair.open + 1, pair.items[0] ? pair.items[0].start : pair.close);
  const firstGapLine = firstGap.split('\n').find((line) => line.trim() !== '');
  if (firstGapLine && isCommentLine(firstGapLine)) textOut += '\n';
  const lastGap = text.slice(pair.items.length ? pair.items[pair.items.length - 1].end + 1 : pair.open + 1, pair.close);
  const lastGapLine = [...lastGap.split('\n')].reverse().find((line) => line.trim() !== '');
  const closingBlank = lastGapLine && isCommentLine(lastGapLine);
  let hugged = false;
  for (const
  [
    index,
    item
  ] of pair.items.entries())
  {
    const inner = ctx.byOpen.get(item.start);
    if (index === 0 && pair.kind === 'params' && inner && inner.vertical && LIST_KINDS.has(inner.kind))
    {
      textOut += renderPair(text, ctx, inner, delta, out);
      textOut += renderRange(text, ctx, inner.close + 1, item.end, delta);
      hugged = true;
      if (pair.items.length > 1 || pair.trailingComma) textOut += ',';
      continue;
    }
    hugged = false;
    const itemSource = indentAt(text, ctx.starts, item.start);
    const itemDelta = (out + 2) - itemSource;
    const rendered = renderRange(text, ctx, item.start, item.end, itemDelta);
    if (isCommentLine(item.text.split('\n')[0])) textOut += '\n';
    textOut += `\n${pad}  ${rendered}`;
    if (index < pair.items.length - 1 || pair.trailingComma) textOut += ',';
  }
  textOut += hugged ? closer : `\n${pad}${closingBlank ? '\n' + pad : ''}${closer}`;
  return textOut;
}

export function formatDelimiters
(
  text
)
{
  const crlf = text.includes('\r\n');
  const source = text.replace(/\r\n/g, '\n');
  const masked = mask(source);
  const pairs = scan(masked);
  if (!pairs.length) return source;
  const ctx = plan(source, masked, pairs);
  const rendered = renderRange(source, ctx, 0, source.length, 0);
  const out = rendered.split('\n').map((line) => line.replace(/[ \t]+$/, '')).join('\n');
  const body = out.endsWith('\n') ? out : `${out}\n`;
  return crlf ? body.replace(/\n/g, '\r\n') : body;
}

async function walk
(
  dir,
  prefix = ''
)
{
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true }))
  {
    if (SKIP_DIRS.has(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(path.join(dir, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

async function targets()
{
  return (await walk(root))
    .filter((file) => EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort();
}

export async function checkFormat()
{
  const files = await targets();
  const changed = [];
  for (const file of files)
  {
    const text = await readFile(path.join(root, file), 'utf8');
    if (formatDelimiters(text) !== text) changed.push(file);
  }
  return {
    total: files.length,
    changed
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
  const write = process.argv.includes('--write');
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const files = only.length ? only : await targets();
  const changed = [];
  for (const file of files)
  {
    const full = path.join(root, file);
    const text = await readFile(full, 'utf8');
    const next = formatDelimiters(text);
    if (next === text) continue;
    changed.push(file);
    if (write) await writeFile(full, next);
  }
  if (!changed.length)
  {
    console.log(`delimiter format ok: ${files.length} files`);
    process.exit(0);
  }
  if (write)
  {
    console.log(`delimiter format wrote ${changed.length} of ${files.length} files`);
    process.exit(0);
  }
  console.error(`delimiter format: ${changed.length} of ${files.length} files are not canonical`);
  for (const file of changed.slice(0, 40)) console.error(`  ${file}`);
  process.exit(1);
}
