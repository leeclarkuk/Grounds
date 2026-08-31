import { randomUUID } from 'node:crypto';

import {
  assertDetectorPinSet,
  parseResourceRef,
  resourceScopeDigest,
  runIdentityDigest,
  windowToJson,
} from '@grounds/domain';
import { runWriteResponseBody } from './http-write.js';
import {
  GrantNotConsumableError,
  IdempotencyConflictError,
  UniqueConstraintError,
} from './errors.js';
import type { OrchestrationStore } from './store.js';
import type { AssuranceRun } from './types.js';

export type EnqueueCommand = {
  readonly grantId: string;
  readonly clientIdempotencyKey: string;
  readonly requestDigest: string;
  readonly http?: {
    readonly organisationId: string;
    readonly actorId: string;
    readonly method: string;
    readonly route: string;
  };
};

export class EnqueueRun {
  public constructor(private readonly store: OrchestrationStore) {}

  public async execute(command: EnqueueCommand): Promise<AssuranceRun> {
    const existing = await this.store.getRunByClientKey(command.clientIdempotencyKey);
    if (existing) {
      if (existing.requestDigest !== command.requestDigest) {
        throw new IdempotencyConflictError();
      }
      if (command.http) {
        await this.store.withTransaction(async (tx) => {
          await tx.putHttpIdempotency({
            organisationId: command.http?.organisationId ?? existing.organisationId,
            actorId: command.http?.actorId ?? '',
            record: {
              method: command.http?.method ?? 'POST',
              route: command.http?.route ?? '/v1/runs',
              clientIdempotencyKey: command.clientIdempotencyKey,
              requestDigest: command.requestDigest,
              responseStatus: 201,
              responseBody: runWriteResponseBody(existing),
            },
          });
        });
      }
      return existing;
    }
    try {
      return await this.store.withTransaction(async (tx) => {
        const grant = await tx.consumeGrant(command.grantId);
        const resourceScope = parseResourceRef(grant.resourceScope);
        const detectorVersions = grant.detectorVersions;
        try {
          assertDetectorPinSet(detectorVersions);
        } catch {
          throw new GrantNotConsumableError('grant detector pin set is invalid');
        }
        const runId = randomUUID();
        const runIdentity = runIdentityDigest({
          organisationId: grant.organisationId,
          profileVersionId: grant.profileVersionId,
          resourceScope,
          evidenceWindow: grant.evidenceWindow,
          triggerIdentity: { type: 'manual_grant', grantId: grant.id },
        });
        const run: AssuranceRun = {
          id: runId,
          organisationId: grant.organisationId,
          profileVersionId: grant.profileVersionId,
          authorisationGrantId: grant.id,
          resourceScope,
          resourceScopeDigest: resourceScopeDigest(resourceScope),
          evidenceWindow: grant.evidenceWindow,
          detectorVersions,
          state: 'queued',
          result: null,
          clientIdempotencyKey: command.clientIdempotencyKey,
          requestDigest: command.requestDigest,
          runIdentityDigest: runIdentity,
          cancelRequestedAt: null,
          collectorAttemptCount: 0,
          createdAt: '',
          startedAt: null,
          updatedAt: '',
          terminalAt: null,
        };
        const inserted = await tx.insertRun(run);
        await tx.insertSteps(inserted.id, randomUUID(), randomUUID());
        await tx.lockRun(inserted.id);
        await tx.appendEvent({
          aggregateType: 'authorisation_grant',
          aggregateId: grant.id,
          type: 'grant_consumed',
          operationId: `enqueue:${inserted.id}`,
          payload: { runId: inserted.id, grantId: grant.id },
          actorId: grant.actorId,
        });
        await tx.appendEvent({
          aggregateType: 'assurance_run',
          aggregateId: inserted.id,
          type: 'run_queued',
          operationId: `enqueue:${inserted.id}`,
          payload: { runId: inserted.id, window: windowToJson(grant.evidenceWindow) },
          actorId: grant.actorId,
        });
        await tx.appendEvent({
          aggregateType: 'assurance_run',
          aggregateId: inserted.id,
          type: 'step_created',
          operationId: `enqueue:${inserted.id}:collect`,
          payload: { stepType: 'collect' },
          actorId: grant.actorId,
        });
        await tx.appendEvent({
          aggregateType: 'assurance_run',
          aggregateId: inserted.id,
          type: 'step_created',
          operationId: `enqueue:${inserted.id}:evaluate`,
          payload: { stepType: 'evaluate' },
          actorId: grant.actorId,
        });
        if (command.http) {
          await tx.putHttpIdempotency({
            organisationId: command.http.organisationId,
            actorId: command.http.actorId,
            record: {
              method: command.http.method,
              route: command.http.route,
              clientIdempotencyKey: command.clientIdempotencyKey,
              requestDigest: command.requestDigest,
              responseStatus: 201,
              responseBody: runWriteResponseBody(inserted),
            },
          });
        }
        return inserted;
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError || error instanceof GrantNotConsumableError) {
        const replay = await this.store.getRunByClientKey(command.clientIdempotencyKey);
        if (replay && replay.requestDigest === command.requestDigest) {
          return replay;
        }
        if (error instanceof UniqueConstraintError) {
          throw new IdempotencyConflictError();
        }
      }
      throw error;
    }
  }
}
