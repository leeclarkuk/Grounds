import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'));
const packages = [];
const walk = (value, path = []) => {
  if (value && typeof value === 'object') {
    if ('version' in value && typeof value.version === 'string' && path.length > 0) {
      packages.push({ name: path[path.length - 1], version: value.version });
    }
    for (const [key, nested] of Object.entries(value)) {
      walk(nested, [...path, key]);
    }
  }
};
walk(lock);
const unique = [
  ...new Map(packages.map((item) => [`${item.name}@${item.version}`, item])).values(),
];
unique.sort((a, b) => a.name.localeCompare(b.name));
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { name: 'grounds', type: 'application' },
  },
  components: unique.map((item) => ({ type: 'library', name: item.name, version: item.version })),
};
mkdirSync(join(root, 'dist'), { recursive: true });
const json = JSON.stringify(sbom, null, 2);
writeFileSync(join(root, 'dist/sbom.json'), json);
const digest = createHash('sha256').update(json).digest('hex');
writeFileSync(join(root, 'dist/sbom.sha256'), `${digest}  sbom.json\n`);
process.stdout.write(`sbom ${String(unique.length)} components ${digest}\n`);
