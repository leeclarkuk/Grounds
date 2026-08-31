import { randomUUID } from 'node:crypto';

import type { OrchestrationTx } from '@grounds/application';
import {
  FAKE_DETECTOR_ID,
  FAKE_DETECTOR_VERSION,
  resourceScopeDigest,
  sha256Canonical,
  type ResourceRef,
} from '@grounds/domain';

export const DEV_ORG = 'org_grounds_dev';
export const OTHER_ORG = 'org_grounds_other';
export const DEV_ACTOR = 'dev-actor';

export const PAYMENTS_SERVICE: ResourceRef = {
  provider: 'aws',
  accountId: '123456789012',
  region: 'eu-west-2',
  service: 'ecs',
  resourceType: 'service',
  resourceId: 'payments',
};

export async function seedProfileAndGrant(
  tx: OrchestrationTx,
  options?: {
    readonly organisationId?: string;
    readonly resource?: ResourceRef;
    readonly expiresAt?: string;
    readonly freshnessMaxAgeSeconds?: number;
    readonly grantIdempotencyKey?: string;
  },
) {
  const organisationId = options?.organisationId ?? DEV_ORG;
  const resource = options?.resource ?? PAYMENTS_SERVICE;
  const profileId = randomUUID();
  const grantId = randomUUID();
  const now = new Date();
  const windowFrom = new Date(now.getTime() - 3_600_000).toISOString();
  const windowTo = new Date(now.getTime() + 3_600_000).toISOString();
  const detectorVersions = { [FAKE_DETECTOR_ID]: FAKE_DETECTOR_VERSION };
  const freshnessPolicy = { freshnessMaxAgeSeconds: options?.freshnessMaxAgeSeconds ?? 3600 };
  const detectorParameters = { fixture: true };
  const contentDigest = sha256Canonical({
    organisationId,
    profileId,
    version: 1,
    scope: resource,
    detectorVersions,
    freshnessPolicy,
    detectorParameters,
  });
  const profile = await tx.insertProfile({
    id: profileId,
    organisationId,
    profileId,
    version: 1,
    scope: resource,
    detectorVersions,
    freshnessPolicy,
    detectorParameters,
    contentDigest,
  });
  const grant = await tx.insertGrant({
    id: grantId,
    organisationId,
    actorId: DEV_ACTOR,
    profileVersionId: profile.id,
    resourceScope: resource,
    resourceScopeDigest: resourceScopeDigest(resource),
    evidenceWindow: { from: windowFrom, to: windowTo },
    detectorVersions,
    grantedAt: now.toISOString(),
    expiresAt: options?.expiresAt ?? new Date(now.getTime() + 3_600_000).toISOString(),
    consumedAt: null,
    clientIdempotencyKey: options?.grantIdempotencyKey ?? randomUUID(),
    requestDigest: sha256Canonical({ grant: 'create', resource }),
  });
  return { profile, grant };
}
