// @last-edited: 2026-10-05 20:10 UTC+7.
// @title: landing-deploy — how this site reaches Vercel, and what it costs.
// @state: 4 locks; the deploy budget and the CLI invocation are both measured.
// @dependencies: node:test, node:assert, node:fs.

// The site went quiet twice for the same reason and neither time was obvious from the
// repository: a connected Vercel project deploys on every push, and a Hobby account
// allows 100 deployments a day. Fifteen pushes is most of a day, spent on documentation.
//
// These locks pin the two things that fix it: automatic deployment is off, so the budget
// is only spent deliberately, and the CLI is documented with the one invocation that works
// now that the project's Root Directory is set.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
const vercel = JSON.parse(read('landing/vercel.json'));

test('a push does not deploy, because every push spent the daily budget', () => {
  // WHY this is locked rather than noted: the failure mode is silence. The push succeeds,
  // the commit is on main, and production keeps serving the previous build with nothing in
  // CI or git to say so. Measured twice on this project.
  assert.equal(vercel.git?.deploymentEnabled, false, 'git auto-deployment is off');
});

test('the static-hosting pins survive that change', () => {
  // WHY these three specifically: an auto-detected framework replaced the root document
  // once already, and the deployment URL served a dashboard while the alias 404'd.
  assert.equal(vercel.framework, null, 'no framework may be detected');
  assert.equal(vercel.buildCommand, null, 'there is no build step to run');
  assert.equal(vercel.outputDirectory, '.', 'the served directory is the site itself');
  assert.equal(vercel.cleanUrls, true, 'and extensionless URLs are the canonical ones');
});

test('the deploy invocation is written down where it will be found', () => {
  // WHY this matters now: the project's Root Directory is `landing`, so running the CLI
  // from inside `landing/` resolves `landing/landing` and Vercel refuses with "the
  // specified Root Directory does not exist". The working invocation is from the repo root.
  const handoff = read('docs/HANDOFF.md');
  assert.match(handoff, /vercel deploy landing/, 'the working invocation is recorded');
  assert.match(handoff, /repo root|repository root|from the root/i, 'and says where to run it from');
});

test('the edge is told not to hold a page, because Cache-Control alone does not', () => {
  // WHY this lock names two headers: measured on the live site, every page answered 200 with
  // `Cache-Control: no-store` and `x-vercel-cache: HIT` with an age around thirty minutes,
  // and the cached copy survived a deployment. A shipped fix was invisible for half an hour
  // and a live verification read the previous build. `Cache-Control` governs the browser;
  // Vercel's edge only obeys `Vercel-CDN-Cache-Control`, which nothing here set.
  for (const entry of vercel.headers) {
    const cdn = entry.headers.find((h) => h.key === 'Vercel-CDN-Cache-Control');
    assert.ok(cdn, `${entry.source} tells the edge what to do`);
    const isArchive = entry.source.includes('.zip');
    assert.equal(cdn.value, isArchive ? 'public, max-age=31536000, immutable' : 'no-store', `${entry.source} holds or releases as intended`);
  }
  const headers = read('landing/_headers');
  const rules = headers.split('\n').filter((l) => /^ {2}Vercel-CDN-Cache-Control:/.test(l));
  const blocks = headers.split(/\n\n/).filter((b) => /^ {2}Cache-Control:/m.test(b));
  assert.equal(rules.length, blocks.length, 'the other host is told the same thing on every rule');
});

test('the archive is held, because its name carries the version', () => {
  const archive = vercel.headers.find((h) => h.source === '/opera-agent-1.6.15.zip');
  assert.ok(archive, 'the archive has a rule of its own rather than inheriting no-store');
  assert.match(archive.headers.find((h) => h.key === 'Cache-Control').value, /immutable/, 'and is immutable, which is safe only because the name is versioned');
});

test('the site is reachable at the path GoTrue asks for, from the site root directory', () => {
  // WHY the two belong in one lock: the consent screen only works because it is served
  // from the same origin GoTrue validates, and it only works at that path because the
  // file sits in the directory the URL names.
  assert.match(read('supabase/config.toml'), /site_url = "https:\/\/opera-agent\.vercel\.app"/);
  assert.match(read('supabase/config.toml'), /authorization_path = "\/oauth\/consent"/);
  assert.ok(fs.existsSync(new URL('landing/oauth/consent.html', root)), 'the page is at that path');
  const sources = vercel.headers.map((h) => h.source);
  for (const source of ['/oauth/consent', '/oauth/consent.html']) {
    assert.ok(sources.includes(source), `${source} carries its own policy`);
  }
});