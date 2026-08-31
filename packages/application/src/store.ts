import type {
  AssuranceRun,
  ClaimedWork,
  EventInput,
  FindingRecord,
  Grant,
  ObservationRecord,
  PersistFindingInput,
  PersistObservationInput,
  ProfileVersion,
  RunStep,
} from './types.js';
import type { ErrorClass } from '@grounds/domain';

export type Fence = {
  readonly run: AssuranceRun;
  readonly step: RunStep;
};

export interface OrchestrationStore {
  withTransaction<T>(fn: (tx: OrchestrationTx) => Promise<T>): Promise<T>;
  getRun(runId: string): Promise<AssuranceRun | undefined>;
  getRunByClientKey(clientIdempotencyKey: string): Promise<AssuranceRun | undefined>;
  listObservations(runId: string): Promise<readonly ObservationRecord[]>;
  listFindings(runId: string): Promise<readonly FindingRecord[]>;
  listEvents(aggregateType: string, aggregateId: string): Promise<readonly EventRow[]>;
  getGrant(grantId: string): Promise<Grant | undefined>;
  getGrantByClientKey(clientIdempotencyKey: string): Promise<Grant | undefined>;
  getProfile(profileVersionId: string): Promise<ProfileVersion | undefined>;
  getStep(runId: string, stepType: 'collect' | 'evaluate'): Promise<RunStep | undefined>;
  outboxLag(): Promise<number>;
  ping(): Promise<void>;
}

export type EventRow = {
  readonly sequence: number;
  readonly type: string;
  readonly operationId: string;
};

export interface OrchestrationTx {
  consumeGrant(grantId: string): Promise<Grant>;
  insertRun(run: AssuranceRun): Promise<AssuranceRun>;
  insertSteps(runId: string, collectId: string, evaluateId: string): Promise<void>;
  lockRun(runId: string): Promise<AssuranceRun>;
  lockStep(stepId: string): Promise<RunStep>;
  appendEvent(
    event: EventInput,
  ): Promise<{ readonly inserted: boolean; readonly sequence: number }>;
  claimWork(workerId: string, leaseTtlSeconds: number): Promise<ClaimedWork | undefined>;
  heartbeat(
    stepId: string,
    workerId: string,
    leaseEpoch: number,
    leaseTtlSeconds: number,
  ): Promise<boolean>;
  requireFence(input: {
    readonly runId: string;
    readonly stepId: string;
    readonly workerId: string;
    readonly leaseEpoch: number;
    readonly expectedRunStates: readonly string[];
  }): Promise<Fence>;
  persistObservation(
    run: AssuranceRun,
    input: PersistObservationInput,
    freshnessMaxAgeSeconds: number,
  ): Promise<{
    readonly observation: ObservationRecord;
    readonly duplicate: boolean;
  }>;
  persistFinding(
    run: AssuranceRun,
    input: PersistFindingInput,
  ): Promise<{
    readonly finding: FindingRecord;
    readonly duplicate: boolean;
  }>;
  completeCollect(fence: Fence, workerId: string, leaseEpoch: number): Promise<void>;
  completeEvaluate(
    fence: Fence,
    workerId: string,
    leaseEpoch: number,
    outcome: {
      readonly state: 'healthy' | 'findings';
      readonly result: 'PASS' | 'FAIL' | 'UNKNOWN';
    },
  ): Promise<void>;
  failStep(
    fence: Fence,
    workerId: string,
    leaseEpoch: number,
    errorClass: ErrorClass,
  ): Promise<void>;
  scheduleRetry(fence: Fence, workerId: string, leaseEpoch: number): Promise<void>;
  cancelCollect(runId: string): Promise<AssuranceRun>;
  recordCancelRequested(runId: string): Promise<void>;
  incrementCollectorAttempts(runId: string): Promise<void>;
  insertProfile(profile: ProfileVersion): Promise<ProfileVersion>;
  insertGrant(grant: Grant): Promise<Grant>;
}
