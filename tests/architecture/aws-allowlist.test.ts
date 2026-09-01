import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ALLOWED_AWS_COMMANDS } from '../../packages/adapter-aws/src/allowlist.js';

const MUTATOR_FAMILIES =
  /(Create|Put|Update|Delete|Register|Deregister|Run|Start|Stop|Terminate|Modify|Set|Tag)[A-Za-z0-9]*Command/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'dist' || entry === 'node_modules' || entry === '.next') {
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

describe('AWS command allowlist', () => {
  it('allows only the exact Build 1 command set in adapter-aws', () => {
    const files = walk(join(process.cwd(), 'packages/adapter-aws'));
    const commands = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/import\s+\*\s+as\s+\w+Command/);
      expect(text).not.toContain("export * from '@aws-sdk/");
      expect(text).not.toContain('export * from "@aws-sdk/');
      expect(text).not.toMatch(/import\((\s|'|")@aws-sdk\//);
      for (const match of text.matchAll(/\b([A-Za-z][A-Za-z0-9]*Command)\b/g)) {
        const name = match[1];
        if (name && name !== 'AllowedAwsCommand') {
          commands.add(name);
        }
      }
    }
    expect([...commands].sort()).toEqual([...ALLOWED_AWS_COMMANDS].sort());
    expect(commands.has('EnableAlarmActionsCommand')).toBe(false);
    expect(commands.has('DisableAlarmActionsCommand')).toBe(false);
  });

  it('rejects mutator command families in adapter-aws source', () => {
    const files = walk(join(process.cwd(), 'packages/adapter-aws/src'));
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const extra = [...text.matchAll(MUTATOR_FAMILIES)].map((item) => item[0]);
      expect(extra, file).toEqual([]);
    }
  });

  it('keeps AWS SDK and adapter-aws out of api, web, domain, application and detectors', () => {
    const roots = [
      'apps/api',
      'apps/web',
      'packages/domain',
      'packages/application',
      'packages/detectors-ecs',
      'packages/persistence-postgres',
      'packages/observability',
    ];
    for (const root of roots) {
      const dir = join(process.cwd(), root);
      try {
        statSync(dir);
      } catch {
        continue;
      }
      for (const file of walk(dir)) {
        if (file.endsWith('package.json')) {
          continue;
        }
        const text = readFileSync(file, 'utf8');
        expect(text, file).not.toContain('@aws-sdk');
        expect(text, file).not.toContain('@grounds/adapter-aws');
        expect(text, file).not.toContain('EnableAlarmActionsCommand');
      }
    }
  });
});
