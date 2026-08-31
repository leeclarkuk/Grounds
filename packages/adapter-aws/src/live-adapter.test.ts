import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { AWS_SESSION_SECONDS, type JsonObject } from '@grounds/domain';
import { createLivePorts } from './live-adapter.js';
import { assumeRoleSession } from './live-operations.js';
import type { AwsOperations } from './operations.js';
import { DEFAULT_ALLOWED_SCOPE } from './scope.js';

const window = { from: '2026-08-31T00:00:00.000Z', to: '2026-08-31T01:00:00.000Z' };

function stubOps(
  account: string,
  collectorCalls: string[],
): AwsOperations & { getCallerIdentity(): Promise<JsonObject> } {
  const hit = (name: string) => {
    collectorCalls.push(name);
  };
  return {
    describeServices: async () => {
      hit('describeServices');
      return {};
    },
    listTasks: async () => {
      hit('listTasks');
      return { payload: {}, nextToken: null };
    },
    describeTasks: async () => {
      hit('describeTasks');
      return {};
    },
    describeTargetGroups: async () => {
      hit('describeTargetGroups');
      return {};
    },
    describeTargetHealth: async () => {
      hit('describeTargetHealth');
      return { payload: {}, nextToken: null };
    },
    describeAlarms: async () => {
      hit('describeAlarms');
      return { payload: { metricAlarms: [] }, nextToken: null };
    },
    getMetricData: async () => {
      hit('getMetricData');
      return { payload: { metricDataResults: [] }, nextToken: null };
    },
    getCallerIdentity: async () => ({ Account: account }),
  };
}

describe('live AWS bootstrap', () => {
  it('requires an external ID before constructing a session', async () => {
    await expect(
      assumeRoleSession({
        roleArn: 'arn:aws:iam::123456789012:role/grounds',
        externalId: '',
        region: 'eu-west-2',
      }),
    ).rejects.toThrow(/external ID is required/);
  });

  it('pins AssumeRole session duration to 900 seconds', () => {
    const source = readFileSync(new URL('./live-operations.ts', import.meta.url), 'utf8');
    expect(AWS_SESSION_SECONDS).toBe(900);
    expect(source).toContain('DurationSeconds: AWS_SESSION_SECONDS');
    expect(source).not.toContain('DurationSeconds: input.sessionSeconds');
  });

  it('makes zero STS calls for an unapproved service', async () => {
    let bootstrapped = 0;
    const ports = createLivePorts(
      {
        roleArn: 'arn:aws:iam::123456789012:role/grounds',
        externalId: 'ext',
        region: 'eu-west-2',
        allowedScope: DEFAULT_ALLOWED_SCOPE,
      },
      () => {
        bootstrapped += 1;
        throw new Error('should not assume role');
      },
    );
    await expect(
      ports.inventory.collect({
        scope: { ...DEFAULT_ALLOWED_SCOPE, resourceId: 'other-cluster/other' },
        window,
        onPage: async () => undefined,
      }),
    ).rejects.toThrow(/outside the authorised resource scope/);
    expect(bootstrapped).toBe(0);
    expect(ports.bundle.calls).toEqual([]);
  });

  it('persists inaccessible observations when AssumeRole fails', async () => {
    const ports = createLivePorts(
      {
        roleArn: 'arn:aws:iam::123456789012:role/grounds',
        externalId: 'ext',
        region: 'eu-west-2',
        allowedScope: DEFAULT_ALLOWED_SCOPE,
      },
      () => Promise.reject(new Error('denied')),
    );
    const inventory = await ports.inventory.collect({
      scope: DEFAULT_ALLOWED_SCOPE,
      window,
      onPage: async () => undefined,
    });
    expect(inventory.every((item) => item.inaccessible)).toBe(true);
    expect(ports.bundle.calls).toEqual([]);
  });

  it('rejects a caller account that is not the authorised account with no collector calls', async () => {
    const collectorCalls: string[] = [];
    const ports = createLivePorts(
      {
        roleArn: 'arn:aws:iam::123456789012:role/grounds',
        externalId: 'ext',
        region: 'eu-west-2',
        allowedScope: DEFAULT_ALLOWED_SCOPE,
      },
      async () => ({
        accessKeyId: 'ASIAEXAMPLE',
        secretAccessKey: 'secret',
        sessionToken: 'token',
        region: 'eu-west-2',
      }),
      () => stubOps('999999999999', collectorCalls),
    );
    await expect(
      ports.inventory.collect({
        scope: DEFAULT_ALLOWED_SCOPE,
        window,
        onPage: async () => undefined,
      }),
    ).rejects.toThrow(/outside the authorised resource scope/);
    expect(ports.bundle.calls).toEqual(['assumeRole', 'getCallerIdentity']);
    expect(collectorCalls).toEqual([]);
  });
});
