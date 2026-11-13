// @last-edited: 2026-11-11 UTC+7.
// @title: self-update - the build the server serves, and the files it writes over the reader's own folder.
// @state: the version the server serves, the entries of the build, and the write that puts them in place.
// @dependencies: zip-read, endpoints.

// WHY THE LOGIC LIVES IN LIB AND NOT IN THE WORKER.
// The part that decides what is written and what is refused is the part that must be provable, and lib/ is the part Node can read without a browser.
// The chrome.* parts - the alarm, the folder permission, the restart - live in the worker beside them.

// WHY THE BUILD IS CHECKED BEFORE IT IS WRITTEN.
// The folder is the reader's own installation, so a wrong file there breaks their browser until they notice.
// The build is therefore read first, and it is only written when it carries this extension's name and a version higher than the running one.

// WHY THE PATHS ARE CHECKED.
// The folder handle is the reader's, but the bytes that name the paths are the server's, and a path that walks out of the folder would write where nobody asked it to.

import { readZip } from './zip-read.js';
import { UPDATE_BASE_URL } from './endpoints.js';

export const newerThan = (installed: string | undefined, served: string | undefined) => {
  const a = String(installed || '').split('.').map((part) => Number(part) || 0);
  const b = String(served || '').split('.').map((part) => Number(part) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((b[index] || 0) !== (a[index] || 0)) return (b[index] || 0) > (a[index] || 0);
  }
  return false;
};

// WHY THE VERSION COMES FROM THE BUILD, NOT FROM THE HEALTH PAGE.
// The update service's /health answers for the legacy extension id by design, and a caller that reads its version as "what this extension should run" asks the wrong endpoint and is told 1.0.1 forever - which is why an update that looked wired up never happened.
// The served version of this extension rides on the build itself: a HEAD on the archive carries it in a header, and the archive is one call away when the header cannot be read.
// A caller that cannot learn the version therefore does the read that decides anyway, and the write stays refused unless the manifest inside the build says it is this product and it is newer.

export async function servedVersion(fetchImpl: typeof fetch = fetch) {
  try {
    const response = await fetchImpl(`${UPDATE_BASE_URL}/download/opera-agent.zip`, { method: 'HEAD', cache: 'no-store' });
    if (!response.ok) return null;
    const version = String(response.headers?.get('x-opera-version') ?? '').trim();
    return /^\d+\.\d+\.\d+$/.test(version) ? version : null;
  } catch {
    return null;
  }
}

const manifestOf = (entries: ReadonlyArray<{ name: string; bytes: Uint8Array }> | undefined) => {
  const entry = (entries ?? []).find((item) => item.name === 'manifest.json');
  if (!entry) return null;
  try {
    return JSON.parse(new TextDecoder().decode(entry.bytes));
  } catch {
    return null;
  }
};

const isSafePath = (name: string) => {
  const parts = String(name ?? '').split('/').filter(Boolean);
  if (!parts.length) return false;
  return !parts.includes('..');
};

async function writeBuild(folder: FileSystemDirectoryHandle, entries: ReadonlyArray<{ name: string; bytes: Uint8Array }>) {
  for (const entry of entries ?? []) {
    if (entry.name.endsWith('/')) continue;
    if (!isSafePath(entry.name)) throw new Error('the build carries a path outside the folder');
    const parts = entry.name.split('/').filter(Boolean);
    const fileName = parts.at(-1);
    if (!fileName) continue;
    let place = folder;
    for (const part of parts.slice(0, -1)) {
      place = await place.getDirectoryHandle(part, { create: true });
    }
    const handle = await place.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    // WHY THE COPY: entry.bytes may wrap a SharedArrayBuffer, and only a plain ArrayBuffer satisfies FileSystemWriteChunkType.
    const payload = new Uint8Array(entry.bytes.length);
    payload.set(entry.bytes);
    await writable.write(payload);
    await writable.close();
  }
  return true;
}

export async function applyBuild({ folder, installedVersion, fetchImpl = fetch }: { folder?: FileSystemDirectoryHandle | undefined; installedVersion?: string | undefined; fetchImpl?: typeof fetch }) {
  if (!folder) return { ok: false, reason: 'no-folder' };
  const served = await servedVersion(fetchImpl);
  if (served && !newerThan(installedVersion, served)) {
    return { ok: true, changed: false, version: served };
  }

  const response = await fetchImpl(`${UPDATE_BASE_URL}/download/opera-agent.zip`, { cache: 'no-store' });
  if (!response.ok) return { ok: false, reason: 'download-failed' };
  const entries = await readZip(new Uint8Array(await response.arrayBuffer()));
  const manifest = manifestOf(entries);
  if (!manifest || manifest.name !== 'Opera Agent') return { ok: false, reason: 'not-ours' };
  if (!newerThan(installedVersion, String(manifest.version ?? ''))) {
    return { ok: true, changed: false, version: manifest.version ?? installedVersion };
  }
  await writeBuild(folder, entries);
  return { ok: true, changed: true, version: String(manifest.version) };
}
