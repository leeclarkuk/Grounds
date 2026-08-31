import {
  ClaimWork,
  CollectStep,
  EnqueueRun,
  EvaluateStep,
  FailClaimedStep,
  FindingReplayMismatchError,
  HeartbeatLease,
  InvariantViolationError,
  OutOfScopeError,
  RetryClaimedStep,
  isFenceLost,
  type Detector,
  type OrchestrationStore,
  type ResourceInventoryPort,
  type TelemetryPort,
} from '@grounds/application';
import { log } from '@grounds/observability';
import { GrdFake001 } from '@grounds/test-support';

export type WorkerOptions = {
  readonly store: OrchestrationStore;
  readonly inventory: ResourceInventoryPort;
  readonly telemetry: TelemetryPort;
  readonly workerId: string;
  readonly leaseTtlSeconds: number;
  readonly pollIntervalMs?: number;
  readonly crashAfterObservations?: boolean;
  readonly detectors?: readonly Detector[];
};

export class WorkerLoop {
  private stopping = false;

  public constructor(private readonly options: WorkerOptions) {}

  public stop(): void {
    this.stopping = true;
  }

  public async runOnce(): Promise<boolean> {
    const claimed = await new ClaimWork(this.options.store).execute(
      this.options.workerId,
      this.options.leaseTtlSeconds,
    );
    if (!claimed || claimed.exhausted) {
      return false;
    }
    const heartbeat = new HeartbeatLease(this.options.store);
    const timer = setInterval(
      () => {
        void heartbeat
          .execute(
            claimed.step.id,
            this.options.workerId,
            claimed.step.leaseEpoch,
            this.options.leaseTtlSeconds,
          )
          .then((ok) => {
            if (!ok) {
              log('warn', 'heartbeat rejected');
            }
          })
          .catch(() => {
            log('warn', 'heartbeat failed');
          });
      },
      Math.max(200, Math.floor((this.options.leaseTtlSeconds * 1000) / 3)),
    );
    try {
      log('info', 'claimed work', {
        runId: claimed.run.id,
        stepId: claimed.step.id,
        attempt: claimed.step.attempt,
        leaseEpoch: claimed.step.leaseEpoch,
        profileVersionId: claimed.run.profileVersionId,
      });
      if (claimed.step.stepType === 'collect') {
        await new CollectStep(
          this.options.store,
          this.options.inventory,
          this.options.telemetry,
          this.options.crashAfterObservations === true,
        ).execute(claimed, this.options.workerId);
        if (this.options.crashAfterObservations) {
          throw new CrashAfterObservationsError();
        }
      } else {
        await new EvaluateStep(
          this.options.store,
          this.options.detectors ?? [new GrdFake001()],
        ).execute(claimed, this.options.workerId);
      }
      return true;
    } catch (error) {
      if (error instanceof CrashAfterObservationsError) {
        throw error;
      }
      if (isFenceLost(error)) {
        log('warn', 'fence lost');
        return false;
      }
      if (
        error instanceof OutOfScopeError ||
        error instanceof FindingReplayMismatchError ||
        error instanceof InvariantViolationError
      ) {
        await new FailClaimedStep(this.options.store).execute(
          claimed,
          this.options.workerId,
          'invariant_violation',
        );
        return false;
      }
      await new RetryClaimedStep(this.options.store).execute(claimed, this.options.workerId);
      return false;
    } finally {
      clearInterval(timer);
    }
  }

  public async runUntilIdle(maxTurns = 20): Promise<void> {
    let idle = 0;
    for (let turn = 0; turn < maxTurns && !this.stopping; turn += 1) {
      const worked = await this.runOnce();
      if (worked) {
        idle = 0;
      } else {
        idle += 1;
        if (idle >= 2) {
          return;
        }
      }
    }
  }
}

export class CrashAfterObservationsError extends Error {
  public override readonly name = 'CrashAfterObservationsError';
  public constructor() {
    super('CrashAfterObservations');
  }
}

export { EnqueueRun, FailClaimedStep };
