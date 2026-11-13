// @last-edited: 2026-11-13 UTC+7.
// @title: sha256 - the one hash both the device bridge and the billing edge use to compare a token hash.
// @state: one function, one digest path, byte-identical on both roads by construction.
// @dependencies: none.

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
