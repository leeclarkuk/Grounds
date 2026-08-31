import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['apps', 'packages', 'tests', 'scripts', 'docs'];
const FORBIDDEN = [
  /AKIA[0-9A-Z]{16}/,
  /ASIA[0-9A-Z]{16}/,
  /aws_secret_access_key/i,
  /BEGIN [A-Z ]*PRIVATE KEY/,
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next' || entry === '.git') {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

let failed = false;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (!/\.(ts|js|mjs|md|json|yml)$/.test(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN) {
      if (
        pattern.test(text) &&
        !file.includes('redaction') &&
        !file.includes('scan-secrets')
      ) {
        process.stderr.write(`${file} matched ${String(pattern)}\n`);
        failed = true;
      }
    }
  }
}
if (failed) {
  process.exit(1);
}
process.stdout.write('secret scan clean\n');
