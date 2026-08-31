import { describe, expect, it } from 'vitest';

import { OutOfScopeError } from '@grounds/domain';
import { createLivePorts } from './live-adapter.js';
import { assumeRoleSession } from './live-operations.js';
import { DEFAULT_ALLOWED_SCOPE, assertCallerAccount } from './scope.js';

const window = { from: '2026-08-31T00:00:00.000Z', to: '2026-08-31T01:00:00.000Z' };

describe('live AWS bootstrap', () => {
  it('requires an external ID before constructing a session', async () => {
    await expect(
      assumeRoleSession({
        roleArn: 'arn:aws:iam::123456789012:role/grounds',
        externalId: '',
        region: 'eu-west-2',
        sessionSeconds: 900,
      }),
    ).rejects.toThrow(/external ID is required/);
  });

  it('makes zero STS calls for an unapproved service', async () => {
    let bootstrapped = 0;
    const ports = createLivePorts(
      {
        roleArn: 'arn:aws:iam::123456789012:role/grounds',
        externalId: 'ext',
        region: 'eu-west-2',
        allowedScope: DEFAULT_ALLOWED_SCOPE,
        sessionSeconds: 900,
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
    ).rejects.toBeInstanceOf(OutOfScopeError);
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
        sessionSeconds: 900,
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

  it('rejects a caller account that is not the authorised account', () => {
    expect(() => assertCallerAccount('999999999999', DEFAULT_ALLOWED_SCOPE)).toThrow(
      OutOfScopeError,
    );
    expect(() =>
      assertCallerAccount(DEFAULT_ALLOWED_SCOPE.accountId, DEFAULT_ALLOWED_SCOPE),
    ).not.toThrow();
  });
});
