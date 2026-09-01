import { describe, expect, it } from 'vitest';

import { GrdFake001 } from './grd-fake-001.js';
import { PAYMENTS_SERVICE } from './fixtures.js';
import type { DetectorInput } from '@grounds/application';
import { FAKE_INVENTORY_KIND } from '@grounds/domain';

function input(overrides: Partial<DetectorInput['observations'][0]> = {}): DetectorInput {
  return {
    run: {
      id: 'run',
      organisationId: 'org_grounds_dev',
      profileVersionId: 'profile',
      authorisationGrantId: 'grant',
      resourceScope: PAYMENTS_SERVICE,
      resourceScopeDigest: 'digest',
      evidenceWindow: { from: '2026-08-31T00:00:00.000Z', to: '2026-08-31T01:00:00.000Z' },
      detectorVersions: { 'GRD-FAKE-001': '1' },
      state: 'evaluating',
      result: null,
      clientIdempotencyKey: 'k',
      requestDigest: 'r',
      runIdentityDigest: 'i',
      cancelRequestedAt: null,
      collectorAttemptCount: 1,
      createdAt: '2026-08-31T00:00:00.000Z',
      startedAt: '2026-08-31T00:00:01.000Z',
      updatedAt: '2026-08-31T00:00:01.000Z',
      terminalAt: null,
    },
    observations: [
      {
        id: 'obs-1',
        runId: 'run',
        organisationId: 'org_grounds_dev',
        kind: FAKE_INVENTORY_KIND,
        resource: PAYMENTS_SERVICE,
        collectedAt: '2026-08-31T00:00:01.000Z',
        window: { from: '2026-08-31T00:00:00.000Z', to: '2026-08-31T01:00:00.000Z' },
        sourceAdapter: 'fixture',
        sourceOperation: 'fake.DescribeInventory',
        requestDigest: 'req',
        freshness: 'FRESH',
        payload: { fixtureResult: 'PASS' },
        payloadDigest: 'p',
        redactionVersion: 'redaction.v1',
        truncated: false,
        inaccessible: false,
        contentIdentity: 'c',
        ...overrides,
      },
    ],
    detectorParameters: { fixture: true },
  };
}

describe('GRD-FAKE-001', () => {
  const detector = new GrdFake001();

  it('returns PASS, FAIL and UNKNOWN with citations', () => {
    expect(detector.evaluate(input()).result).toBe('PASS');
    expect(detector.evaluate(input({ payload: { fixtureResult: 'FAIL' } })).result).toBe('FAIL');
    expect(detector.evaluate(input({ inaccessible: true })).result).toBe('UNKNOWN');
    expect(detector.evaluate(input({ truncated: true })).result).toBe('UNKNOWN');
    expect(detector.evaluate(input({ freshness: 'STALE' })).result).toBe('UNKNOWN');
    expect(detector.evaluate(input()).observationIds).toEqual(['obs-1']);
  });
});
