// @last-edited: 2026-10-29 UTC+7.
// @title: vertical-lists — one item per line for every comma-separated construct.
// @state: masks code, finds every bracket pair that opens and closes on one line, and reports the ones that hold two or more items.
// @dependencies: none.

// WHY THIS RULE EXISTS.
// A list written across one line hides its length: the reader counts commas to learn how many things are in it, and a long line has to be scanned left to right before its shape is clear.
// Written one item per line, the same list announces its length before it is read, and a new item is a new line rather than a wider line.

// WHAT COUNTS AS A LIST.
// Array literals, object literals, destructuring patterns, parameter lists, and import/export specifiers.
// Call arguments and control-flow parentheses are not lists in this sense: their items are expressions an editor wraps for width, not entries a reader scans as a set.

const CONTROL = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'with'
]);

const BLOCK_BEFORE = new Set([
  ')',
  ';',
  '{',
  '}',
  'else',
  'try',
  'finally',
  'do'
]);

const OBJECT_BEFORE = new Set([
  '=',
  '(',
  '[',
  ',',
  ':',
  '?',
  'return',
  'typeof',
  'void',
  'delete',
  'case',
  'const',
  'let',
  'var'
]);

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
      if (ch === '/' && regexAllowed(text, i)) {
        const end = regexEnd(text, i);
        if (end !== -1) {
          out += ' '.repeat(end - i + 1);
          i = end;
          continue;
        }
      }
      out += ch;
      continue;
    }
    if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        out += '\n';
        continue;
      }
      out += ' ';
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code';
        out += '  ';
        i += 1;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
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
    if (ch === '\n' && quote !== '`') {
      state = 'code';
      out += '\n';
      continue;
    }
    out += ch === '\n' ? '\n' : ' ';
  }
  return out;
}

function regexAllowed(
  text,
  index
) {
  let i = index - 1;
  while (i >= 0 && /\s/.test(text[i])) i -= 1;
  if (i < 0) return true;
  if ('([{,;:!?&|+-*%<>~=^/'.includes(text[i])) return true;
  const before = text.slice(Math.max(0, i - 12), i + 1);
  return /(?:^|[^\w$])(?:return|typeof|case|in|of|new|delete|void|instanceof|yield|await|else|do)$/.test(before);
}

function regexEnd(
  text,
  start
) {
  let inClass = false;
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '\n') return -1;
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === ']') {
      inClass = false;
      continue;
    }
    if (ch === '/' && !inClass) return i;
  }
  return -1;
}

function previousToken(
  masked,
  index
) {
  let i = index - 1;
  while (i >= 0 && /\s/.test(masked[i])) i -= 1;
  if (i < 0) {
    return {
      text: '',
      char: ''
    };
  }
  const ch = masked[i];
  if (!/[A-Za-z0-9_$]/.test(ch)) {
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

function nextToken(
  masked,
  index
) {
  let i = index + 1;
  while (i < masked.length && /\s/.test(masked[i])) i += 1;
  if (i >= masked.length) return '';
  const ch = masked[i];
  if (!/[A-Za-z0-9_$]/.test(ch)) {
    if (ch === '=') {
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

function classify(
  masked,
  open,
  close
) {
  const before = previousToken(masked, open.index);
  const after = nextToken(masked, close.index);
  if (open.char === '(') {
    if (CONTROL.has(before.text)) return null;
    if (after === '=>') return 'parameter';
    if (after === '{') {
      if (before.text === 'function' || before.text === 'async' || before.text === '*') return 'parameter';
      if (/^[A-Za-z_$][\w$]*$/.test(before.text)) return 'parameter';
      const beforeThat = previousToken(masked, open.index - before.text.length);
      if (beforeThat.text === 'function') return 'parameter';
    }
    return null;
  }
  if (open.char === '[') {
    if (OBJECT_BEFORE.has(before.text)) return 'array';
    if (before.text === 'of' || before.text === 'in') return 'array';
    if (/^[A-Za-z_$][\w$]*$/.test(before.text)) return null;
    if (/[A-Za-z0-9_$)\]}"]/.test(before.char)) return null;
    return 'array';
  }
  if (before.text === 'import' || before.text === 'export') return 'import-export';
  if (BLOCK_BEFORE.has(before.text)) return null;
  if (OBJECT_BEFORE.has(before.text)) return 'object';
  if (before.text === 'class') return null;
  if (/^[A-Za-z_$][\w$]*$/.test(before.text)) {
    const beforeThat = previousToken(masked, open.index - before.text.length);
    if (beforeThat.text === 'class') return null;
    if (beforeThat.text === 'function') return 'object';
  }
  return null;
}

export function listViolations(text) {
  return walkLists(text).violations;
}

// WHY LIST ITEMS ARE COUNTED OUT.
// A list written one item per line makes a file longer without making it bigger, so a gate that counts lines charges a file for the shape of its data.
// The lines between a list's opener and its closer are that list's items, and counting them out leaves the lines that carry code.
// The measure then means the same thing before and after a list is reflowed, which is what lets a size gate survive the rule that makes the lists vertical.

export function listItemLines(text) {
  return walkLists(text).items;
}

function walkLists(text) {
  const masked = mask(text);
  const stack = [];
  const violations = [];
  const items = new Set();
  let line = 1;
  for (let i = 0; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '\n') {
      line += 1;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push({
        char: ch,
        index: i,
        line,
        commas: 0
      });
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      const open = stack.pop();
      if (!open) continue;
      const kind = classify(masked, open, {
        index: i
      });
      if (!kind) continue;
      if (open.commas >= 1 && line === open.line) {
        violations.push({
          line: open.line,
          kind,
          items: open.commas + 1
        });
      }
      if (line > open.line) {
        for (let item = open.line + 1; item < line; item += 1) items.add(item);
      }
      continue;
    }
    if (ch === ',' && stack.length) stack[stack.length - 1].commas += 1;
  }
  return {
    violations,
    items
  };
}

// WHY INDENTATION IS MEASURED WITH THE SAME MASK.
// Two spaces per level is only readable if every line agrees; an odd column is a typo or a level nobody decided.
// A line inside a template literal or a block comment is content, not structure, so its indentation is left alone.

export function indentViolations(text) {
  const masked = mask(text).split('\n');
  const lines = text.split('\n');
  const violations = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue;
    if (masked[i].trim() === '') continue;
    const lead = /^[ \t]*/.exec(lines[i])[0];
    if (lead.includes('\t')) {
      violations.push({
        line: i + 1,
        kind: 'tab'
      });
      continue;
    }
    if (lead.length % 2 !== 0) {
      violations.push({
        line: i + 1,
        kind: `indent ${lead.length}`
      });
    }
  }
  return violations;
}
