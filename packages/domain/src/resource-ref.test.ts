import { describe, expect, it } from 'vitest';

import { parseResourceRef } from './resource-ref.js';
import { OutOfScopeError, assertInScope } from './identity.js';

const inScope = {
  provider: 'aws' as const,
  accountId: '123456789012',
  region: 'eu-west-2',
  service: 'ecs' as const,
  resourceType: 'service' as const,
  resourceId: 'payments-cluster/payments',
};

describe('resource scope', () => {
  it('accepts an allowlisted ECS service', () => {
    expect(parseResourceRef(inScope)).toEqual(inScope);
  });

  it('rejects another account, region, service or wildcard', () => {
    expect(() => parseResourceRef({ ...inScope, accountId: '999999999999' })).not.toThrow();
    expect(() => parseResourceRef({ ...inScope, accountId: 'abc' })).toThrow();
    expect(() => parseResourceRef({ ...inScope, region: 'us-east-1x' })).toThrow();
    expect(() => parseResourceRef({ ...inScope, service: 'lambda' })).toThrow();
    expect(() => parseResourceRef({ ...inScope, resourceId: 'pay*' })).toThrow();
    expect(() => parseResourceRef({ ...inScope, resourceId: 'payments' })).toThrow();
    expect(() => parseResourceRef({ ...inScope, resourceId: 'a/b/c' })).toThrow();
  });

  it('throws OutOfScopeError when the requested resource is not the grant', () => {
    expect(() =>
      assertInScope({ ...inScope, resourceId: 'payments-cluster/other' }, inScope),
    ).toThrow(OutOfScopeError);
    expect(() => assertInScope({ ...inScope, accountId: '000000000000' }, inScope)).toThrow(
      OutOfScopeError,
    );
    expect(() => assertInScope({ ...inScope, region: 'us-east-1' }, inScope)).toThrow(
      OutOfScopeError,
    );
    expect(() => assertInScope(inScope, inScope)).not.toThrow();
  });
});
