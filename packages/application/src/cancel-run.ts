import type { OrchestrationStore } from './store.js';
import type { AssuranceRun } from './types.js';

export class CancelRun {
  public constructor(private readonly store: OrchestrationStore) {}

  public async execute(runId: string): Promise<AssuranceRun> {
    const current = await this.store.getRun(runId);
    if (!current) {
      throw new Error('run not found');
    }
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
          actorId: null,
        });
      });
      const updated = await this.store.getRun(runId);
      if (!updated) {
        throw new Error('run not found');
      }
      return updated;
    }
    return this.store.withTransaction(async (tx) => {
      const cancelled = await tx.cancelCollect(runId);
      await tx.appendEvent({
        aggregateType: 'assurance_run',
        aggregateId: runId,
        type: 'run_cancelled',
        operationId: `cancel:${runId}`,
        payload: { previousState: current.state },
        actorId: null,
      });
      await tx.appendEvent({
        aggregateType: 'assurance_run',
        aggregateId: runId,
        type: 'step_cancelled',
        operationId: `cancel:${runId}:collect`,
        payload: { stepType: 'collect' },
        actorId: null,
      });
      return cancelled;
    });
  }
}
