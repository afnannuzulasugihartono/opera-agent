// @last-edited: 2026-10-13 UTC+7.
// @title: canvas — a driving system for canvas-rendered editors, over generic primitives.
// @state: calibration, verified typing, menu sessions, and undo-bounded retry.
// @dependencies: none.
//
// WHY THIS FILE EXISTS
//
// A canvas editor exposes almost nothing to the DOM: no text to find, no elements to
// click, menus that appear in no query. What it does expose is pixels and a document
// model behind an API. Driving it therefore needs three things this file provides: a
// coordinate calibration so a point seen in a capture converts exactly to the point to
// click, a menu driver that navigates by keyboard from a known state instead of counted
// guesses, and a verify-and-retry loop that checks every consequence through the
// document model and undoes before adjusting, so a miss never compounds into damage.
//
// WHY IT LIVES HERE AND NOT IN THE EXTENSION. The extension's primitives stay generic:
// click a coordinate, press a key, capture pixels. Nothing in there knows what a menu
// is. Everything that knows about menus, grids, and document structure is a workflow
// over those primitives, and workflows live here, beside the document compiler.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not read pixels: judging a screenshot is
// the caller's job (a model with vision, or a document-model read through an API). It
// does not keep browser state: every function takes what it needs and returns what it
// learned, so a crashed drive resumes by calling again rather than by repairing hidden
// state. And it never retries without undoing first, because a second attempt on top of
// a half-applied first one is how test documents grow stray paragraphs.

// A JPEG carries its pixel dimensions in a Start-Of-Frame segment, so the size of a
// capture is readable without any image library. Markers: FFC0-FFC3, skipping RST and
// standalone markers, stopping at SOS. Anything unparseable returns null rather than a
// confident wrong answer, because a wrong scale clicks the wrong menu.

export function jpegSize(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : Uint8Array.from(buffer);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let i = 2;
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { width: (bytes[i + 7] << 8) | bytes[i + 8], height: (bytes[i + 5] << 8) | bytes[i + 6] };
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

// The capture reports the CSS size it was asked for; the bytes report the pixel size
// that came back. Their ratio is the scale in each axis, measured per capture rather
// than assumed, because device ratio and downscaling both move it.

export function calibrationFor(cssWidth, cssHeight, jpegBytes) {
  const px = jpegSize(jpegBytes);
  if (!px || !(cssWidth > 0) || !(cssHeight > 0)) return null;
  return {
    scaleX: px.width / cssWidth,
    scaleY: px.height / cssHeight,
    css: { width: cssWidth, height: cssHeight },
    px: { width: px.width, height: px.height }
  };
}

export function displayToCss(point, calibration) {
  return {
    x: Math.round(point.x / calibration.scaleX),
    y: Math.round(point.y / calibration.scaleY)
  };
}

export function cssToDisplay(point, calibration) {
  return {
    x: Math.round(point.x * calibration.scaleX),
    y: Math.round(point.y * calibration.scaleY)
  };
}

// A menu session is a script of keys with a checksum: the caller states what must be
// true afterwards, and the session reports the evidence either way. Keys are named,
// pauses ride along, and nothing is hidden inside a helper the test cannot see.

export function menuScript(...steps) {
  return steps.map((step) => {
    if (typeof step === "string") return { key: step, pauseMs: 0 };
    if (Array.isArray(step)) return { key: step[0], pauseMs: step[1] ?? 0 };
    return { key: step.key, modifiers: step.modifiers, text: step.text, pauseMs: step.pauseMs ?? 0 };
  });
}

// Grid pickers start at 1x1 with the first cell selected, so reaching cols x rows is
// right (cols - 1) times and down (rows - 1) times, then Enter. Measured against the
// Docs table grid, where the size label confirms the selection before committing.

export function gridPick(cols, rows) {
  if (!Number.isInteger(cols) || cols < 1 || cols > 20 || !Number.isInteger(rows) || rows < 1 || rows > 20) {
    throw new Error(`gridPick needs cols and rows between 1 and 20, got ${cols}x${rows}.`);
  }
  const keys = [];
  for (let i = 1; i < cols; i++) keys.push("ArrowRight");
  for (let i = 1; i < rows; i++) keys.push("ArrowDown");
  keys.push("Enter");
  return keys;
}

// A burst carries at most eight steps, so longer scripts split into back-to-back
// bursts. Splitting is mechanical: order preserved, no step altered, and the boundary
// falls wherever the count lands, because burst steps run strictly in order on the
// device with no gap semantics between them.

// WHY BURSTS EXIST ALONGSIDE STREAMS. Every lone call pays a full round trip of
// roughly a second, so a nine-key grid walk costs nine seconds one key at a time and
// about two as one burst: the steps run back-to-back on the device inside a single
// command. Longer scripts split into consecutive bursts of at most eight, which is the
// only batching shape the transport accepts. Streams go further for pure key flow — one
// command however many events — but bursts remain the vehicle for mixed pointer, read,
// and key work.

const BURST_MAX_STEPS = 8;

export function chunkBurstSteps(steps, maxSteps = BURST_MAX_STEPS) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("chunkBurstSteps needs a non-empty step array.");
  }
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new Error("chunkBurstSteps needs a positive chunk size.");
  }
  const chunks = [];
  for (let i = 0; i < steps.length; i += maxSteps) {
    chunks.push(steps.slice(i, i + maxSteps));
  }
  return chunks;
}

export function keysToBurstSteps(keys) {
  return keys.map((key) => {
    if (typeof key === "string") return { action: "key", key };
    if (key && typeof key === "object" && typeof key.key === "string") {
      return { action: "key", key: key.key, ...(key.modifiers ? { modifiers: key.modifiers } : {}) };
    }
    throw new Error("keysToBurstSteps needs key names or { key, modifiers }.");
  });
}

// Every canvas action ends with a question the document model can answer, because the
// action itself always reports success: the transport cannot tell a landed keystroke
// from a swallowed one. On a no, the attempt is undone before the next one starts, so
// retries compose instead of stacking. The undo itself is verified too: a retry that
// cannot clean up after itself stops rather than digging.

export async function attemptVerified({ run, verify, undo, maxAttempts = 3, label = "action" }) {
  const timings = [];
  let lastDetail = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    await run(attempt);
    const detail = await verify();
    timings.push({ attempt, ms: Date.now() - started, ok: detail?.ok === true });
    if (detail?.ok) return { ok: true, attempt, timings, detail };

    lastDetail = detail;
    if (attempt < maxAttempts && undo) {
      await undo();
      const cleaned = await verifyClean(detail);
      if (!cleaned) {
        return { ok: false, attempt, timings, detail, reason: "undo did not restore the document; stopped rather than stacking attempts" };
      }
    }
  }
  return { ok: false, attempt: maxAttempts, timings, detail: lastDetail, reason: `${label} did not verify after ${maxAttempts} attempts` };
}

async function verifyClean(detail) {
  if (!detail || typeof detail.clean !== "function") return true;
  try {
    return (await detail.clean()) === true;
  } catch {
    return false;
  }
}

// The driver holds no browser state: tools arrive injected, so the same code drives a
// relay stdio client in production and a script of canned answers in tests. Timing is
// collected per call because a canvas drive is a latency story as much as a correctness
// one, and both are reported together at the end.

export function createCanvasDriver({ call, capture }) {
  const timings = [];

  const timed = async (label, fn) => {
    const started = Date.now();
    const value = await fn();
    const ms = Date.now() - started;
    timings.push({ label, ms });
    return { value, ms };
  };

  return {
    timings,

    summary() {
      const total = timings.reduce((sum, t) => sum + t.ms, 0);
      return { steps: timings.length, totalMs: total, meanMs: timings.length ? Math.round(total / timings.length) : 0, timings: [...timings] };
    },

    async key(tabId, key, modifiers) {
      return timed(`key ${key}`, () => call("press_key", { tabId, key, ...(modifiers ? { modifiers } : {}) }));
    },

    async type(tabId, text) {
      return timed(`type ${text.length} chars`, () => call("press_key", { tabId, text }));
    },

    async clickAt(tabId, x, y) {
      return timed(`click ${x},${y}`, () => call("pointer", { tabId, pointerAction: "click", x, y }));
    },

    async burst(tabId, steps) {
      const chunks = chunkBurstSteps(steps);
      const results = [];
      for (const [index, chunk] of chunks.entries()) {
        const out = await timed(
          `burst ${index + 1}/${chunks.length} (${chunk.length} steps)`,
          () => call("run_browser_burst", { tabId, steps: chunk })
        );
        results.push(out.value);
      }
      return results;
    },

    async burstKeys(tabId, keys) {
      return this.burst(tabId, keysToBurstSteps(keys));
    },

    async captureCrop(tabId, crop, maxWidth = 750) {
      const shot = await timed("capture", () => call("capture_page", { tabId, crop, quality: 40, maxWidth }));
      const content = shot.value?.content ?? shot.value?.result?.content ?? [];
      const image = content.find((part) => part?.type === "image");
      const bytes = image?.data ? Buffer.from(image.data, "base64") : null;
      return { bytes, shot: shot.value, ms: shot.ms };
    },

    async calibrate(tabId, crop = { x: 0, y: 0, width: 750, height: 500 }) {
      const { bytes } = await this.captureCrop(tabId, crop);
      if (!bytes) return null;
      return calibrationFor(crop.width, crop.height, bytes);
    }
  };
}

// The Docs table recipe, measured end to end: open Insert from a closed menu, walk to
// the Table row, open the grid, size it, commit. Precondition: no menu open and the
// caret where the table belongs. The grid math lives in gridPick; the only calibrated
// constant is how far down the Table row sits, which is read off a capture of the open
// menu rather than believed from memory.

const DOCS_INSERT_TABLE_DOWNS = 2;

export function docsTableScript({ cols, rows, downs = DOCS_INSERT_TABLE_DOWNS } = {}) {
  const walk = [];
  for (let i = 0; i < downs; i++) walk.push("ArrowDown");
  return [...walk, "ArrowRight", ...gridPick(cols, rows)];
}

// The Docs table-of-contents recipe. Precondition: same as the table, plus at least one
// heading already in the document, because an empty outline inserts an empty box. The
// style choice is the first option, plain text links, which is Enter on the open
// submenu without moving.

export function docsTocScript({ downs }) {
  if (!Number.isInteger(downs) || downs < 1) {
    throw new Error("docsTocScript needs the measured row count to the Table of contents row.");
  }
  const walk = [];
  for (let i = 0; i < downs; i++) walk.push("ArrowDown");
  return [...walk, "ArrowRight", "Enter"];
}
