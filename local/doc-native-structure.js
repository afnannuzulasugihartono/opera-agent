// @last-edited: 2026-10-31 UTC+7.
// @title: doc-native-structure — the page break and the table of contents a document makes for itself.
// @state: the menu walk that inserts a page break, the walk that inserts a table of contents, and what each says when the page refuses.
// @dependencies: ./doc-native-page.js.

// WHY THE NEW MENU IS WALKED THROUGH THE ACCESSIBILITY TREE.
// Measured live on a real Google Doc: the new Insert menu hides the table of contents under "Page elements", and the reader the menu walker uses sees only the first row of a submenu.
// The accessibility tree names every row of every open submenu, and a row it names carries a box that can be measured and pointed at.
// So the walk asks the tree for the row, measures the row, and moves the pointer there.

// WHY A BRANCH IS HOVERED AND A COMMAND IS CLICKED.
// Measured live on the same Doc: pressing a row that owns a submenu runs the command it names instead of opening the submenu.
// So a branch is hovered, and only a command is clicked.

// WHY THE PAGE BREAK AND THE CONTENTS TAKE THE MARKER'S PLACE.
// Measured live on the same Doc: a page break and a table of contents both replace the text that was selected when they were inserted.
// So the marker is found and left selected, the command is run, and the marker is looked for again: a marker the page no longer holds is the command that landed.

import { selectMarker } from './doc-native-page.js';

const sleepDefault = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const INSERT = 'Insert';

function centreOf(model) {
  const quad = model?.content ?? model?.border;
  if (!Array.isArray(quad) || quad.length < 4) return null;
  const xs = quad.filter((
    _,
    index
  ) => index % 2 === 0);
  const ys = quad.filter((
    _,
    index
  ) => index % 2 === 1);
  return {
    x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
    y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2)
  };
}

async function axRows(doc) {
  const tree = await doc.ask('Accessibility.getFullAXTree', {
    maxDepth: 60
  }).catch(() => null);
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
  return nodes.map((node) => ({
    role: String(node?.role?.value ?? ''),
    name: String(node?.name?.value ?? ''),
    backendNodeId: node?.backendDOMNodeId ?? null
  }));
}

async function axRow(
  doc,
  name,
  role
) {
  const want = String(name ?? '').toLowerCase();
  const rows = await axRows(doc);
  const row = rows.find((entry) => entry.role === role && entry.name.toLowerCase() === want)
    ?? rows.find((entry) => entry.role === role && entry.name.toLowerCase().startsWith(want))
    ?? rows.find((entry) => entry.role === role && entry.name.toLowerCase().includes(want));
  if (!row || !row.backendNodeId) return null;
  const { model } = await doc.cdp.send('DOM.getBoxModel', {
    backendNodeId: row.backendNodeId
  }).catch(() => ({
    model: null
  }));
  const at = centreOf(model);
  return at ? {
    ...row,
    ...at
  } : null;
}

async function walkMenu(
  doc,
  steps,
  sleep
) {
  for (const step of steps) {
    const row = await axRow(
      doc,
      step.name,
      step.role ?? 'menuitem'
    );
    if (!row) {
      return {
        ok: false,
        why: `the page does not offer "${step.name}" where the paper needs it`
      };
    }
    if (step.hover === true) {
      await doc.hover(row.x, row.y);
      await sleep(900);
      continue;
    }
    await doc.clickAt(row.x, row.y);
    await sleep(900);
  }
  return {
    ok: true,
    why: ''
  };
}

async function guardMarker({
  doc,
  marker,
  sleep,
  what
}) {
  const found = await selectMarker({
    doc,
    marker,
    sleep
  });
  if (found?.noBar === true) {
    return {
      ok: false,
      why: 'the document did not open its find bar, so the marker could not be found'
    };
  }
  if (found?.missing === true) {
    return {
      ok: false,
      why: `the document does not hold the marker "${marker}" (the find bar reads "${found.counter}"), so the ${what} had nowhere to go`
    };
  }
  if (found?.visible === false) {
    return {
      ok: false,
      why: `the document stayed out of sight (${found.focusWhy || 'the window would not come forward'}), so the ${what} could not be made`
    };
  }
  return {
    ok: true,
    why: ''
  };
}

async function landed({
  doc,
  marker,
  sleep,
  what
}) {
  const after = await selectMarker({
    doc,
    marker,
    sleep
  });
  if (after?.missing === true) {
    return {
      ok: true,
      why: `the page made the ${what} and the marker is gone`
    };
  }
  return {
    ok: false,
    why: `the document still holds the marker "${marker}" (the find bar reads "${after?.counter || 'nothing'}"), so the ${what} did not land`
  };
}

/**
 * Breaks the page where a marker stands, with the page's own page break.
 * @param {object} args - the break inputs.
 * @param {object} args.doc - the document session to break the page in.
 * @param {string} args.marker - the text that stands where the break belongs.
 * @param {Function} [args.sleep] - the wait between two steps, replaced in tests.
 * @returns {Promise<{ok: boolean, why: string}>} whether the page broke the page, and why.
 */

export async function insertPageBreak({
  doc,
  marker,
  sleep = sleepDefault
} = {}) {
  const guard = await guardMarker({
    doc,
    marker,
    sleep,
    what: 'page break'
  });
  if (guard.ok !== true) return guard;
  const walked = await walkMenu(
    doc,
    [
      {
        name: INSERT
      },
      {
        name: 'Break',
        hover: true
      },
      {
        name: 'Page break'
      }
    ],
    sleep
  );
  if (walked.ok !== true) return walked;
  return landed({
    doc,
    marker,
    sleep,
    what: 'page break'
  });
}

/**
 * Makes the table of contents where a marker stands, with the page's own table of contents.
 * @param {object} args - the contents inputs.
 * @param {object} args.doc - the document session to make the contents in.
 * @param {string} args.marker - the text that stands where the contents belong.
 * @param {Function} [args.sleep] - the wait between two steps, replaced in tests.
 * @returns {Promise<{ok: boolean, why: string}>} whether the page made the contents, and why.
 */

export async function insertTableOfContents({
  doc,
  marker,
  sleep = sleepDefault
} = {}) {
  const guard = await guardMarker({
    doc,
    marker,
    sleep,
    what: 'table of contents'
  });
  if (guard.ok !== true) return guard;
  const walked = await walkMenu(
    doc,
    [
      {
        name: INSERT
      },
      {
        name: 'Page elements',
        hover: true
      },
      {
        name: 'Table of contents',
        hover: true
      },
      {
        name: 'black text and page numbers',
        role: 'gridcell'
      }
    ],
    sleep
  );
  if (walked.ok !== true) return walked;
  return landed({
    doc,
    marker,
    sleep,
    what: 'table of contents'
  });
}
