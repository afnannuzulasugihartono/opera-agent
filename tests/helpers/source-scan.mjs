// Source-text scanning helpers for drift locks.
//
// WHY THIS EXISTS: several locks assert something about code that comments and
// documentation also discuss in prose. Without stripping comments those locks
// fire on a sentence that merely *describes* the behaviour, which makes them
// noisy and trains reviewers to ignore them.
//
// SQL and JavaScript share two comment forms: `--` to end of line and `/* */`.
// JavaScript adds `//`, which is only treated as a comment when it starts a line
// (optionally indented) so that a `//` inside a URL string is left alone.

const LINE_COMMENT = { sql: /^\s*--/, javascript: /^\s*\/\// };

/**
 * Remove comments so a scan cannot match prose that only describes code.
 *
 * @param {string} src
 * @param {'sql'|'javascript'} kind
 * @returns {string} the source with comment text blanked out
 */
export function stripComments(src, kind) {
  const lineStart = LINE_COMMENT[kind];
  const lines = src.split('\n');
  const withoutLines = lines.map((line) => (lineStart.test(line) ? '' : line));
  return withoutLines.join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Collect every source file under `dir` (recursively) with the given extensions.
 *
 * @param {URL} dir
 * @param {string[]} extensions
 * @returns {Promise<Array<{name: string, url: URL, src: string}>>}
 */
export async function collectSources(dir, extensions) {
  const { readdir, readFile } = await import('node:fs/promises');
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) {
      out.push(...await collectSources(url, extensions));
      continue;
    }
    if (extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push({ name: entry.name, url, src: await readFile(url, 'utf8') });
    }
  }
  return out;
}
