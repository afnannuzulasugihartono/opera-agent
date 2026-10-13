// @last-edited: 2026-10-12 UTC+7.
// @title: docplan — compile a document spec into Google Docs batchUpdate requests.
// @state: text blocks compile to exact indices; structural blocks are isolated for a re-read.
// @dependencies: none.

// WHY THIS FILE EXISTS
//
// The Docs API applies requests in order, and every insertText shifts every index
// after it. Getting that wrong writes a corrupted document, and the corruption is
// silent: the API answers 200. So the index arithmetic is the whole risk, and it
// is cheap to remove — a compiler that knows exactly what it inserted can walk a
// cursor forward instead of reading the document back between writes.
//
// WHY A STRUCTURAL BLOCK IS A CHUNK BOUNDARY
//
// The arithmetic is exact for text. It is not exact for tables and images, whose
// footprint depends on content and on Google's own padding. Those blocks are
// marked STRUCTURAL and compiled alone, because a chunk boundary is the only place
// a re-read is cheap and a wrong index is still survivable.
//
// WHY AN UNKNOWN START INDEX THROWS
//
// JavaScript coerces null to 0, so a chunk compiled after a structural block would
// silently write at the top of the document and corrupt it, with a 200 from the
// API and nothing to notice. The guard is the difference between a loud failure
// and an unreadable document.
//
// WHY THE KIND ITSELF NAMES A STYLE
//
// Reading block.style alone would emit no styling at all for { kind: 'h1' },
// which is the common case. The kind is the style name in every block this
// compiler writes.

// A paragraph occupies its text plus one paragraph mark. Verified against the live
// document: "Abstrak" spans [95,103) — seven characters of text, one newline.

const PARAGRAPH_MARK = 1;

export const NAMED_STYLE = Object.freeze({
  title: 'TITLE',
  subtitle: 'SUBTITLE',
  h1: 'HEADING_1',
  h2: 'HEADING_2',
  h3: 'HEADING_3',
  body: 'NORMAL_TEXT',
  bullet: 'NORMAL_TEXT',
  quote: 'NORMAL_TEXT'
});

const STRUCTURAL = new Set(['table', 'image']);

export function blockLength(block) {
  if (STRUCTURAL.has(block?.kind)) return null;
  if (block?.kind === 'pagebreak') return 1;
  return (block?.text?.length ?? 0) + PARAGRAPH_MARK;
}

// WHY STYLES ARE EMITTED AFTER EVERY INSERT
//
// A paragraph mark does not exist until the block after it supplies a newline, so
// styling a block as it is written puts the range end at or past the segment end,
// which the API rejects with a 400. Emitting every insert first makes the indices
// final before a single style is applied.
//
// WHY THE FIRST BLOCK IS INSERTED BARE AND THE REST CARRY A LEADING NEWLINE
//
// A document ends with one paragraph mark, and an insert index must be strictly
// less than the segment end. Appending to the end therefore merges into whatever
// paragraph is already last: appending "DEF" after "ABC" yields "ABCDEF" in one
// paragraph, because both land before the same mark. Only a newline separates
// paragraphs. So every block after the first is inserted as "\n" + text at the
// end of the content, which is one before the trailing mark and therefore a legal
// index. The paragraph mark then falls out of that newline, and the style range
// starts after it.

export function compileChunk(blocks, { startIndex = 1 } = {}) {
  if (!Number.isInteger(startIndex)) {
    throw new Error(`startIndex must be an integer, got ${String(startIndex)}: re-read the document before compiling`);
  }

  const inserts = [];
  const styles = [];
  let cur = startIndex;
  let written = 0;

  for (const block of blocks) {
    if (!block || !block.kind) throw new Error('every block needs a kind');

    if (STRUCTURAL.has(block.kind)) {
      throw new Error(
        `structural block "${block.kind}" must be compiled alone; a chunk boundary is the only safe re-read point`
      );
    }

    if (block.kind === 'pagebreak') {
      inserts.push({ insertText: { text: written ? '\n\f' : '\f', location: { index: cur } } });
      cur += written ? 2 : 1;
      written += 1;
      continue;
    }

    const text = block.text ?? '';
    const lead = written ? '\n' : '';
    inserts.push({ insertText: { text: lead + text, location: { index: cur } } });

    const start = cur + lead.length;
    styles.push({ block, range: { startIndex: start, endIndex: start + text.length + PARAGRAPH_MARK } });
    cur += lead.length + text.length;
    written += 1;
  }

  const requests = inserts;
  for (const { block, range } of styles) {
    const style = NAMED_STYLE[block.style ?? block.kind];
    if (style) {
      requests.push({
        updateParagraphStyle: {
          range,
          paragraphStyle: { namedStyleType: style },
          fields: 'namedStyleType'
        }
      });
    }
    if (block.kind === 'bullet') {
      requests.push({
        createParagraphBullets: {
          range,
          bulletPreset: block.preset ?? 'BULLET_DISC_CIRCLE_SQUARE'
        }
      });
    }
  }

  return { requests, cursor: cur };
}

// compileTable stands alone: the caller re-reads the document afterwards, because a
// table's width follows its contents and cannot be predicted from the spec alone.

export function compileTable(block, { startIndex = 1 } = {}) {
  if (block.kind !== 'table') throw new Error('compileTable expects kind "table"');
  const rows = block.rows?.length ?? 0;
  const columns = block.cols?.[0]?.length ?? 0;
  if (!rows || !columns) throw new Error('table needs rows and cols');

  return {
    requests: [{ insertTable: { rows, columns, endOfSegmentLocation: { segmentId: '' } } }],
    needsReread: true,
    cursor: null
  };
}

// compilePlan walks a whole spec and splits at every structural block. A text run
// that follows one is handed back marked rather than compiled, because where the
// structural block landed is not knowable here.

export function compilePlan(blocks, { startIndex = 1 } = {}) {
  const chunks = [];
  let pending = [];
  let cursor = startIndex;

  const flush = () => {
    if (!pending.length) return;
    if (cursor === null) {
      chunks.push({ kind: 'text', at: null, blocks: pending, requests: null, needsReread: true });
    } else {
      const built = compileChunk(pending, { startIndex: cursor });
      chunks.push({ kind: 'text', at: cursor, blocks: pending, requests: built.requests });
      cursor = built.cursor;
    }
    pending = [];
  };

  for (const block of blocks) {
    if (STRUCTURAL.has(block?.kind)) {
      flush();
      const built = block.kind === 'table'
        ? compileTable(block, { startIndex: cursor })
        : { requests: [{ insertInlineImage: { uri: block.uri, location: { index: cursor } } }], needsReread: true };
      chunks.push({ kind: block.kind, at: cursor, block, requests: built.requests, needsReread: true });
      cursor = null;
    } else {
      pending.push(block);
    }
  }
  flush();

  return { chunks, nextIndex: cursor };
}