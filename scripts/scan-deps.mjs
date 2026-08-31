import { spawnSync } from 'node:child_process';

const result = spawnSync('pnpm', ['audit', '--audit-level=high'], {
  encoding: 'utf8',
  maxBuffer: 20_000_000,
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.status !== 0) {
  process.exit(result.status === null ? 1 : result.status);
}
process.stdout.write('dependency audit clean at high and above\n');
