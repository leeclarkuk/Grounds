import { randomUUID } from 'node:crypto';

import {
  GRANT_TTL_SECONDS,
  MAX_EVIDENCE_WINDOW_SECONDS,
  assertDetectorPinSet,
  assertHistoricalEvidenceWindow,
  assertInScope,
  parseEvidenceWindow,
  parseResourceRef,
  resourceScopeDigest,
  sha256Canonical,
  splitEcsResourceId,
  type JsonObject,
  type ResourceRef,
} from '@grounds/domain';
import {
  IdempotencyConflictError,
  NotFoundError,
  UniqueConstraintError,
  ValidationError,
} from './errors.js';
import { authorisationResponseBody, storedHttpResponse } from './http-write.js';
import type { IdentityProvider } from './ports.js';
import type { HttpIdempotencyRecord, OrchestrationStore } from './store.js';
import type { Grant } from './types.js';

export type CreateAuthorisationCommand = {
  readonly profileVersionId: string;
  readonly resourceScope: ResourceRef;
  readonly evidenceWindow: { readonly from: string; readonly to: string };
  readonly clientIdempotencyKey: string;
};

export type CreateAuthorisationResult = {
  readonly grant: Grant;
  readonly replayed: boolean;
  readonly status: number;
  readonly body: JsonObject;
};

export class CreateAuthorisation {
  public constructor(
    private readonly store: OrchestrationStore,
    private readonly identity: IdentityProvider,
  ) {}

  public async execute(command: CreateAuthorisationCommand): Promise<CreateAuthorisationResult> {
    const actorId = this.identity.actorId();
    const organisationId = this.identity.organisationId();
    const resourceScope = parseResourceRef(command.resourceScope);
    splitEcsResourceId(resourceScope.resourceId);
    const evidenceWindow = parseEvidenceWindow(command.evidenceWindow);
    const requestDigest = sha256Canonical({
      profileVersionId: command.profileVersionId,
      resourceScope,
      evidenceWindow,
    });
    const existing = await this.store.getHttpIdempotency({
      organisationId,
      actorId,
      method: 'POST',
      route: '/v1/authorisations',
      clientIdempotencyKey: command.clientIdempotencyKey,
    });
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        throw new IdempotencyConflictError();
      }
      return replayAuthorisation(existing, await grantFromStored(this.store, existing));
    }
    const now = await this.store.now();
    try {
      assertHistoricalEvidenceWindow(evidenceWindow, now, MAX_EVIDENCE_WINDOW_SECONDS);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'invalid evidence window');
    }
    const profile = await this.store.getProfile(command.profileVersionId);
    if (!profile || profile.organisationId !== organisationId) {
      throw new NotFoundError('profile version not found');
    }
    try {
      assertInScope(resourceScope, profile.scope);
      assertDetectorPinSet(profile.detectorVersions);
    } catch (error) {
      throw new ValidationError(
        error instanceof Error ? error.message : 'authorisation scope is invalid',
      );
    }
    try {
      const grant = await this.store.withTransaction(async (tx) => {
        const inserted = await tx.insertTimedGrant({
          id: randomUUID(),
          organisationId,
          actorId,
          profileVersionId: profile.id,
          resourceScope,
          resourceScopeDigest: resourceScopeDigest(resourceScope),
          evidenceWindow,
          detectorVersions: profile.detectorVersions,
          clientIdempotencyKey: command.clientIdempotencyKey,
          requestDigest,
        });
        await tx.appendEvent({
          aggregateType: 'authorisation_grant',
          aggregateId: inserted.id,
          type: 'grant_created',
          operationId: `authorise:${inserted.id}`,
          payload: { grantId: inserted.id, ttlSeconds: GRANT_TTL_SECONDS },
          actorId,
        });
        const body = authorisationResponseBody(inserted);
        const record: HttpIdempotencyRecord = {
          method: 'POST',
          route: '/v1/authorisations',
          clientIdempotencyKey: command.clientIdempotencyKey,
          requestDigest,
          responseStatus: 201,
          responseBody: body,
        };
        await tx.putHttpIdempotency({ organisationId, actorId, record });
        return inserted;
      });
      const body = authorisationResponseBody(grant);
      return { grant, replayed: false, status: 201, body };
    } catch (error) {
      if (error instanceof UniqueConstraintError || error instanceof IdempotencyConflictError) {
        const replay = await this.store.getHttpIdempotency({
          organisationId,
          actorId,
          method: 'POST',
          route: '/v1/authorisations',
          clientIdempotencyKey: command.clientIdempotencyKey,
        });
        if (replay && replay.requestDigest === requestDigest) {
          return replayAuthorisation(replay, await grantFromStored(this.store, replay));
        }
        throw new IdempotencyConflictError();
      }
      throw error;
    }
  }
}

function grantIdFromBody(record: HttpIdempotencyRecord): string | undefined {
  const stored = storedHttpResponse(record);
  const id = stored.body['id'];
  return typeof id === 'string' ? id : undefined;
}

async function grantFromStored(
  store: OrchestrationStore,
  record: HttpIdempotencyRecord,
): Promise<Grant> {
  const grantId = grantIdFromBody(record);
  const grant = grantId ? await store.getGrant(grantId) : undefined;
  if (!grant) {
    throw new NotFoundError('authorisation grant not found');
  }
  return grant;
}

function replayAuthorisation(
  record: HttpIdempotencyRecord,
  grant: Grant,
): CreateAuthorisationResult {
  const stored = storedHttpResponse(record);
  return { grant, replayed: true, status: stored.status, body: stored.body };
}
