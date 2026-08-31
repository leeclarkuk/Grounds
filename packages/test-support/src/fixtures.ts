import { randomUUID } from 'node:crypto';

import type { OrchestrationTx } from '@grounds/application';
import {
  DEFAULT_ECS_DETECTOR_PARAMETERS,
  FAKE_DETECTOR_ID,
  FAKE_DETECTOR_VERSION,
  ecsDetectorVersions,
  resourceScopeDigest,
  sha256Canonical,
  type JsonObject,
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
  resourceId: 'payments-cluster/payments',
};

export async function seedProfileAndGrant(
  tx: OrchestrationTx,
  options?: {
    readonly organisationId?: string;
    readonly resource?: ResourceRef;
    readonly expiresAt?: string;
    readonly freshnessMaxAgeSeconds?: number;
    readonly grantIdempotencyKey?: string;
    readonly grantResource?: ResourceRef;
  },
) {
  const organisationId = options?.organisationId ?? DEV_ORG;
  const resource = options?.resource ?? PAYMENTS_SERVICE;
  const grantResource = options?.grantResource ?? resource;
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
    resourceScope: grantResource,
    resourceScopeDigest: resourceScopeDigest(grantResource),
    evidenceWindow: { from: windowFrom, to: windowTo },
    detectorVersions,
    grantedAt: now.toISOString(),
    expiresAt: options?.expiresAt ?? new Date(now.getTime() + 3_600_000).toISOString(),
    consumedAt: null,
    clientIdempotencyKey: options?.grantIdempotencyKey ?? randomUUID(),
    requestDigest: sha256Canonical({ grant: 'create', resource: grantResource }),
  });
  return { profile, grant };
}

export async function seedEcsProfileAndGrant(
  tx: OrchestrationTx,
  options?: {
    readonly organisationId?: string;
    readonly resource?: ResourceRef;
    readonly grantIdempotencyKey?: string;
  },
) {
  const organisationId = options?.organisationId ?? DEV_ORG;
  const resource = options?.resource ?? PAYMENTS_SERVICE;
  const profileId = randomUUID();
  const now = new Date();
  const windowFrom = new Date(now.getTime() - 3_600_000).toISOString();
  const windowTo = now.toISOString();
  const detectorVersions = ecsDetectorVersions();
  const freshnessPolicy = { freshnessMaxAgeSeconds: 3600 };
  const detectorParameters = JSON.parse(
    JSON.stringify(DEFAULT_ECS_DETECTOR_PARAMETERS),
  ) as JsonObject;
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
    profileId: 'ecs-payments',
    version: 1,
    scope: resource,
    detectorVersions,
    freshnessPolicy,
    detectorParameters,
    contentDigest,
  });
  const grant = await tx.insertGrant({
    id: randomUUID(),
    organisationId,
    actorId: DEV_ACTOR,
    profileVersionId: profile.id,
    resourceScope: resource,
    resourceScopeDigest: resourceScopeDigest(resource),
    evidenceWindow: { from: windowFrom, to: windowTo },
    detectorVersions,
    grantedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    consumedAt: null,
    clientIdempotencyKey: options?.grantIdempotencyKey ?? randomUUID(),
    requestDigest: sha256Canonical({ grant: 'create', resource }),
  });
  return { profile, grant };
}
