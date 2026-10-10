// @last-edited: 2026-10-10 09:00 UTC+7.
// @title: comment-spacing — shared classifier for the blank-line rule.
// @state: One implementation, used by the lock; string, template and regex contents are
// never read as comments, and a script tag or a shell block scalar is read in the
// language that actually runs inside it.
// @dependencies: none.

const MARKERS = {
  '.py': { line: ['#'] },
  '.yml': { line: ['#'], embeddedJs: true },
  '.yaml': { line: ['#'], embeddedJs: true },
  '.sql': { line: ['--'], needsSpace: true },
  '.css': { line: [] },
  '.json': { skip: true },
  '.toml': { line: ['#'] },
  '.example': { line: ['#'] },
};

// WHY the empty dialect: path.extname reports '' for `.gitignore`, `CODEOWNERS` and
// `_headers`, and all three comment with `#`. Without this key the walk returned null
// for every one of them, so the rule claimed a full-tree pass while never opening the
// ignore files at the root of the tree.

MARKERS[''] = { line: ['#'] };

// WHY per dialect: `--` needs whitespace after it or a CSS custom property
// (`--bg`) reads as a comment; `#` is a comment in Python and YAML but an id
// selector in CSS and a json operator in SQL. A dialect that never carries a
// comment is skipped, so no data file is judged by this rule.

// A `/` in code position opens a regular expression rather than dividing whenever the
// token before it is one where JavaScript allows a literal. Anything else — an
// identifier, a closing bracket, a number — means division, and is left alone.

const REGEX_PRECEDING_CHARS = '([{,;:!?&|+-*%<>~=^/';
const REGEX_PRECEDING_WORDS = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof',
  'do', 'else', 'yield', 'await',
]);

/**
 * Where a regular expression starting at `start` ends, or -1 when it is not one.
 *
 * Returning -1 for an unopened or unterminated literal is what keeps this honest: a
 * real `//` or a block opener met the scanner before any closing slash, so the slash
 * was a division after all and the caller falls through to ordinary scanning. It
 * cannot swallow the comment that follows it, which is the one way this heuristic
 * could hide a comment it used to see.
 *
 * @param {string} line the line being scanned
 * @param {number} start index of the opening slash
 * @param {string | null} prevSig last significant character before it
 * @param {string} prevWord word ending at that character, if any
 * @returns {number} index of the closing slash, or -1
 */

function regexLiteralEnd(line, start, prevSig, prevWord) {
  const allowed = (prevSig !== null && REGEX_PRECEDING_CHARS.includes(prevSig))
    || REGEX_PRECEDING_WORDS.has(prevWord);
  if (!allowed) return -1;

  let inClass = false;
  for (let k = start + 1; k < line.length; k += 1) {
    const c = line[k];
    if (c === '\\') { k += 1; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '/') {
      if (line[k + 1] === '/' || line[k + 1] === '*') return -1;
      return k;
    }
  }
  return -1;
}

/**
 * Classify JavaScript line by line, optionally stopping where an embedded script ends.
 *
 * @param {string[]} lines the source split on newlines
 * @param {{stopAtBareQuote?: boolean}} [options] stop where a bare `"` opens in code
 *   position — inside a shell double-quoted string that quote is the shell's own, not
 *   the start of a JavaScript string
 * @returns {{recs: ({code: boolean, comment: boolean, string: boolean} | null)[], stopAt: number}}
 */

function scanJs(lines, options = {}) {
  const stopAtBareQuote = options.stopAtBareQuote === true;
  const recs = [];
  let mode = 'code';
  let stopAt = -1;

  // WHY pending and depth rather than a single mode: `${` opens an expression inside a
  // template, and the scanner used to treat the backtick that closes it as a fresh opening
  // — so the rest of the file was read as template text. Comments then classified as
  // strings, spacingViolations saw nothing, and the blank-line rule reported clean over
  // every file that interpolates. depth starts at 1 because `${` already consumed its own
  // brace; counting from zero popped at the expression's first nested `}`.
  let pending = 0;
  let depth = 0;

  // WHY these two and not a token list: a regular expression may only begin where a
  // value would, so the last significant character decides it. `prevSig` carries the
  // character and `word` carries the identifier it belongs to — `return /re/` is a
  // regex because of the word, `a / b` is division because of the letter.
  let prevSig = null;
  let word = '';

  for (let i = 0; i < lines.length; i += 1) {
    if (stopAt !== -1) { recs.push(null); continue; }
    const line = lines[i];
    const rec = { code: false, comment: false, string: false };
    for (let j = 0; j < line.length; j += 1) {
      const c = line[j];
      const d = line[j + 1];
      if (mode === 'code') {
        if (stopAtBareQuote && c === '\\') { j += 1; continue; }
        if (stopAtBareQuote && c === '"') { stopAt = i; break; }
        if (c === '/' && d === '/') { rec.comment = true; break; }
        if (c === '/' && d === '*') { rec.comment = true; mode = 'block'; j += 1; continue; }
        if (c === '/') {
          const end = regexLiteralEnd(line, j, prevSig, word || ' ');
          if (end !== -1) {
            rec.code = true;
            let k = end + 1;
            while (k < line.length && /[a-z]/.test(line[k])) k += 1;

            // A literal is a complete value, so the next `/` can only divide. `)` is
            // deliberately absent from REGEX_PRECEDING_CHARS: it marks "a value just
            // ended here" for the rest of the line.
            prevSig = ')';
            word = '';
            j = k - 1;
            continue;
          }
        }
        if (c === '"' || c === "'") { rec.string = true; mode = c; prevSig = c; word = ''; continue; }
        if (c === '`') { rec.string = true; mode = 'template'; prevSig = c; word = ''; continue; }
        if (pending > 0) {
          if (c === '{') depth += 1;
          if (c === '}') {
            depth -= 1;
            if (depth <= 0) { pending -= 1; depth = 0; mode = 'template'; }
          }
        }

        if (/[A-Za-z0-9_$]/.test(c)) {
          word += c;
          prevSig = c;
          rec.code = true;
          continue;
        }
        word = '';

        // WHY whitespace is not code here: the spaces before an indented comment
        // marked the line as code, so isCommentLine skipped it and every comment
        // written inside a function was invisible to this rule. The rule read as
        // enforced while it only ever inspected column zero.
        if (!/\s/.test(c)) { prevSig = c; rec.code = true; }
      } else if (mode === 'block') {
        rec.comment = true;
        if (c === '*' && d === '/') { mode = 'code'; prevSig = '/'; word = ''; j += 1; }
      } else if (mode === 'template') {
        rec.string = true;
        if (c === '\\') { j += 1; continue; }
        if (c === '$' && d === '{') { pending += 1; depth = 1; mode = 'code'; j += 1; continue; }
        if (c === '`') { mode = 'code'; prevSig = c; word = ''; }
      } else {
        rec.string = true;
        if (c === '\\') { j += 1; continue; }
        if (c === mode) { mode = 'code'; prevSig = c; word = ''; }
      }
    }
    recs.push(rec);
    if (stopAtBareQuote && stopAt !== -1) recs[i] = rec;
  }
  return { recs, stopAt };
}

function classifyJs(text) {
  return scanJs(text.split('\n')).recs;
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

/**
 * Does this tail close a string that was opened earlier on the same line?
 *
 * @param {string} text everything after the opening quote
 * @returns {boolean} true when the string closes on this same line
 */

function hasUnescapedQuote(text) {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\') { i += 1; continue; }
    if (text[i] === '"') return true;
  }
  return false;
}

// WHY and not a wider rule: a YAML `run:` scalar is shell, and shell hands its body to
// `node -e "` as one double-quoted string. The JavaScript inside is JavaScript — the
// five comments it carries are indistinguishable from any other comment in the tree,
// and classifyHash reading only `#` left every one of them unexamined. The region ends
// at the first bare `"` in JavaScript code position, because inside valid JavaScript a
// bare quote cannot appear there: it is the shell closing its own string. A region
// with no such quote is not overlaid at all, so a mistakable match costs nothing.

function classifyYaml(text) {
  const lines = text.split('\n');
  const out = classifyHash(text, MARKERS['.yml']);
  for (let i = 0; i < lines.length; i += 1) {
    const open = /node\s+-e\s*"/.exec(lines[i]);
    if (!open) continue;
    if (hasUnescapedQuote(lines[i].slice(open.index + open[0].length))) continue;
    const scanned = scanJs(lines.slice(i + 1), { stopAtBareQuote: true });
    if (scanned.stopAt === -1) continue;
    for (let n = 0; n < scanned.stopAt; n += 1) {
      if (scanned.recs[n]) out[i + 1 + n] = scanned.recs[n];
    }
    i += 1 + scanned.stopAt;
  }
  return out;
}

function classifyHtml(text) {
  const lines = text.split('\n');
  const out = [];
  let inComment = false;
  let inScript = false;
  let run = [];

  // The JavaScript between `<script>` and `</script>` is JavaScript, so it goes to the
  // one scanner that knows what a comment is. Classifying the tag lines as HTML and
  // every body line as code left all 293 comments inside this tree's `<script>` blocks
  // outside the rule, while the rule reported each of those files clean.
  const flush = () => {
    if (!run.length) return;
    const recs = classifyJs(run.map((n) => lines[n]).join('\n'));
    run.forEach((n, k) => { out[n] = recs[k]; });
    run = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // WHY a running state and not one test per line: `<!--` and `-->` sit on separate
    // lines in this tree's page headers, and reading each line alone classified the
    // @title and @dependencies lines as code. They were never checked once.
    if (inComment) {
      flush();
      out[i] = { code: false, comment: true, string: false };
      if (line.includes('-->')) inComment = false;
      continue;
    }

    if (inScript) {
      if (/<\/script\s*>/i.test(line)) {
        flush();
        inScript = false;
        out[i] = { code: true, comment: false, string: false };
      } else {
        run.push(i);
      }
      continue;
    }

    const open = /<script\b[^>]*>/i.exec(line);
    if (open) {
      flush();
      const isComment = /^\s*<!--/.test(line);
      out[i] = { code: !isComment, comment: isComment, string: false };
      const after = line.slice(open.index + open[0].length);
      if (!/<\/script\s*>/i.test(after)) inScript = true;
      continue;
    }

    if (line.includes('<!--') && !line.includes('-->')) {
      flush();
      out[i] = { code: false, comment: true, string: false };
      inComment = true;
      continue;
    }

    flush();
    const isComment = /^\s*<!--/.test(line) || line.includes('-->');
    out[i] = { code: !isComment, comment: isComment, string: false };
  }
  flush();
  return out;
}

export function commentClasses(text, ext) {
  if (ext === '.html' || ext === '.htm') return classifyHtml(text);
  if (ext === '.mjs' || ext === '.cjs' || ext === '.js' || ext === '.ts') return classifyJs(text);
  if (MARKERS[ext] && MARKERS[ext].skip) return null;
  if (MARKERS[ext]) return MARKERS[ext].embeddedJs ? classifyYaml(text) : classifyHash(text, MARKERS[ext]);
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

    // WHY a block that opens a scope is exempt from the gap above it: it has no
    // statement over it to be mistaken for, and forcing a blank line there pushes
    // a function's own first comment away from the function.
    const opensScope = i > 0 && /[({[]\s*$/.test(lines[i - 1]);
    if (i > 0 && !opensScope && lines[i - 1].trim() !== '') {
      violations.push(`${file}:${i + 1} no blank line before the comment block`);
    }
    let end = i;
    while (end + 1 < lines.length && isCommentLine(lines, classes, end + 1)) end += 1;

    // WHY the gap below is required only at column zero: a module-level block is a
    // section heading and has to be set off from the code under it, while an
    // indented block documents the statement directly beneath it, and separating
    // those two is what makes a comment hard to place. Asserting the gap below
    // everywhere matched exactly one block in the tree; the module-level rule it
    // keeps matched every heading.
    const standalone = lines[i] === lines[i].trimStart();
    if (standalone && end + 1 < lines.length && lines[end + 1].trim() !== '') {
      violations.push(`${file}:${end + 2} no blank line after the comment block`);
    }
    i = end;
  }
  return violations;
}
