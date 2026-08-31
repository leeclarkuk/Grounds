import { randomUUID } from 'node:crypto';

import {
  FAKE_DETECTOR_ID,
  FAKE_DETECTOR_VERSION,
  parseResourceRef,
  resourceScopeDigest,
  runIdentityDigest,
  windowToJson,
} from '@grounds/domain';
import {
  GrantNotConsumableError,
  IdempotencyConflictError,
  UniqueConstraintError,
} from './errors.js';
import type { OrchestrationStore } from './store.js';
import type { AssuranceRun, Grant } from './types.js';

export type EnqueueCommand = {
  readonly grantId: string;
  readonly clientIdempotencyKey: string;
  readonly requestDigest: string;
};

export class EnqueueRun {
  public constructor(private readonly store: OrchestrationStore) {}

  public async execute(command: EnqueueCommand): Promise<AssuranceRun> {
    const existing = await this.store.getRunByClientKey(command.clientIdempotencyKey);
    if (existing) {
      if (existing.requestDigest !== command.requestDigest) {
        throw new IdempotencyConflictError();
      }
      return existing;
    }
    try {
      return await this.store.withTransaction(async (tx) => {
        let grant: Grant;
        try {
          grant = await tx.consumeGrant(command.grantId);
        } catch (error) {
          if (error instanceof GrantNotConsumableError) {
            throw error;
          }
          throw error;
        }
        const resourceScope = parseResourceRef(grant.resourceScope);
        const detectorVersions = grant.detectorVersions;
        if (detectorVersions[FAKE_DETECTOR_ID] !== FAKE_DETECTOR_VERSION) {
          throw new GrantNotConsumableError('grant is not pinned to GRD-FAKE-001');
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
        return inserted;
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        const replay = await this.store.getRunByClientKey(command.clientIdempotencyKey);
        if (replay && replay.requestDigest === command.requestDigest) {
          return replay;
        }
        throw new IdempotencyConflictError();
      }
      throw error;
    }
  }
}
