import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['apps', 'packages'];
const FORBIDDEN = [
  '@aws-sdk',
  'EnableAlarmActionsCommand',
  'DisableAlarmActionsCommand',
  'CreateServiceCommand',
  'UpdateServiceCommand',
  'DeleteServiceCommand',
  'PutMetricAlarmCommand',
  'aws-cli',
  'child_process.exec',
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'dist' || entry === 'node_modules') {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (full.endsWith('.ts') || full.endsWith('.js') || full.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

describe('no AWS capability in Build 0', () => {
  it('does not include AWS SDK, mutator commands or adapter-aws', () => {
    const files = ROOTS.flatMap((root) => walk(join(process.cwd(), root)));
    expect(files.some((file) => file.includes('adapter-aws'))).toBe(false);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const token of FORBIDDEN) {
        expect(text, `${file} contains ${token}`).not.toContain(token);
      }
    }
  });
});
