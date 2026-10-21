// @last-edited: 2026-10-21 UTC+7.
// @title: canonical-source-hash — the digest that holds the MCP contract instead of the formatting.
// @state: the comment lines are removed and the whitespace is collapsed before hashing, so an edit to a comment does not move the pin.
// @dependencies: node:crypto, tests/helpers/comment-format.mjs.

import crypto from 'node:crypto';
import { commentLineMask } from './comment-format.mjs';

// WHY THE COMMENTS COME OUT BEFORE THE HASH.
// A digest over raw source text pins the formatting as much as the contract, so a comment edit moves a pin that is supposed to hold the tool list.
// The tool names and their schemas are the contract, so the digest is taken over the code with the comment lines removed and the whitespace collapsed.
// The mask is the tree's one answer to "is this line a comment", so the digest and the formatter cannot disagree about it.

export function sha256ContractSource(input, ext = '.ts') {
  const text = (Buffer.isBuffer(input) ? input.toString('utf8') : String(input)).replace(/\r\n/g, '\n');
  const mask = commentLineMask(text, ext);
  const code = text.split('\n')
    .filter((line, index) => !mask[index])
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(code, 'utf8').digest('hex');
}
