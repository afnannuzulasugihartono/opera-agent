// @last-edited: 2026-11-12 UTC+7.
// @title: bump-version-lib - the pure core of the version bump; no fs, no exec, no process.
// @state: every decision the engine makes that can be computed in isolation lives here so the gate can pin it.
// @dependencies: none.

// WHY THIS FILE EXISTS.
// The first draft of the engine kept its rewrite table inside the orchestrator, and a file with two entries in the table (the handoff carries three) had every entry reading the original file from disk and overwriting the previous entry's result.
// Two clock anchors vanished silently, the gates stayed green, and only the diff showed the loss.
// Splitting the table application into a pure function is what makes that failure impossible to write by accident: one text in, one text out, entries applied in order.

export function countOccurrences(text, needle) {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

// Applies one entry; returns the replaced text or throws naming the file and the expected count.

export function applyEntry(text, entry) {
  const found = countOccurrences(text, entry.from);
  if (found !== entry.expect) {
    throw new Error(`${entry.file}: expected ${entry.expect} occurrence(s) of ${JSON.stringify(entry.from)}, found ${found} - the enumeration is stale; fix the list, not the assert`);
  }
  return text.split(entry.from).join(entry.to);
}

// Applies every entry for one file, in order, each seeing the previous entry's result.

export function applyEntries(text, entries) {
  return entries.reduce((acc, entry) => applyEntry(acc, entry), text);
}

export function buildEnumeration(current, newVersion) {
  const q = (value) => `'${value}'`;
  return [
    { file: 'extension/lib/protocol.js', from: `PRODUCT_VERSION = '${current}'`, to: `PRODUCT_VERSION = '${newVersion}'`, expect: 1 },
    { file: 'extension/manifest.json', from: `"version": "${current}"`, to: `"version": "${newVersion}"`, expect: 1 },
    { file: 'docs/store/store-manifest.json', from: `"version": "${current}.0"`, to: `"version": "${newVersion}.0"`, expect: 1 },
    { file: 'package.json', from: `"version": "${current}"`, to: `"version": "${newVersion}"`, expect: 1 },
    { file: 'local/package.json', from: `"version": "${current}"`, to: `"version": "${newVersion}"`, expect: 1 },
    { file: 'scripts/verify/check.mjs', from: q(current), to: q(newVersion), expect: 3 },
    { file: 'hosted/functions/opera-agent-mcp/index.ts', from: `SERVER_VERSION = "${current}"`, to: `SERVER_VERSION = "${newVersion}"`, expect: 1 },
    { file: 'tests/extension/burst-atomic-actions.test.mjs', from: q(current), to: q(newVersion), expect: 2 },
    { file: 'tests/extension/hover-settle.test.mjs', from: q(current), to: q(newVersion), expect: 1 },
    { file: 'tests/hosted/mcp-surface.test.mjs', from: q(current), to: q(newVersion), expect: 1 },
    { file: 'tests/extension/protocol.test.mjs', from: q(current), to: q(newVersion), expect: 1 },
    { file: 'tests/extension/role-reconcile.test.mjs', from: q(current), to: q(newVersion), expect: 1 },
    { file: 'tests/extension/timeout-retry-popup-parity.test.mjs', from: q(current), to: q(newVersion), expect: 1 },
    { file: 'landing/mcp.html', from: `version: ${current}`, to: `version: ${newVersion}`, expect: 1 },
    { file: 'docs/handoff.md', from: `at the ${current} release commit`, to: `at the ${newVersion} release commit`, expect: 1 },
    { file: 'docs/handoff.md', from: `everything ${current}`, to: `everything ${newVersion}`, expect: 1 },
    { file: 'docs/handoff.md', from: `releases/${current}.md`, to: `releases/${newVersion}.md`, expect: 2 },
  ];
}

export function buildWhyBlock(today, version) {
  return `// WHY these three were re-pinned on ${today}: the ${version} release rode them.\n// The version constants moved (manifest.json version, index.ts SERVER_VERSION); nothing about the public contract moved with them.\n\n`;
}

export function buildChangelogRow(version, today) {
  return `| ${version} | ${today} | [the release notes are written in the PR that carries this bump](docs/releases/${version}.md) |`;
}

export function buildReleaseNote(version, today, recentCommits) {
  return `# @last-edited: ${today} UTC+7.
# @title: ${version} - the release note is written in the PR that carries this file.
# @state: the release note for the version the tree now reads; the prose is filled by the reviewer before it merges.
# @dependencies: none.

# WHAT REACHED THE SURFACE

filled in review.

# WHAT CHANGED FOR CALLERS

filled in review.

# WHAT IT COSTS THE READER

filled in review.

# RECENT COMMITS

${recentCommits}
`;
}
