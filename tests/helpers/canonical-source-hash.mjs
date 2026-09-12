import crypto from 'node:crypto';

export function canonicalizeLfBytes(input) {
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
