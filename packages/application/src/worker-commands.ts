import { errorMessageFor, MAX_STEP_ATTEMPTS, type ErrorClass } from '@grounds/domain';
import { FenceLostError } from './errors.js';
import type { OrchestrationStore } from './store.js';
import type { ClaimedWork } from './types.js';

export class ClaimWork {
  public constructor(private readonly store: OrchestrationStore) {}

  public async execute(
    workerId: string,
    leaseTtlSeconds: number,
  ): Promise<ClaimedWork | undefined> {
    return this.store.withTransaction(async (tx) => tx.claimWork(workerId, leaseTtlSeconds));
  }
}

export class HeartbeatLease {
  public constructor(private readonly store: OrchestrationStore) {}

  public async execute(
    stepId: string,
    workerId: string,
    leaseEpoch: number,
    leaseTtlSeconds: number,
  ): Promise<boolean> {
    return this.store.withTransaction(async (tx) =>
      tx.heartbeat(stepId, workerId, leaseEpoch, leaseTtlSeconds),
    );
  }
}

export class FailClaimedStep {
  public constructor(private readonly store: OrchestrationStore) {}

  public async execute(
    claimed: ClaimedWork,
    workerId: string,
    errorClass: ErrorClass,
  ): Promise<void> {
    try {
      await this.store.withTransaction(async (tx) => {
        const fence = await tx.requireFence({
          runId: claimed.run.id,
          stepId: claimed.step.id,
          workerId,
          leaseEpoch: claimed.step.leaseEpoch,
          expectedRunStates: claimed.step.stepType === 'collect' ? ['collecting'] : ['evaluating'],
        });
        await tx.failStep(fence, workerId, claimed.step.leaseEpoch, errorClass);
        await tx.appendEvent({
          aggregateType: 'assurance_run',
          aggregateId: claimed.run.id,
          type: 'step_failed',
          operationId: `${claimed.step.stepType}:failed:${claimed.run.id}`,
          payload: { errorClass, errorMessage: errorMessageFor(errorClass) },
          actorId: null,
        });
      });
    } catch (error) {
      if (error instanceof FenceLostError) {
        return;
      }
      throw error;
    }
  }
}

export class RetryClaimedStep {
  public constructor(private readonly store: OrchestrationStore) {}

  public async execute(claimed: ClaimedWork, workerId: string): Promise<void> {
    if (claimed.step.attempt >= MAX_STEP_ATTEMPTS) {
      await new FailClaimedStep(this.store).execute(claimed, workerId, 'attempts_exhausted');
      return;
    }
    try {
      await this.store.withTransaction(async (tx) => {
        const fence = await tx.requireFence({
          runId: claimed.run.id,
          stepId: claimed.step.id,
          workerId,
          leaseEpoch: claimed.step.leaseEpoch,
          expectedRunStates: claimed.step.stepType === 'collect' ? ['collecting'] : ['evaluating'],
        });
        await tx.scheduleRetry(fence, workerId, claimed.step.leaseEpoch);
        await tx.appendEvent({
          aggregateType: 'assurance_run',
          aggregateId: claimed.run.id,
          type: 'step_retry_scheduled',
          operationId: `${claimed.step.stepType}:retry:${String(claimed.step.leaseEpoch)}`,
          payload: { attempt: claimed.step.attempt },
          actorId: null,
        });
      });
    } catch (error) {
      if (error instanceof FenceLostError) {
        return;
      }
      throw error;
    }
  }
}
