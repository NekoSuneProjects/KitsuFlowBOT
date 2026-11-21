// Syntax-checks every server and browser JavaScript file (`npm run check`, also used by CI).
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const roots = ['server.js', 'src', 'public/js', 'public/studio', 'scripts'];
const files = [];
const walk = entry => {
  if (statSync(entry).isDirectory())
    for (const name of readdirSync(entry)) walk(path.join(entry, name));
  else if (entry.endsWith('.js') || entry.endsWith('.mjs')) files.push(entry);
};
roots.forEach(walk);

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failed++;
    console.error(String(error.stderr || error.message));
  }
}
console.log(`Checked ${files.length} files, ${failed} failed.`);
process.exit(failed ? 1 : 0);
