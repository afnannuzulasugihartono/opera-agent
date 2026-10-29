// @last-edited: 2026-10-09 UTC+7.
// @title: extension-source — the bundle order keeps every slice anchor valid.
// @state: pins background.js as the first FILES entry and the bundle's byte-identical prefix — a claim that survives a second file.
// @dependencies: node:test, strict, node:fs/promises, helpers/extension-source.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extensionSource, extensionSourceFiles } from './helpers/extension-source.mjs';

test('the helper reads background.js itself, and lists it first', async () => {
  const raw = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  const files = extensionSourceFiles();
  assert.equal(files[0], 'extension/background.js',
    'background.js must stay the first entry; every anchor is measured from it');
  const bundle = await extensionSource();
  assert.ok(bundle.startsWith(raw),
    'the bundle must begin with background.js byte-for-byte — a wrong path, a '
    + 'wrong encoding, or a reordered FILES array all break this');
});

test('the bundle order keeps every cross-module indexOf anchor valid', async () => {
  const src = await extensionSource();
  const files = extensionSourceFiles();
  const idx = (name) => files.indexOf(name);

  if (files.includes('extension/lib/serialize.js') && files.includes('extension/worker/watch-registry.js')) {
    assert.ok(idx('extension/lib/serialize.js') < idx('extension/worker/watch-registry.js'),
      'serialize must precede watch-registry');
    assert.ok(src.indexOf('function boundedResult') >= 0, 'boundedResult must be in the bundle');

    assert.ok(src.indexOf("const WATCH_STATE_KEY") > src.indexOf('function boundedResult'),
      'the watch registry must follow boundedResult');
  }

  if (files.includes('extension/worker/execute-pull.js')) {
    assert.equal(idx('extension/worker/execute-pull.js'), files.length - 1,
      'execute-pull must be last so its slice runs to the end of the bundle');
  }

  for (const anchor of [
    'async function executeCommand',
    'async function withForegroundFocusGate',
    'const UV_WAIT_FLOOR_MS',
    'function boundedResult',
    'function oversized',
    'const WATCH_STATE_KEY',
  ]) {
    assert.ok(src.indexOf(anchor) > 0, `anchor must exist in the bundle: ${anchor}`);
  }
});

test('no state is declared twice across the bundle', async () => {
  const files = extensionSourceFiles();
  if (files.length === 1) return;
  const decls = new Map();
  for (const rel of files) {
    const text = await readFile(new URL(`../${rel}`, import.meta.url), 'utf8');

    const names = [
      ...text.matchAll(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm),
    ].map((m) => m[1]);

    for (const m of text.matchAll(/^(?:export\s+)?(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/gm)) {
      for (const piece of m[1].split(',')) {
        const name = piece.trim().split(':').pop().trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
      }
    }

    for (const m of text.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
      names.push(m[1]);
    }

    for (const name of names) decls.set(name, [...(decls.get(name) || []), rel]);
  }
  const duplicated = [...decls].filter(([, where]) => where.length > 1);
  assert.deepEqual(duplicated, [], 'a state declared in two files will silently diverge');
});

test('every cross-module name is imported where it is used', async () => {
  const files = extensionSourceFiles();
  if (files.length === 1) return;

  const strip = (text) => {
    let out = '', i = 0;
    const keep = (s) => (s.match(/\n/g) || ['']).join('');
    while (i < text.length) {
      const c = text[i], c2 = text.slice(i, i + 2);
      if (c2 === '//') { const s = i; while (i < text.length && text[i] !== '\n') i++; out += keep(text.slice(s, i)); continue; }
      if (c2 === '/*') { const s = i; i += 2; while (i < text.length && text.slice(i, i + 2) !== '*/') i++; i += 2; out += keep(text.slice(s, i)); continue; }
      if (c === '"' || c === "'" || c === '`') {
        const q = c, s = i; i++;
        while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; }
        i++; out += '""' + keep(text.slice(s, i)); continue;
      }
      out += c; i++;
    }
    return out;
  };

  const clean = new Map(), exported = new Map(), imported = new Map();
  const declared = new Map(), topLevel = new Map();
  for (const rel of files) {
    const text = await readFile(new URL(`../${rel}`, import.meta.url), 'utf8');
    const code = strip(text);
    clean.set(rel, code);

    const exp = new Set();
    for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) exp.add(m[1]);
    for (const b of text.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const n of b[1].split(',')) {
        const name = n.trim().split(/\s+as\s+/).pop().trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) exp.add(name);
      }
    }
    exported.set(rel, exp);

    const imp = new Set();
    for (const b of code.matchAll(/import\s*\{([^}]*)\}/g)) {
      for (const n of b[1].split(',')) {
        const name = n.trim().split(/\s+as\s+/).pop().trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) imp.add(name);
      }
    }
    imported.set(rel, imp);

    const dec = new Set();
    for (const m of code.matchAll(/(?:^|[^\w$.])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) dec.add(m[1]);
    for (const m of code.matchAll(/(?:^|[^\w$.])(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) dec.add(m[1]);
    for (const m of code.matchAll(/(?:^|[^\w$.])(?:function|const|let|var|class)\s*\(?[^)]*\b([A-Za-z_$][\w$]*)\s*[)=,]/g)) dec.add(m[1]);

    for (const m of code.matchAll(/^(?:export\s+)?(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/gm)) {
      for (const piece of m[1].split(',')) {
        const name = piece.trim().split(':').pop().trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) dec.add(name);
      }
    }
    declared.set(rel, dec);

    const top = new Set();
    for (const m of code.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) top.add(m[1]);
    for (const m of code.matchAll(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) top.add(m[1]);
    for (const m of code.matchAll(/^(?:export\s+)?(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/gm)) {
      for (const piece of m[1].split(',')) {
        const name = piece.trim().split(':').pop().trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) top.add(name);
      }
    }
    topLevel.set(rel, top);
  }

  const universe = new Set();
  for (const s of topLevel.values()) for (const n of s) universe.add(n);

  const misses = [];
  for (const rel of files) {
    const code = clean.get(rel);
    for (const n of universe) {
      if (exported.get(rel).has(n)) continue;
      if (imported.get(rel).has(n)) continue;
      if (declared.get(rel).has(n)) continue;
      if (!new RegExp(`(?<![.\\w$])${n}\\b`).test(code)) continue;
      misses.push(`${rel}: ${n}`);
    }
  }
  assert.deepEqual(misses, [],
    'a name used but not imported does not fail at load — it fails when the user hits the feature');
});

test('the ensureContent script list still matches the manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const expected = manifest.content_scripts[0].js;
  const src = await readFile(new URL('../extension/worker/tab-content.js', import.meta.url), 'utf8');
  const literal = /files:\s*\[([\s\S]*?)\]/.exec(src);
  assert.ok(literal, 'the runtime injection list must still be written in the source');
  const found = [...literal[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(found, expected,
    'the runtime injection list must stay identical to manifest.content_scripts[0].js, in the same order');
});

test('capture never imports private-tabs, so the split cannot close a fifth cycle', async () => {
  const files = extensionSourceFiles();
  if (!files.includes('extension/worker/capture.js')) return;

  const text = await readFile(new URL('../extension/worker/capture.js', import.meta.url), 'utf8');
  assert.ok(!/from\s+'\.\/private-tabs\.js'/.test(text),
    'capture -> private-tabs would form capture -> private-tabs -> capture');
});

test('no import brings in a name its own file never uses', async () => {
  const files = extensionSourceFiles();
  if (files.length === 1) return;
  const dead = [];
  for (const rel of files) {
    const text = await readFile(new URL(`../${rel}`, import.meta.url), 'utf8');
    const lines = text.split('\n');

    const insideImport = [];
    let open = false;
    for (const line of lines) {
      const head = line.trimStart();
      if (open) {
        insideImport.push(true);
        if (head.includes('}')) open = false;
        continue;
      }
      const isImport = head.startsWith('import');
      insideImport.push(isImport);
      if (isImport && !head.includes('}') && !head.includes(';')) open = true;
    }

    for (const m of text.matchAll(/import\s*{([^}]*)}\s*from/gs)) {
      for (const raw of m[1].split(',')) {
        const token = raw.trim().split(/\s+as\s+/).pop().trim();

        if (!/^[A-Za-z_$][\w$]*$/.test(token)) continue;
        let uses = 0;
        for (let i = 0; i < lines.length; i++) {
          if (insideImport[i]) continue;

          if (lines[i].split(/[^A-Za-z0-9_$]+/).includes(token)) uses++;
        }
        if (uses === 0) dead.push(`${rel}: ${token}`);
      }
    }
  }
  assert.deepEqual(dead, [],
    'an imported name with no call site is weight that hides the next real import');
});
