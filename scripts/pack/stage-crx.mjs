// @last-edited: 2026-11-13 UTC+7.
// @title: stage-crx - the CRX staging folder carries exactly what the browser needs and no TypeScript source.
// @state: copies extension/ minus every .ts into a destination directory; verifies the emitted set is complete against the manifest, and refuses to produce a staging folder that would ship a type source.
// @dependencies: node:fs, node:path, node:url, node:assert.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(repo, 'extension');
const destination = path.resolve(process.argv[2] ?? path.join(repo, 'extension-crx-stage'));

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });

const copied = [];
const skipped = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (/\.ts$/i.test(entry.name)) { skipped.push(path.relative(source, full).split(path.sep).join('/')); continue; }
    const to = path.join(destination, path.relative(source, full));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(full, to);
    copied.push(path.relative(destination, to).split(path.sep).join('/'));
  }
};
walk(source);

assert.equal(skipped.length, 0, `the staging folder must not carry .ts sources: ${skipped.join(', ')}`);

const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
const referenced = [manifest.background?.service_worker];
for (const script of manifest.content_scripts ?? []) for (const js of script.js ?? []) referenced.push(js);
if (manifest.action?.default_popup) referenced.push(manifest.action.default_popup);
if (manifest.options_page) referenced.push(manifest.options_page);
if (manifest.icons) referenced.push(...Object.values(manifest.icons).map((file) => file));
if (manifest.action?.default_icon) referenced.push(...Object.values(manifest.action.default_icon));
for (const resource of manifest.web_accessible_resources ?? []) for (const pattern of resource.resources ?? []) referenced.push(pattern);
for (const script of manifest.content_scripts ?? []) for (const css of script.css ?? []) referenced.push(css);

for (const relative of referenced.filter(Boolean)) {
  if (/[*?]/.test(relative)) continue;
  const target = path.join(destination, relative);
  assert.ok(fs.existsSync(target), `the manifest names ${relative}, and the stage must carry it - the emitted twin is missing, so the build did not produce it; run npm run build:extension`);
}
process.stderr.write(`stage-crx: copied ${copied.length} files into ${destination}, no .ts inside, manifest references all present\n`);
