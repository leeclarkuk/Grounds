import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { canonicalJson } from './canonical-json.js';
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

function exampleAccessKeyId(kind: 'AKIA' | 'ASIA'): string {
  return `${kind}${'IOSFODNN7EXAMPLE'}`;
}

describe('redaction and identity', () => {
  it('redacts secrets before digest and they do not appear in stored JSON', () => {
    const secretKey = ['aws', 'secret', 'access', 'key'].join('_');
    const accessKeyId = exampleAccessKeyId('AKIA');
    const redacted = redactUnknown({
      fixtureResult: 'PASS',
      [secretKey]: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      accessKeyId,
    });
    const canonical = canonicalJson(redacted);
    expect(canonical).not.toContain('wJalr');
    expect(canonical).not.toContain(accessKeyId);
    expect(canonical).toContain(REDACTED);
    const digest = payloadDigestOf(redacted);
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain('wJalr');
    expect(digest).not.toContain(accessKeyId);
  });

  it('redacts mid-string and suffix access keys and presigned URL parameters', () => {
    const accessKeyId = exampleAccessKeyId('AKIA');
    const sessionKey = exampleAccessKeyId('ASIA');
    const mid = `request failed for ${accessKeyId} during collect`;
    const suffix = `trace-${accessKeyId}`;
    const url = `https://s3.amazonaws.com/bucket/key?X-Amz-Credential=${sessionKey}&X-Amz-Signature=abcdef&X-Amz-Security-Token=tok&X-Amz-SignedHeaders=host`;
    const redacted = redactUnknown({
      message: mid,
      trailer: suffix,
      url,
    });
    const canonical = canonicalJson(redacted);
    expect(canonical).not.toContain(accessKeyId);
    expect(canonical).not.toContain(sessionKey);
    expect(canonical).not.toContain('X-Amz-Credential');
    expect(canonical).not.toContain('X-Amz-Signature');
    expect(canonical).not.toContain('X-Amz-Security-Token');
    expect(canonical).not.toContain('X-Amz-SignedHeaders');
    expect(canonical).toContain(REDACTED);
    expect(payloadDigestOf(redacted)).not.toContain(accessKeyId);
  });

  it('does not skip the redaction path in the secret scanner', () => {
    const scanner = readFileSync(
      new URL('../../../scripts/scan-secrets.mjs', import.meta.url),
      'utf8',
    );
    expect(scanner).not.toMatch(/includes\(['"]redaction['"]\)/);
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
