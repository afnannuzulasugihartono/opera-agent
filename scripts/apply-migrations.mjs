// @last-edited: 2026-10-21 UTC+7.
// @title: apply-migrations — apply SQL migration files through the Supabase Management API.
// @state: the files it reads and the token it needs; the bytes in the tree are the bytes the database receives.
// @dependencies: none.
// It reads files, so the exact bytes in the tree are what the database receives.

// Usage: node scripts/apply-migrations.mjs <file-or-glob> [...] Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const REF = process.env.SUPABASE_PROJECT_REF || 'nenmkmtvjremqphfqnfw';
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token) {
  process.stderr.write('SUPABASE_ACCESS_TOKEN is not set.\n');
  process.exit(2);
}

const files = process.argv.slice(2);
if (!files.length) {
  process.stderr.write('usage: node scripts/apply-migrations.mjs <file> [...]\n');
  process.exit(2);
}

// WHY THE TRIM IS A LOOP AND NOT TWO PATTERNS.
// SonarCloud flagged the trim as a pattern that can walk back into a run it has already matched (S8786), which is a fair thing to be suspicious of in a script that names migrations.
// Walking the string says exactly what it does, and the output is the same string: the folded name with no leading or trailing underscore, cut to sixty characters.

const trimUnderscores = (text) => {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === '_') start += 1;
  while (end > start && text[end - 1] === '_') end -= 1;
  return text.slice(start, end);
};

const slug = (name) => trimUnderscores(name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()).slice(0, 60);

for (const file of files) {
  const query = await readFile(file, 'utf8');
  const name = slug(basename(file).replace(/\.sql$/, ''));
  const response = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const body = await response.text();
  if (!response.ok) {
    process.stderr.write(`FAILED ${basename(file)}: ${response.status} ${body.slice(0, 400)}\n`);
    process.exit(1);
  }
  process.stdout.write(`applied ${basename(file)} as ${name}\n`);
}
