import { randomUUID } from 'node:crypto';

import {
  OutOfScopeError,
  assertDetectorPinSet,
  assertInScope,
  sha256Canonical,
  splitEcsResourceId,
} from '@grounds/domain';
import { FenceLostError, InvariantViolationError } from './errors.js';
import type { CollectorObservation, ResourceInventoryPort, TelemetryPort } from './ports.js';
import type { OrchestrationStore } from './store.js';
import type { ClaimedWork, PersistObservationInput } from './types.js';

export class CollectStep {
  public constructor(
    private readonly store: OrchestrationStore,
    private readonly inventory: ResourceInventoryPort,
    private readonly telemetry: TelemetryPort,
    private readonly skipComplete = false,
  ) {}

  public async execute(claimed: ClaimedWork, workerId: string): Promise<void> {
    if (claimed.step.stepType !== 'collect') {
      throw new Error('collect step required');
    }
    const profile = await this.store.getProfile(claimed.run.profileVersionId);
    if (!profile || profile.organisationId !== claimed.run.organisationId) {
      throw new InvariantViolationError('profile version missing or organisation mismatch');
    }
    await this.ensureStillLeased(claimed, workerId);
    assertInScope(claimed.run.resourceScope, profile.scope);
    assertDetectorPinSet(claimed.run.detectorVersions);
    assertDetectorPinSet(profile.detectorVersions);
    if (
      sha256Canonical(claimed.run.detectorVersions) !== sha256Canonical(profile.detectorVersions)
    ) {
      throw new InvariantViolationError('run detector pins do not match the profile');
    }
    splitEcsResourceId(claimed.run.resourceScope.resourceId);
    const onPage = async (): Promise<void> => {
      await this.ensureStillLeased(claimed, workerId);
    };
    const context = {
      scope: claimed.run.resourceScope,
      window: claimed.run.evidenceWindow,
      onPage,
    };
    const inventory = await this.safeCollect(() => this.inventory.collect(context));
    for (const observation of inventory) {
      await this.persist(claimed, workerId, toPersist(observation));
    }
    await this.ensureStillLeased(claimed, workerId);
    const telemetry = await this.safeCollect(() => this.telemetry.collect(context));
    for (const observation of telemetry) {
      await this.persist(claimed, workerId, toPersist(observation));
    }
    if (this.skipComplete) {
      return;
    }
    await this.store.withTransaction(async (tx) => {
      const fence = await tx.requireFence({
        runId: claimed.run.id,
        stepId: claimed.step.id,
        workerId,
        leaseEpoch: claimed.step.leaseEpoch,
        expectedRunStates: ['collecting'],
      });
      await tx.completeCollect(fence, workerId, claimed.step.leaseEpoch);
      await tx.appendEvent({
        aggregateType: 'assurance_run',
        aggregateId: claimed.run.id,
        type: 'step_succeeded',
        operationId: `collect:succeeded:${claimed.run.id}`,
        payload: { stepType: 'collect' },
        actorId: null,
      });
    });
  }

  private async safeCollect(
    collect: () => Promise<readonly CollectorObservation[]>,
  ): Promise<readonly CollectorObservation[]> {
    try {
      return await collect();
    } catch (error) {
      if (error instanceof OutOfScopeError) {
        throw error;
      }
      throw error;
    }
  }

  private async persist(
    claimed: ClaimedWork,
    workerId: string,
    input: PersistObservationInput,
  ): Promise<void> {
    const profile = await this.store.getProfile(claimed.run.profileVersionId);
    if (!profile) {
      throw new InvariantViolationError('profile version missing');
    }
    await this.store.withTransaction(async (tx) => {
      const fence = await tx.requireFence({
        runId: claimed.run.id,
        stepId: claimed.step.id,
        workerId,
        leaseEpoch: claimed.step.leaseEpoch,
        expectedRunStates: ['collecting'],
      });
      await tx.incrementCollectorAttempts(claimed.run.id);
      await tx.persistObservation(fence.run, input, profile.freshnessPolicy.freshnessMaxAgeSeconds);
    });
  }

  private async ensureStillLeased(claimed: ClaimedWork, workerId: string): Promise<void> {
    await this.store.withTransaction(async (tx) => {
      await tx.requireFence({
        runId: claimed.run.id,
        stepId: claimed.step.id,
        workerId,
        leaseEpoch: claimed.step.leaseEpoch,
        expectedRunStates: ['collecting'],
      });
    });
  }
}

function toPersist(observation: CollectorObservation): PersistObservationInput {
  return {
    id: randomUUID(),
    kind: observation.kind,
    payload: observation.payload,
    inaccessible: observation.inaccessible,
    operation: observation.operation,
    adapter: observation.adapter,
    requestDigest: observation.requestDigest,
    ...(observation.observedAt === undefined ? {} : { observedAt: observation.observedAt }),
  };
}

export function isFenceLost(error: unknown): boolean {
  return error instanceof FenceLostError;
}
