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

  // serialize sebelum watch-registry: hygiene menyatukan pasangan ini.
  if (files.includes('extension/lib/serialize.js') && files.includes('extension/worker/watch-registry.js')) {
    assert.ok(idx('extension/lib/serialize.js') < idx('extension/worker/watch-registry.js'),
      'serialize must precede watch-registry');
    assert.ok(src.indexOf('function boundedResult') >= 0, 'boundedResult must be in the bundle');
    assert.ok(src.indexOf('// ---- Event-Triggered Workflows') > src.indexOf('function boundedResult'),
      'the watch section marker must follow boundedResult');
  }

  // execute-pull terakhir: hygiene memotong executeCommand tanpa batas kedua.
  if (files.includes('extension/worker/execute-pull.js')) {
    assert.equal(idx('extension/worker/execute-pull.js'), files.length - 1,
      'execute-pull must be last so its slice runs to the end of the bundle');
  }

  // Anchor yang selalu ada — menangkap kasus seperti U-V yang memotong -1.
  for (const anchor of [
    'async function executeCommand',
    'async function withForegroundFocusGate',
    '// Action Pipeline',
    'function boundedResult',
    'function oversized',
    '// ---- Event-Triggered Workflows',
  ]) {
    assert.ok(src.indexOf(anchor) > 0, `anchor must exist in the bundle: ${anchor}`);
  }
});

test('no state is declared twice across the bundle', async () => {
  const files = extensionSourceFiles();
  if (files.length === 1) return;          // belum ada modul yang dipindah
  const decls = new Map();
  for (const rel of files) {
    const text = await readFile(new URL(`../${rel}`, import.meta.url), 'utf8');
    // `export` ialah bagian dari polanya, bukan hiasan opsional. Tanpa ia, pindai
    // ini melihat 21 dari 36 deklarasi top-level bundel dan buta terhadap 14 yang
    // diekspor — yakni persis state lintas-modul yang berbahayanya dinamai di
    // bawah. Pembuktinya: probe yang diduplikasi sebagai `export const` lolos,
    // probe yang sama sebagai `const` biasa merah.
    const names = [
      ...text.matchAll(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm),
    ].map((m) => m[1]);
    // Ikatan terdestrukturisi di tingkat modul ialah state seperti state lain:
    // `const { a, b } = globalThis.…` mengikat dua nama, bukan satu.
    for (const m of text.matchAll(/^(?:export\s+)?(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/gm)) {
      for (const piece of m[1].split(',')) {
        const name = piece.trim().split(':').pop().trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
      }
    }
    // Sengaja TIDAK dicakup: `const a = 1, b = 2;`. Pencariannya membaca
    // `let serializedResult = { value: null, text: '' };` di lib/serialize.js
    // sebagai multi-deklarasi, karena tanda koma itu duduk di dalam sebuah objek
    // nilai. Menangkapnya butuh pemindai sungguhan, dan heuristik yang salah
    // baca ialah satu-satunya hal yang suite ini tolak. Celahnya dipilih,
    // bukan terlewat.
    for (const name of names) decls.set(name, [...(decls.get(name) || []), rel]);
  }
  const duplicated = [...decls].filter(([, where]) => where.length > 1);
  assert.deepEqual(duplicated, [], 'a state declared in two files will silently diverge');
});

test('every cross-module name is imported where it is used', async () => {
  const files = extensionSourceFiles();
  if (files.length === 1) return;          // belum ada modul yang dipindah

  // Buang komentar dan string agar nama di dalamnya tidak dihitung sebagai pemakaian.
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

  const clean = new Map(), exported = new Map(), imported = new Map(), declared = new Map();
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
    declared.set(rel, dec);
  }

  const universe = new Set();
  for (const s of exported.values()) for (const n of s) universe.add(n);

  const misses = [];
  for (const rel of files) {
    const code = clean.get(rel);
    for (const n of universe) {
      if (exported.get(rel).has(n)) continue;   // file ini pemiliknya
      if (imported.get(rel).has(n)) continue;   // sudah diimpor
      if (declared.get(rel).has(n)) continue;   // ditutupi deklarasi lokal
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
  const src = await extensionSource();
  const literal = `files: [${expected.map((f) => `'${f}'`).join(', ')}]`;
  assert.ok(src.includes(literal),
    `the runtime injection list must stay byte-identical to manifest.content_scripts[0].js:\n  ${literal}`);
});

test('capture never imports private-tabs, so the split cannot close a fifth cycle', async () => {
  const files = extensionSourceFiles();
  if (!files.includes('extension/worker/capture.js')) return;
  // Tingkatnya SATU, bukan dua: berkas ini ada di tests/, jadi ../ sudah mencapai
  // akar repositori. Dua tingkat naik ke D:/GitHub/ dan melempar ENOENT — kesalahan
  // yang ditemukan dengan menjalankan kelima tes ini ke pohon hidup sebelum brief
  // dikirim. tests/helpers/extension-source.mjs memang memakai dua tingkat, karena
  // berkas itu duduk di tests/helpers/.
  const text = await readFile(new URL('../extension/worker/capture.js', import.meta.url), 'utf8');
  assert.ok(!/from\s+'\.\/private-tabs\.js'/.test(text),
    'capture -> private-tabs would form capture -> private-tabs -> capture');
});

test('no import brings in a name its own file never uses', async () => {
  const files = extensionSourceFiles();
  if (files.length === 1) return;          // belum ada modul yang dipindah
  const dead = [];
  for (const rel of files) {
    const text = await readFile(new URL(`../${rel}`, import.meta.url), 'utf8');
    const lines = text.split('\n');

    // Sebuah pernyataan impor bisa membentang banyak baris. Tanpa penanda ini,
    // sebuah pernyataan { a, b, c } di banyak baris membaca baris kelanjutannya
    // sendiri sebagai pemakaian dan tidak pernah bisa merah — cacat yang sama
    // persis yang menyembunyikan 50 nama mati selama 18 task.
    //
    // Sebaliknya, impor efek samping (`import './role-reconcile.js';`) punya
    // titik koma tapi tak punya kurawal. Membuka blok tanpa memeriksa ';' akan
    // menandai seluruh sisa berkas sebagai "baris impor", menelan pemakaian yang
    // sah, dan menuduh nama yang hidup sebagai mati. Kedua arah salah ini
    // ditemukan pada pohon yang sama saat mengaudit Task 18.
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
        // Sebuah komentar inline di dalam kurawal impor (`foo, // alasan`)
        // menghasilkan token `// alasan` — yang tak pernah bisa dieja oleh baris
        // mana pun di luar blok impor, jadi tes ini menuduhnya mati. Tak ada
        // pemicunya hari ini (nol dari 87 pernyataan impor di bundel membawa
        // komentar inline), tapi bias tes ini ialah tak pernah menyalahkan keliru,
        // dan ini satu-satunya pilihan pemformatan yang bisa mematahkan janji itu.
        if (!/^[A-Za-z_$][\w$]*$/.test(token)) continue;
        let uses = 0;
        for (let i = 0; i < lines.length; i++) {
          if (insideImport[i]) continue;
          // Pemakaian di komentar tetap dihitung: lebih baik tidak menyalahkan
          // daripada menyalahkan keliru. Yang dilarang di sini ialah nol.
          if (lines[i].split(/[^A-Za-z0-9_$]+/).includes(token)) uses++;
        }
        if (uses === 0) dead.push(`${rel}: ${token}`);
      }
    }
  }
  assert.deepEqual(dead, [],
    'an imported name with no call site is weight that hides the next real import');
});
