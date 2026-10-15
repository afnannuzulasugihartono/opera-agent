// apply-migrations.mjs — apply SQL migration files through the Supabase
// Management API, because `supabase db push` needs a direct Postgres route
// that this machine does not have, and pasting multi-kilobyte dollar-quoted
// JSON through a tool call loses quoting. It reads files, so the exact bytes
// in the tree are what the database receives.
//
// Usage: node scripts/apply-migrations.mjs <file-or-glob> [...]
// Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF.

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

// WHY THE TRIM IS TWO REPLACES. One alternation over both ends reads as a pattern that
// can match a run and walk back into it; two linear passes cannot, and the result is
// the same string.

const slug = (name) => name
  .replace(/[^a-z0-9]+/gi, '_')
  .replace(/^_+/, '')
  .replace(/_+$/, '')
  .toLowerCase()
  .slice(0, 60);

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
