import { describe, expect, it } from 'vitest';

import { contentIdentity, runIdentityDigest } from './identity.js';
import { boundPayload, payloadDigestOf, REDACTED, redactUnknown } from './redaction.js';
import type { ResourceRef } from './resource-ref.js';

const resource: ResourceRef = {
  provider: 'aws',
  accountId: '123456789012',
  region: 'eu-west-2',
  service: 'ecs',
  resourceType: 'service',
  resourceId: 'payments',
};

const window = { from: '2026-08-31T00:00:00.000Z', to: '2026-08-31T01:00:00.000Z' };

describe('redaction and identity', () => {
  it('redacts secrets before digest and they do not appear in stored JSON', () => {
    const redacted = redactUnknown({
      fixtureResult: 'PASS',
      aws_secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    });
    const canonical = JSON.stringify(redacted);
    expect(canonical).not.toContain('wJalr');
    expect(canonical).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(canonical).toContain(REDACTED);
    const digest = payloadDigestOf(redacted);
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain('wJalr');
  });

  it('organisation id participates in content identity', () => {
    const shared = {
      kind: 'fake.inventory',
      resource,
      window,
      operation: 'fake.DescribeInventory',
      payloadDigest: 'abc',
      redactionVersion: 'redaction.v1',
    };
    const a = contentIdentity({ ...shared, organisationId: 'org-a' });
    const b = contentIdentity({ ...shared, organisationId: 'org-b' });
    expect(a).not.toBe(b);
  });

  it('run identity digest changes when the grant identity changes', () => {
    const base = {
      organisationId: 'org-a',
      profileVersionId: '11111111-1111-1111-1111-111111111111',
      resourceScope: resource,
      evidenceWindow: window,
    };
    const first = runIdentityDigest({
      ...base,
      triggerIdentity: { type: 'manual_grant', grantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    });
    const second = runIdentityDigest({
      ...base,
      triggerIdentity: { type: 'manual_grant', grantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
    });
    expect(first).not.toBe(second);
  });

  it('replaces oversize payloads with a bounded envelope and keeps the full digest', () => {
    const huge = { blob: 'x'.repeat(1_048_576) };
    const bounded = boundPayload(huge);
    expect(bounded.truncated).toBe(true);
    expect(bounded.persisted).toMatchObject({
      truncated: true,
      originalByteLength: expect.any(Number),
    });
    expect(bounded.payloadDigest).toBe(payloadDigestOf(huge));
  });
});
