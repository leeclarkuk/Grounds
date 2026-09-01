import { sha256Canonical } from '@grounds/domain';
import { IdempotencyConflictError, NotFoundError } from './errors.js';
import { cancelResponseBody } from './http-write.js';
import type { OrchestrationStore, OrchestrationTx } from './store.js';
import type { AssuranceRun } from './types.js';

export type CancelRunCommand = {
  readonly runId: string;
  readonly http?: {
    readonly organisationId: string;
    readonly actorId: string;
    readonly clientIdempotencyKey: string;
  };
};

export class CancelRun {
  public constructor(private readonly store: OrchestrationStore) {}

  public async execute(runId: string, http?: CancelRunCommand['http']): Promise<AssuranceRun> {
    const current = await this.store.getRun(runId);
    if (!current) {
      throw new NotFoundError('run not found');
    }
    if (http && current.organisationId !== http.organisationId) {
      throw new NotFoundError('run not found');
    }
    const requestDigest = sha256Canonical({ runId });
    if (http) {
      const existing = await this.store.getHttpIdempotency({
        organisationId: http.organisationId,
        actorId: http.actorId,
        method: 'POST',
        route: `/v1/runs/${runId}/cancel`,
        clientIdempotencyKey: http.clientIdempotencyKey,
      });
      if (existing) {
        if (existing.requestDigest !== requestDigest) {
          throw new IdempotencyConflictError();
        }
        const replay = await this.store.getRun(runId);
        if (!replay) {
          throw new NotFoundError('run not found');
        }
        return replay;
      }
    }
    const recordHttp = async (tx: OrchestrationTx, run: AssuranceRun): Promise<void> => {
      if (!http) {
        return;
      }
      await tx.putHttpIdempotency({
        organisationId: http.organisationId,
        actorId: http.actorId,
        record: {
          method: 'POST',
          route: `/v1/runs/${runId}/cancel`,
          clientIdempotencyKey: http.clientIdempotencyKey,
          requestDigest,
          responseStatus: 200,
          responseBody: cancelResponseBody(run),
        },
      });
    };
    if (
      current.state === 'evaluating' ||
      current.state === 'healthy' ||
      current.state === 'findings' ||
      current.state === 'failed' ||
      current.state === 'cancelled'
    ) {
      await this.store.withTransaction(async (tx) => {
        await tx.lockRun(runId);
        await tx.recordCancelRequested(runId);
        await tx.appendEvent({
          aggregateType: 'assurance_run',
          aggregateId: runId,
          type: 'cancel_requested',
          operationId: `cancel-requested:${runId}`,
          payload: { state: current.state },
          actorId: http?.actorId ?? null,
        });
        const updated = await tx.lockRun(runId);
        await recordHttp(tx, updated);
      });
      const updated = await this.store.getRun(runId);
      if (!updated) {
        throw new NotFoundError('run not found');
      }
      return updated;
    }
    return this.store
      .withTransaction(async (tx) => {
        const cancelled = await tx.cancelCollect(runId);
        await tx.appendEvent({
          aggregateType: 'assurance_run',
          aggregateId: runId,
          type: 'run_cancelled',
          operationId: `cancel:${runId}`,
          payload: { previousState: current.state },
          actorId: http?.actorId ?? null,
        });
        await tx.appendEvent({
          aggregateType: 'assurance_run',
          aggregateId: runId,
          type: 'step_cancelled',
          operationId: `cancel:${runId}:collect`,
          payload: { stepType: 'collect' },
          actorId: http?.actorId ?? null,
        });
        await recordHttp(tx, cancelled);
        return cancelled;
      })
      .catch(async (error: unknown) => {
        const replay = await this.store.getRun(runId);
        if (replay?.state === 'cancelled') {
          if (http) {
            await this.store.withTransaction(async (tx) => {
              await recordHttp(tx, replay);
            });
          }
          return replay;
        }
        throw error;
      });
  }
}
