// @last-edited: 2026-10-13 UTC+7.
// @title: canvas — calibration, menu scripts, and verify-before-claim retry.
// @state: 8 locks; jpeg size, scale math, grid math, script shapes, retry discipline, driver passthrough, recipes.
// @dependencies: node:test, assert, ../lib/canvas.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attemptVerified,
  calibrationFor,
  chunkBurstSteps,
  createCanvasDriver,
  cssToDisplay,
  displayToCss,
  docsTableScript,
  docsTocScript,
  gridPick,
  jpegSize,
  keysToBurstSteps,
  menuScript
} from '../lib/canvas.js';

// A minimal valid JPEG: SOI, one APP0 segment, one SOF0 holding 750x500, EOI. Built by
// hand so the size reader is tested against bytes rather than a fixture file nobody can
// audit.

function jpegBytes(width, height) {
  const sof = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01
  ];
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), ...sof, 0xff, 0xd9]);
}

test('jpeg dimensions come from the SOF segment, and garbage yields null rather than a wrong scale', () => {
  assert.deepEqual(jpegSize(jpegBytes(750, 500)), { width: 750, height: 500 });
  assert.deepEqual(jpegSize(jpegBytes(1536, 776)), { width: 1536, height: 776 });
  assert.equal(jpegSize(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null);
  assert.equal(jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), null);
  assert.equal(jpegSize(Buffer.alloc(0)), null);
});

test('calibration divides pixels by CSS per axis, and refuses nonsense rather than clicking wrong', () => {
  const cal = calibrationFor(750, 500, jpegBytes(927, 620));
  assert.ok(Math.abs(cal.scaleX - 927 / 750) < 1e-9);
  assert.ok(Math.abs(cal.scaleY - 620 / 500) < 1e-9);
  assert.equal(calibrationFor(0, 500, jpegBytes(10, 10)), null);
  assert.equal(calibrationFor(750, 500, Buffer.alloc(0)), null);
});

test('display and CSS coordinates round-trip through the calibration', () => {
  const cal = calibrationFor(1000, 620, jpegBytes(1015, 650));
  assert.deepEqual(displayToCss({ x: 1015, y: 650 }, cal), { x: 1000, y: 620 });
  assert.deepEqual(cssToDisplay({ x: 1000, y: 620 }, cal), { x: 1015, y: 650 });
});

test('menu scripts accept shorthand and expand to named steps with pauses', () => {
  assert.deepEqual(
    menuScript("ArrowDown", ["ArrowRight", 1200], { key: "Enter", pauseMs: 300 }),
    [
      { key: "ArrowDown", pauseMs: 0 },
      { key: "ArrowRight", pauseMs: 1200 },
      { key: "Enter", modifiers: undefined, text: undefined, pauseMs: 300 }
    ]
  );
});

test('grid picks start selected at 1x1, so 3x4 is two rights, three downs, Enter', () => {
  assert.deepEqual(gridPick(1, 1), ["Enter"]);
  assert.deepEqual(gridPick(3, 4), ["ArrowRight", "ArrowRight", "ArrowDown", "ArrowDown", "ArrowDown", "Enter"]);
  assert.throws(() => gridPick(0, 3), /between 1 and 20/);
  assert.throws(() => gridPick(3, 21), /between 1 and 20/);
});

test('a verified attempt that lands first try never touches undo', async () => {
  let runs = 0;
  let undos = 0;
  const out = await attemptVerified({
    run: async () => { runs += 1; },
    verify: async () => ({ ok: true }),
    undo: async () => { undos += 1; }
  });

  assert.equal(out.ok, true);
  assert.equal(out.attempt, 1);
  assert.equal(runs, 1);
  assert.equal(undos, 0);
  assert.equal(out.timings.length, 1);
});

test('a miss undoes before retrying, and exhaustion reports every attempt', async () => {
  let runs = 0;
  let undos = 0;
  const out = await attemptVerified({
    maxAttempts: 3,
    label: "table",
    run: async () => { runs += 1; },
    verify: async () => ({ ok: runs >= 3 }),
    undo: async () => { undos += 1; }
  });

  assert.equal(out.ok, true);
  assert.equal(runs, 3);
  assert.equal(undos, 2);

  const failed = await attemptVerified({
    maxAttempts: 2,
    label: "table",
    run: async () => {},
    verify: async () => ({ ok: false }),
    undo: async () => {}
  });

  assert.equal(failed.ok, false);
  assert.equal(failed.timings.length, 2);
  assert.match(failed.reason, /did not verify after 2 attempts/);
});

test('a retry that cannot clean up stops instead of stacking damage', async () => {
  let runs = 0;
  const out = await attemptVerified({
    maxAttempts: 3,
    run: async () => { runs += 1; },
    verify: async () => ({ ok: false, clean: async () => false }),
    undo: async () => {}
  });

  assert.equal(out.ok, false);
  assert.equal(runs, 1);
  assert.match(out.reason, /stopped rather than stacking/);
});

test('the driver passes tools through untouched and times every call', async () => {
  const seen = [];
  const driver = createCanvasDriver({
    call: async (name, args) => {
      seen.push([name, args]);
      return { ok: true };
    },
    capture: async () => ({})
  });

  await driver.key("t1", "Enter", ["control"]);
  await driver.type("t1", "hello");
  await driver.clickAt("t1", 10, 20);

  assert.deepEqual(seen[0], ["press_key", { tabId: "t1", key: "Enter", modifiers: ["control"] }]);
  assert.deepEqual(seen[1], ["press_key", { tabId: "t1", text: "hello" }]);
  assert.deepEqual(seen[2], ["click_at", { tabId: "t1", x: 10, y: 20 }]);

  const summary = driver.summary();
  assert.equal(summary.steps, 3);
  assert.ok(summary.totalMs >= 0);
});

test('the Docs recipes encode measured sequences, and the TOC row count must be measured, not guessed', () => {
  assert.deepEqual(docsTableScript({ cols: 3, rows: 4 }), [
    "ArrowDown", "ArrowDown", "ArrowRight",
    "ArrowRight", "ArrowRight", "ArrowDown", "ArrowDown", "ArrowDown", "Enter"
  ]);
  assert.deepEqual(docsTocScript({ downs: 14 }).slice(-2), ["ArrowRight", "Enter"]);
  assert.equal(docsTocScript({ downs: 14 }).length, 16);
  assert.throws(() => docsTocScript({}), /needs the measured row count/);
});

// Nine keys ride as two bursts of eight and one, in order, with nothing altered.

test('long scripts split into bursts of at most eight, order preserved', () => {
  const steps = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  assert.deepEqual(chunkBurstSteps(steps, 8), [["a", "b", "c", "d", "e", "f", "g", "h"], ["i"]]);
  assert.deepEqual(chunkBurstSteps(["a"], 8), [["a"]]);
  assert.throws(() => chunkBurstSteps([], 8), /non-empty/);
  assert.deepEqual(
    keysToBurstSteps(["Enter", { key: "a", modifiers: ["control"] }]),
    [{ action: "key", key: "Enter" }, { action: "key", key: "a", modifiers: ["control"] }]
  );
  assert.throws(() => keysToBurstSteps([42]), /key names/);
});

test('the driver sends one burst call per chunk and reports each', async () => {
  const seen = [];
  const driver = createCanvasDriver({
    call: async (name, args) => {
      seen.push([name, args.steps.length]);
      return { ok: true };
    },
    capture: async () => ({})
  });

  await driver.burstKeys("t1", ["a", "b", "c", "d", "e", "f", "g", "h", "i"]);

  assert.deepEqual(seen, [["run_browser_burst", 8], ["run_browser_burst", 1]]);
  assert.equal(driver.summary().steps, 2);
});