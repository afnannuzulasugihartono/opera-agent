// @last-edited: 2026-10-23 UTC+7.
// @title: local-file — upload, drop and download are proven by the bytes on disk, not by an ok.
// @state: the file verbs, and the staging, chooser interception and delivery checks behind them.
// @dependencies: node:test, strict, ../local/drive/primitives.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  DROP_PHASES,
  UPLOAD_INPUT_EXPRESSION,
  dragMimeType
} from '../local/drive/page-expressions.js';
import { createPrimitives } from '../local/drive/primitives.js';
import { recordingCdp } from './helpers/local-page.mjs';

function fakeUploadFs() {
  const calls = [];
  return {
    calls,
    existsSync: (p) => { calls.push(['exists', p]); return p === '/files/pic.png'; },
    statSync: (p) => { calls.push(['stat', p]); return { size: 42 }; },
    mkdtempSync: (prefix) => { calls.push(['mkdtemp', prefix]); return '/tmp/opera-upload-x'; },
    writeFileSync: (p, bytes) => { calls.push(['write', p, bytes.length]); },
    unlinkSync: (p) => { calls.push(['unlink', p]); },
    rmdirSync: (p) => { calls.push(['rmdir', p]); }
  };
}


const fakeUploadOs = { tmpdir: () => '/tmp' };

const fakeUploadPath = { join: (...parts) => parts.join('/'), basename: (p) => p.split('/').pop() };


function uploadCdp() {
  const calls = [];
  return {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate') return { result: { objectId: 'o1' } };
      return { result: {} };
    }
  };
}

// WHY THE FINDER HAS TWO ROADS.
// The pierced query is what finds a closed shadow root; the page script is what finds a frame the browser refuses to pierce.
// Each is proven on its own: a cdp that answers the DOM road proves the pierced path, a cdp that answers only the script proves the fallback, and a cdp that answers neither proves the honest `inputFound: false`.


function piercedUploadCdp() {
  const calls = [];
  return {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (method === 'DOM.querySelectorAll') return { nodeIds: [42] };
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 'b7' } };
      if (method === 'Runtime.evaluate') return { result: { subtype: 'null' } };
      return { result: {} };
    }
  };
}


test('an upload refuses anything but exactly one source', async () => {
  const p = createPrimitives(uploadCdp());

  await assert.rejects(() => p.upload({}), /filename/);
  await assert.rejects(() => p.upload({ filename: 'a.png' }), /exactly one/);
  await assert.rejects(() => p.upload({ filename: 'a.png', data: 'eA==', path: '/files/pic.png' }), /exactly one/);
  await assert.rejects(() => p.upload({ filename: 'a.png', data: '' }), /no bytes/);
  await assert.rejects(() => p.upload({ filename: 'a.png', path: '/files/missing.png' }), /no such file/);
});


test('bytes are staged, handed over, and cleaned up', async () => {
  const fs = fakeUploadFs();
  const cdp = uploadCdp();
  const p = createPrimitives(cdp, { fs, os: fakeUploadOs, path: fakeUploadPath });

  const out = await p.upload({ filename: 'pic.png', data: Buffer.from('bytes').toString('base64') });

  assert.deepEqual(out, { inputFound: true, filename: 'pic.png', bytes: 5 });
  const set = cdp.calls.find((c) => c.method === 'DOM.setFileInputFiles');
  assert.deepEqual(set.params, { files: ['/tmp/opera-upload-x/pic.png'], objectId: 'o1' });
  assert.deepEqual(fs.calls.map((c) => c[0]), ['mkdtemp', 'write', 'unlink', 'rmdir'], 'stage, hand over, clean up, in that order');
  assert.ok(cdp.calls.some((c) => c.method === 'Runtime.releaseObjectGroup'), 'the handle is released, not leaked');
});


test('a path uploads in place with no staging', async () => {
  const fs = fakeUploadFs();
  const cdp = uploadCdp();
  const p = createPrimitives(cdp, { fs, os: fakeUploadOs, path: fakeUploadPath });

  const out = await p.upload({ filename: 'pic.png', path: '/files/pic.png' });

  assert.deepEqual(out, { inputFound: true, filename: 'pic.png', bytes: 42 });
  assert.deepEqual(fs.calls.map((c) => c[0]), ['exists', 'stat']);
  const set = cdp.calls.find((c) => c.method === 'DOM.setFileInputFiles');
  assert.deepEqual(set.params.files, ['/files/pic.png']);
});

// WHY THE CLOSED SHADOW ROOT IS PROVEN HERE.
// Google Docs keeps its file input where a page script cannot see it, so the script road reported no input while the input was demonstrably there.
// The pierced query is asked first and names the closed root by backend node id.


test('an input inside a closed shadow root is found and filled', async () => {
  const fs = fakeUploadFs();
  const cdp = piercedUploadCdp();
  const p = createPrimitives(cdp, { fs, os: fakeUploadOs, path: fakeUploadPath });

  const out = await p.upload({ filename: 'pic.png', path: '/files/pic.png' });

  assert.deepEqual(out, { inputFound: true, filename: 'pic.png', bytes: 42 });
  const query = cdp.calls.find((c) => c.method === 'DOM.querySelectorAll');
  assert.deepEqual(query.params, { nodeId: 1, selector: 'input[type=file]', pierce: true },
    'the tree is pierced and only the matches come back');
  const set = cdp.calls.find((c) => c.method === 'DOM.setFileInputFiles');
  assert.deepEqual(set.params, { files: ['/files/pic.png'], backendNodeId: 'b7' });
  assert.ok(!cdp.calls.some((c) => c.method === 'Runtime.evaluate'),
    'a pierced hit never falls through to the page script');
});


test('a frame the browser refuses to pierce is still found by the page script', async () => {
  const fs = fakeUploadFs();
  const cdp = piercedUploadCdp();
  const original = cdp.send;
  cdp.send = async (method, params = {}) => {
    if (method === 'DOM.querySelectorAll') return { nodeIds: [] };
    if (method === 'Runtime.evaluate') return { result: { objectId: 'o1' } };
    return original(method, params);
  };
  const p = createPrimitives(cdp, { fs, os: fakeUploadOs, path: fakeUploadPath });

  const out = await p.upload({ filename: 'pic.png', path: '/files/pic.png' });

  assert.deepEqual(out, { inputFound: true, filename: 'pic.png', bytes: 42 });
  const set = cdp.calls.find((c) => c.method === 'DOM.setFileInputFiles');
  assert.deepEqual(set.params, { files: ['/files/pic.png'], objectId: 'o1' }, 'the second road still fills');
});

// WHY THE CHILD FRAME IS ITS OWN CASE.
// `pierce` answers for a document and stops at the frame boundary, and Google Docs keeps its image input in a picker frame: every road that looked at the top document reported nothing while the input was there.
// A frame is reached by its owner, the owner names its content document, and the same pierced query runs there.


test('an input inside a child frame is found through the frame owner', async () => {
  const fs = fakeUploadFs();
  const calls = [];
  const cdp = {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'F1' }, childFrames: [{ frame: { id: 'F2' } }] } };
      if (method === 'DOM.getFrameOwner') return params.frameId === 'F2' ? { backendNodeId: 'owner-2' } : {};
      if (method === 'DOM.describeNode') {
        if (params.backendNodeId === 'owner-2') return { node: { contentDocument: { nodeId: 99 } } };
        return { node: { backendNodeId: 'b9' } };
      }
      if (method === 'DOM.querySelectorAll') {
        return params.nodeId === 99 ? { nodeIds: [7] } : { nodeIds: [] };
      }
      if (method === 'Runtime.evaluate') return { result: { subtype: 'null' } };
      return { result: {} };
    }
  };
  const p = createPrimitives(cdp, { fs, os: fakeUploadOs, path: fakeUploadPath });

  const out = await p.upload({ filename: 'pic.png', path: '/files/pic.png' });

  assert.deepEqual(out, { inputFound: true, filename: 'pic.png', bytes: 42 });
  const query = calls.filter((c) => c.method === 'DOM.querySelectorAll').pop();
  assert.deepEqual(query.params, { nodeId: 99, selector: 'input[type=file]', pierce: true },
    'the frame document is asked with the same pierced query');
  const set = calls.find((c) => c.method === 'DOM.setFileInputFiles');
  assert.deepEqual(set.params, { files: ['/files/pic.png'], backendNodeId: 'b9' });
});


test('a page with no file input is reported, not filled', async () => {
  const fs = fakeUploadFs();
  const cdp = uploadCdp();
  cdp.send = async (method, params = {}) => {
    cdp.calls.push({ method, params });
    if (method === 'Runtime.evaluate') return { result: { subtype: 'null' } };
    return { result: {} };
  };
  const p = createPrimitives(cdp, { fs, os: fakeUploadOs, path: fakeUploadPath });

  const out = await p.upload({ filename: 'pic.png', data: Buffer.from('bytes').toString('base64') });

  assert.deepEqual(out, { inputFound: false, filename: 'pic.png' });
  assert.ok(!cdp.calls.some((c) => c.method === 'DOM.setFileInputFiles'), 'nothing to fill, nothing sent');
  assert.ok(fs.calls.some((c) => c[0] === 'unlink'), 'the staging is still cleaned');
});

// WHY THE PIERCING IS PINNED AS TEXT.
// There is no DOM in a unit test, so the only thing checkable here is that the finder walks into shadow roots and same-origin frames instead of stopping at the top document.
// Fetching a whole pierced tree to do the same timed out live on a heavy page; the walk answers with one node back.


test('the input finder pierces shadow roots and same-origin frames', () => {
  assert.ok(UPLOAD_INPUT_EXPRESSION.includes('shadowRoot'), 'shadow trees are entered');
  assert.ok(UPLOAD_INPUT_EXPRESSION.includes('contentDocument'), 'same-origin frames are entered');
  assert.ok(UPLOAD_INPUT_EXPRESSION.includes("input[type=file]"), 'the quarry never changed');
});


test('intercepting the file chooser is one page call either way', async () => {
  const cdp = recordingCdp();
  const p = createPrimitives(cdp);

  assert.deepEqual(await p.interceptFileChooser(true), { intercepting: true });
  assert.deepEqual(await p.interceptFileChooser(false), { intercepting: false });
  assert.deepEqual(
    cdp.calls.filter((c) => c.method === 'Page.setInterceptFileChooserDialog').map((c) => c.params.enabled),
    [true, false]
  );
});

// WHY THE RETRY IS PINNED BY COUNT, NOT TIME.
// Clicking Upload creates the input on the page's own schedule; the first look routinely finds nothing a second after the click.
// Five looks with sleeps between them cost nothing when the input is already there.


test('a late input is caught by looking again', async () => {
  const slept = [];
  let calls = 0;
  const cdp = {
    send: async (method) => {
      if (method === 'Runtime.evaluate') {
        calls += 1;
        return calls < 3 ? { result: {} } : { result: { objectId: 'late' } };
      }
      return { result: {} };
    }
  };
  const p = createPrimitives(cdp, {
    sleep: async (ms) => { slept.push(ms); },
    fs: fakeUploadFs(), os: fakeUploadOs, path: fakeUploadPath
  });

  const out = await p.upload({ filename: 'pic.png', path: '/files/pic.png' });

  assert.deepEqual(out.inputFound, true);
  assert.deepEqual(slept, [400, 400],
    'a beat between looks, none after the hit, and one pass over every road each time');
});

// WHY THE DROP IS PINNED IN ORDER, WITH ITS RELEASE.
// The drop is the road into a page whose file chooser has no input behind it, and it only works while Chrome is intercepting drags; a tab left intercepting would stop believing a person dragging anything onto it, which is worse than the problem being solved.
// So the phases are sent in the order a drag happens and the release is asserted on the happy road and on the road where the page refuses the file.


test('a drop walks the drag phases in order and releases interception after', async () => {
  const cdp = recordingCdp();
  const p = createPrimitives(cdp, { fs: fakeUploadFs(), os: fakeUploadOs, path: fakeUploadPath });

  const out = await p.dropFile({ x: 750, y: 440, filename: 'pic.png', path: '/files/pic.png' });

  assert.deepEqual(out, { dropped: true, filename: 'pic.png', bytes: 42, x: 750, y: 440, mimeType: 'image/png' });
  assert.deepEqual(
    cdp.calls.map((c) => (c.method === 'Input.dispatchDragEvent' ? c.params.type : c.method)),
    ['Page.bringToFront', 'Input.setInterceptDrags', ...DROP_PHASES, 'Input.setInterceptDrags'],
    'front tab, interception on, the drag phases, interception off'
  );
  const last = cdp.calls.at(-1);
  assert.equal(last.params.enabled, false, 'and the tab is handed back its real pointer');
  const dropped = cdp.calls.find((c) => c.params.type === 'drop');
  assert.deepEqual(dropped.params.data.files, ['/files/pic.png']);
  assert.deepEqual(dropped.params.data.items, [{ mimeType: 'image/png', title: 'pic.png', data: '' }]);
});


test('a refused drop still hands the tab its pointer back', async () => {
  const cdp = recordingCdp();
  const original = cdp.send;
  cdp.send = async (method, params = {}) => {
    if (method === 'Input.dispatchDragEvent') throw new Error('the page said no');
    return original(method, params);
  };
  const p = createPrimitives(cdp, { fs: fakeUploadFs(), os: fakeUploadOs, path: fakeUploadPath });

  await assert.rejects(() => p.dropFile({ x: 1, y: 2, filename: 'pic.png', path: '/files/pic.png' }), /page said no/);
  assert.equal(cdp.calls.at(-1).method, 'Input.setInterceptDrags');
  assert.equal(cdp.calls.at(-1).params.enabled, false, 'a failure does not leave drags intercepted');
});


test('a drop refuses anything but one source and a place to drop it', async () => {
  const p = createPrimitives(recordingCdp(), { fs: fakeUploadFs(), os: fakeUploadOs, path: fakeUploadPath });

  await assert.rejects(() => p.dropFile({ x: 1, y: 2, filename: 'a.png' }), /exactly one/);
  await assert.rejects(() => p.dropFile({ x: 1, y: 2, filename: 'a.png', data: 'eA==', path: '/files/a.png' }), /exactly one/);
  await assert.rejects(() => p.dropFile({ x: 1, y: 2, filename: 'a.png', data: '' }), /no bytes/);
  await assert.rejects(() => p.dropFile({ x: 1, y: 2, filename: 'a.png', path: '/files/missing.png' }), /no such file/);
  await assert.rejects(() => p.dropFile({ filename: 'a.png', path: '/files/pic.png' }), /x and y/);
});

// WHY THE TYPE IS PINNED BY NAME.
// A drop tells the page what it is being offered, and a wrong type is a file the page refuses — the difference between an image landing and nothing happening at all.


test('a drop types the file by its name, and admits what it does not know', () => {
  assert.equal(dragMimeType('thesis-test.png'), 'image/png');
  assert.equal(dragMimeType('photo.JPEG'), 'image/jpeg', 'case is the caller spelling, not the page');
  assert.equal(dragMimeType('report.pdf'), 'application/pdf');
  assert.equal(dragMimeType('mystery.zzz'), 'application/octet-stream');
  assert.equal(dragMimeType('noextension'), 'application/octet-stream');
});

// WHY A HANDLE IS PROVEN BY WHAT IT HOLDS.
// The point of a handle is that the click lands on the element, not on the point it once occupied, so these tests read the row, read the node behind it, and read the box the browser reports for that node at the moment of the click.


function fakeDisk() {
  const files = new Map();
  return {
    files,
    mkdirSync() {},
    readdirSync(dir) {
      return [...files.keys()].filter((f) => path.dirname(f) === dir).map((f) => path.basename(f));
    },
    statSync(file) {
      const hit = files.get(file);
      if (!hit) throw new Error('ENOENT ' + file);
      return { size: hit.bytes, mtimeMs: hit.mtimeMs };
    },
    rmSync(file) { files.delete(file); },
    renameSync(from, to) {
      const hit = files.get(from);
      if (!hit) throw new Error('ENOENT ' + from);
      files.delete(from);
      files.set(to, hit);
    },
    put(file, bytes) { files.set(file, { bytes, mtimeMs: Date.now() }); }
  };
}


function downloadCdp(disk, { onRelease = null } = {}) {
  const calls = [];
  return {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased' && onRelease) onRelease();
      if (method === 'Runtime.evaluate') {
        const expression = String(params.expression);
        if (expression.includes('devicePixelRatio')) return { result: { value: { width: 1136, height: 770, dpr: 1 } } };
        if (expression.includes('opera-hit')) return { result: { value: { tag: 'A', role: 'link', name: 'download' } } };
        return { result: { value: { title: 'statements', url: 'https://bank.example/statements', text: '' } } };
      }
      return { result: {} };
    }
  };
}


test('a download is proven by the file on disk, and the folder is armed before the click', async () => {
  const disk = fakeDisk();
  const dir = path.resolve('opera-download-test');
  const cdp = downloadCdp(disk, {
    onRelease: () => disk.put(path.join(dir, 'statement-2026-09.pdf'), 1234)
  });
  const p = createPrimitives(cdp, { fs: disk, sleep: async () => {} });

  const out = await p.download({ x: 10, y: 10, dir, settleMs: 0 });

  assert.equal(out.downloaded, true);
  assert.equal(out.file, 'statement-2026-09.pdf');
  assert.equal(out.bytes, 1234);
  const armed = cdp.calls.findIndex((c) => c.method === 'Browser.setDownloadBehavior' && c.params.behavior === 'allow');
  const released = cdp.calls.findIndex((c) => c.method === 'Input.dispatchMouseEvent' && c.params.type === 'mouseReleased');
  assert.ok(armed >= 0 && armed < released, 'the folder is armed before the click that fills it');
  const last = cdp.calls.filter((c) => c.method === 'Browser.setDownloadBehavior').at(-1);
  assert.equal(last.params.behavior, 'default', 'the browser-wide behavior is handed back, or later downloads vanish into it');
});


test('a click that downloads nothing says what it saw, and names the next move', async () => {
  const disk = fakeDisk();
  const dir = path.resolve('opera-download-test-empty');
  const cdp = downloadCdp(disk);
  const p = createPrimitives(cdp, { fs: disk, sleep: async () => {} });

  const out = await p.download({ x: 5, y: 5, dir, timeoutMs: 500, settleMs: 0 });

  assert.equal(out.downloaded, false);
  assert.match(out.why, /no file appeared/);
  assert.match(out.why, /dialog_state/);
  assert.ok(out.clicked, 'the answer still says where the click landed');
});


test('a file still being written is not a delivered file', async () => {
  const disk = fakeDisk();
  const dir = path.resolve('opera-download-test-partial');
  const cdp = downloadCdp(disk, {
    onRelease: () => disk.put(path.join(dir, 'statement.pdf.crdownload'), 50)
  });
  const p = createPrimitives(cdp, { fs: disk, sleep: async () => {} });

  const out = await p.download({ x: 5, y: 5, dir, timeoutMs: 500, settleMs: 0 });

  assert.equal(out.downloaded, false);
  assert.match(out.why, /still being written/);
  assert.equal(out.partial, 'statement.pdf.crdownload');
});


test('download refuses to guess what to click', async () => {
  const p = createPrimitives(downloadCdp(fakeDisk()), { sleep: async () => {} });
  await assert.rejects(() => p.download({}), /exactly one of/);
  await assert.rejects(() => p.download({ role: 'link' }), /also needs a name/);
  await assert.rejects(() => p.download({ handle: 'opera-1', x: 1, y: 2 }), /exactly one of/);
});

// WHY THE NAME IS GIVEN AFTER THE FILE LANDS.
// A portal decides what it calls its own statement ("statement.pdf", "download (3).pdf"), and a bookkeeper cannot bill a folder of those.
// Renaming mid-write would leave Chrome writing to a name that no longer exists, so the new name is applied at the only moment the file is whole.


test('a download can be named as it lands, and a path is refused before the click', async () => {
  const disk = fakeDisk();
  const dir = path.resolve('opera-download-named');
  const cdp = downloadCdp(disk, {
    onRelease: () => disk.put(path.join(dir, 'statement.pdf'), 99)
  });
  const p = createPrimitives(cdp, { fs: disk, sleep: async () => {} });

  await assert.rejects(
    () => p.download({ x: 1, y: 2, dir, saveAs: 'sub/klien.pdf' }),
    /file name, not a path/
  );

  const out = await p.download({ x: 1, y: 2, dir, saveAs: 'klien-bca-2026-09.pdf' });

  assert.equal(out.file, 'klien-bca-2026-09.pdf');
  assert.equal(out.path, path.join(dir, 'klien-bca-2026-09.pdf'));
  assert.equal(out.landedAs, 'statement.pdf', 'the answer says what the portal called it');
  assert.ok(disk.files.has(out.path), 'the file is on disk under the name the caller chose');
  assert.equal(disk.files.has(path.join(dir, 'statement.pdf')), false, 'the old name is gone, not duplicated');
});

