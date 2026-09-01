import { spawnSync } from 'node:child_process';

const allowed = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'MPL-2.0',
  'LGPL-3.0-or-later',
]);

const result = spawnSync('pnpm', ['licenses', 'list', '--json'], {
  encoding: 'utf8',
  maxBuffer: 20_000_000,
});
if (result.status !== 0) {
  process.stderr.write(result.stderr || 'pnpm licenses list failed\n');
  process.exit(result.status === null ? 1 : result.status);
}

const parsed = JSON.parse(result.stdout);
let failed = false;
let count = 0;
for (const [license, packages] of Object.entries(parsed)) {
  const items = Array.isArray(packages) ? packages : [];
  count += items.length;
  if (!allowed.has(license)) {
    process.stderr.write(`disallowed licence ${license}\n`);
    for (const item of items) {
      if (item && typeof item === 'object' && 'name' in item) {
        process.stderr.write(`  ${String(item['name'])}\n`);
      }
    }
    failed = true;
  }
}
if (failed) {
  process.exit(1);
}
if (count === 0) {
  process.stderr.write('licence scan found no resolved packages\n');
  process.exit(1);
}
process.stdout.write(`licence scan clean ${String(count)} packages\n`);
