// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: canonical-source-hash — source-hash — Repository file.
// @state: canonicalize source hash line endings.
// @dependencies: node:crypto.

import crypto from 'node:crypto';

function canonicalizeLfBytes(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const output = [];
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === 0x0d) {
      if (bytes[index + 1] === 0x0a) index += 1;
      output.push(0x0a);
      continue;
    }
    output.push(byte);
  }
  return Buffer.from(output);
}

export function sha256CanonicalLf(input) {
  return crypto.createHash('sha256').update(canonicalizeLfBytes(input)).digest('hex');
}
