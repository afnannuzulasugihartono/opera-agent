// @last-edited: 2026-11-13 UTC+7.
// @title: pack-types - the packed tarball is the shipped artefact; it carries no .ts source and its bin runs.
// @state: npm pack runs against local/ into a scratch directory; the extracted file list is judged, never the sources, and the packed bin answers --help exactly once.
// The spec's exit criterion for the local TypeScript conversion: “`npm pack --dry-run` lists files, the extracted list carries no `.ts`, and the packed CLI runs.”
// @dependencies: node:test, node:assert/strict, node:child_process, node:fs, node:os, node:path, node:url.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const localDir = path.join(root, 'local');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});

test('the packed tarball carries no .ts source, keeps the generated copies, and its bin runs', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'opera-agent-mcp-pack-'));
  try {
    // --json names the tarball exactly once; guessing opera-agent-mcp-<version>.tgz breaks on the day the version moves.
    // --ignore-scripts because this test runs inside a suite of tests that import the twins: npm always runs prepack, and prepack recompiles local/*.js in place, which races the readers.
    // Freshness is pretest's job, not this test's; here the tarball is judged as the tree builds it.
    const packed = execFileSync(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', scratch], {
      cwd: localDir, encoding: 'utf8', shell: process.platform === 'win32'
    });
    const [result] = JSON.parse(packed);
    const tgz = path.join(scratch, result.filename);
    const extract = path.join(scratch, 'extract');
    mkdirSync(extract);
    execFileSync('tar', ['-xzf', tgz, '-C', extract]);

    const packageDir = path.join(extract, 'package');
    const files = walk(packageDir).map((file) => path.relative(packageDir, file).split(path.sep).join('/'));

    // Every shipped file is a .js runtime artefact, a .json/.md manifest or a .cmd twin; a .ts anywhere in the list ships the source the compiler was the judge of.
    const forbidden = files.filter((file) => /\.ts$/i.test(file) || !/\.(js|json|md|cmd)$/i.test(file));
    assert.deepEqual(forbidden, [], `the tarball ships files it must not: ${forbidden.join(', ')}`);

    for (const shipped of ['lib/bing-serp.js', 'lib/endpoints.js', 'lib/socket-protocol.js', 'lib/tidy.js']) {
      assert.ok(files.includes(shipped), `the tarball carries the generated copy ${shipped}`);
    }

    // The shebang must survive packing; without it `npx opera-agent-mcp` dies on a machine that cannot guess the interpreter.
    const bin = readFileSync(path.join(packageDir, 'bin', 'opera-agent-mcp.js'), 'utf8');
    assert.equal(bin.split('\n', 1)[0].trim(), '#!/usr/bin/env node', 'bin/opera-agent-mcp.js keeps its shebang on line 1');

    const help = spawnSync(process.execPath, [path.join(packageDir, 'bin', 'opera-agent-mcp.js'), '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0, `the packed bin answers --help: ${help.stderr || help.stdout}`);
    assert.equal((help.stdout.match(/opera-agent-mcp <mode>/g) || []).length, 1, 'the packed bin prints the usage block exactly once');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
