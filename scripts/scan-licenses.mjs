import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const allowed = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
]);
const pkgDirs = ['apps', 'packages'];
let failed = false;
for (const root of pkgDirs) {
  for (const name of readdirSync(root)) {
    const file = join(root, name, 'package.json');
    try {
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      if (pkg.license && !allowed.has(pkg.license) && pkg.license !== 'UNLICENSED') {
        process.stderr.write(`${file} license ${pkg.license}\n`);
        failed = true;
      }
    } catch {
      continue;
    }
  }
}
if (failed) {
  process.exit(1);
}
process.stdout.write('licence scan clean\n');
