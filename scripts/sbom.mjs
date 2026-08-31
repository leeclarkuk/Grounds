import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lockText = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
const packages = packagesFromLockfile(lockText);
const unique = [
  ...new Map(packages.map((item) => [`${item.name}@${item.version}`, item])).values(),
];
unique.sort((a, b) => a.name.localeCompare(b.name));
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  version: 1,
  metadata: {
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

function packagesFromLockfile(text) {
  const found = [];
  let inPackages = false;
  for (const line of text.split('\n')) {
    if (line === 'packages:') {
      inPackages = true;
      continue;
    }
    if (inPackages && /^[^\s]/.test(line)) {
      break;
    }
    if (!inPackages) {
      continue;
    }
    const match = /^ {2}(?:'|")?(@?[^@'":\s]+)@([^'":\s]+)(?:'|")?:$/.exec(line);
    const name = match?.[1];
    const version = match?.[2];
    if (name && version) {
      found.push({ name, version });
    }
  }
  return found;
}
