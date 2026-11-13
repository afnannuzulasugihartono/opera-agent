// @last-edited: 2026-11-12 UTC+7.
// @title: registry - the one key this project writes, and the seam that keeps it honest.
// @state: HKCU only, per-user, no elevation; a failure is reported, never thrown.
// @dependencies: node:child_process.

// WHY THE EXECFILE IS A PARAMETER.
// The command runs in CI where there is no registry and on developer machines where there is.
// The test injects a fake; production passes nothing and gets execFileSync.

import { execFileSync } from 'node:child_process';

export const EXTENSION_ID = 'ofgemipoobcnbjkfanmofjbdonjapmgl';
export const UPDATE_URL = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/update.xml?id=ofgemipoobcnbjkfanmofjbdonjapmgl';

const vendorKeys: Record<string, string> = {
  chrome: `HKCU\\Software\\Google\\Chrome\\Extensions\\${EXTENSION_ID}`,
  brave: `HKCU\\Software\\BraveSoftware\\Brave-Browser\\Extensions\\${EXTENSION_ID}`,
  edge: `HKCU\\Software\\Microsoft\\Edge\\Extensions\\${EXTENSION_ID}`,
};

type Exec = (cmd: string, args: string[]) => string;
const defaultExec: Exec = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function writeExtensionKey({ vendor, exec = defaultExec }: { vendor: string; exec?: Exec }) {
  const key = vendorKeys[vendor];
  if (!key) return { ok: false, error: `unknown vendor: ${vendor}` };
  try {
    exec('reg', ['add', key, '/v', 'update_url', '/t', 'REG_SZ', '/d', UPDATE_URL, '/f']);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: String((error as Error)?.message || error) };
  }
}

export function deleteExtensionKey({ vendor, exec = defaultExec }: { vendor: string; exec?: Exec }) {
  const key = vendorKeys[vendor];
  if (!key) return { ok: false, error: `unknown vendor: ${vendor}` };
  try {
    exec('reg', ['delete', key, '/f']);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: String((error as Error)?.message || error) };
  }
}
