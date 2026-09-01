import { OutOfScopeError } from '@grounds/domain';
import { describe, expect, it } from 'vitest';

import { DEFAULT_ALLOWED_SCOPE, assertServiceInScope, assertTargetGroupInScope } from './scope.js';

const IN_SCOPE_SERVICE = {
  serviceArn: 'arn:aws:ecs:eu-west-2:123456789012:service/payments-cluster/payments',
  serviceName: 'payments',
  clusterArn: 'arn:aws:ecs:eu-west-2:123456789012:cluster/payments-cluster',
};

const IN_SCOPE_TARGET_GROUP =
  'arn:aws:elasticloadbalancing:eu-west-2:123456789012:targetgroup/payments/abc123';

describe('post-response scope matching', () => {
  it('accepts a service with parsable in-scope ARNs', () => {
    expect(() => assertServiceInScope(DEFAULT_ALLOWED_SCOPE, IN_SCOPE_SERVICE)).not.toThrow();
  });

  it('accepts PascalCase AWS members', () => {
    expect(() =>
      assertServiceInScope(DEFAULT_ALLOWED_SCOPE, {
        ServiceArn: IN_SCOPE_SERVICE.serviceArn,
        ServiceName: IN_SCOPE_SERVICE.serviceName,
        ClusterArn: IN_SCOPE_SERVICE.clusterArn,
      }),
    ).not.toThrow();
  });

  it('rejects a service with no serviceArn', () => {
    expect(() =>
      assertServiceInScope(DEFAULT_ALLOWED_SCOPE, {
        serviceName: 'payments',
        clusterArn: IN_SCOPE_SERVICE.clusterArn,
      }),
    ).toThrow(OutOfScopeError);
  });

  it('rejects a service with no clusterArn', () => {
    expect(() =>
      assertServiceInScope(DEFAULT_ALLOWED_SCOPE, {
        serviceArn: IN_SCOPE_SERVICE.serviceArn,
        serviceName: 'payments',
      }),
    ).toThrow(OutOfScopeError);
  });

  it('rejects a service with an unparsable serviceArn', () => {
    expect(() =>
      assertServiceInScope(DEFAULT_ALLOWED_SCOPE, {
        ...IN_SCOPE_SERVICE,
        serviceArn: 'not-an-arn',
      }),
    ).toThrow(OutOfScopeError);
  });

  it('rejects a service with an unparsable clusterArn', () => {
    expect(() =>
      assertServiceInScope(DEFAULT_ALLOWED_SCOPE, {
        ...IN_SCOPE_SERVICE,
        clusterArn: 'cluster/payments-cluster',
      }),
    ).toThrow(OutOfScopeError);
  });

  it('rejects a missing target group ARN', () => {
    expect(() => assertTargetGroupInScope(DEFAULT_ALLOWED_SCOPE, '')).toThrow(OutOfScopeError);
  });

  it('rejects an unparsable target group ARN', () => {
    expect(() => assertTargetGroupInScope(DEFAULT_ALLOWED_SCOPE, 'targetgroup/payments')).toThrow(
      OutOfScopeError,
    );
  });

  it('rejects a cross-account target group ARN', () => {
    expect(() =>
      assertTargetGroupInScope(
        DEFAULT_ALLOWED_SCOPE,
        'arn:aws:elasticloadbalancing:eu-west-2:999999999999:targetgroup/payments/abc123',
      ),
    ).toThrow(OutOfScopeError);
  });

  it('accepts an in-scope target group ARN', () => {
    expect(() =>
      assertTargetGroupInScope(DEFAULT_ALLOWED_SCOPE, IN_SCOPE_TARGET_GROUP),
    ).not.toThrow();
  });
});
