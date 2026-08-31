import { randomUUID } from 'node:crypto';

import {
  FAKE_ADAPTER,
  FAKE_INVENTORY_KIND,
  FAKE_INVENTORY_OPERATION,
  FAKE_TELEMETRY_KIND,
  FAKE_TELEMETRY_OPERATION,
  OutOfScopeError,
  assertInScope,
  redactUnknown,
} from '@grounds/domain';
import { FenceLostError } from './errors.js';
import type { ResourceInventoryPort, TelemetryPort } from './ports.js';
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
    if (!profile) {
      throw new Error('profile version missing');
    }
    await this.ensureStillLeased(claimed, workerId);
    assertInScope(claimed.run.resourceScope, profile.scope);
    const inventory = await this.callInventory(claimed.run.resourceScope);
    await this.persist(claimed, workerId, {
      id: randomUUID(),
      kind: FAKE_INVENTORY_KIND,
      payload: inventory.payload,
      inaccessible: !inventory.ok,
      operation: FAKE_INVENTORY_OPERATION,
      adapter: FAKE_ADAPTER,
    });
    await this.ensureStillLeased(claimed, workerId);
    const telemetry = await this.callTelemetry(claimed.run.resourceScope);
    await this.persist(claimed, workerId, {
      id: randomUUID(),
      kind: FAKE_TELEMETRY_KIND,
      payload: telemetry.payload,
      inaccessible: !telemetry.ok,
      operation: FAKE_TELEMETRY_OPERATION,
      adapter: FAKE_ADAPTER,
    });
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

  private async callInventory(scope: Parameters<ResourceInventoryPort['describeInventory']>[0]) {
    try {
      const result = await this.inventory.describeInventory(scope);
      if (result.ok) {
        return { ok: true as const, payload: redactUnknown(result.payload) };
      }
      return { ok: false as const, payload: { inaccessible: true, kind: FAKE_INVENTORY_KIND } };
    } catch (error) {
      if (error instanceof OutOfScopeError) {
        throw error;
      }
      return { ok: false as const, payload: { inaccessible: true, kind: FAKE_INVENTORY_KIND } };
    }
  }

  private async callTelemetry(scope: Parameters<TelemetryPort['getTelemetry']>[0]) {
    try {
      const result = await this.telemetry.getTelemetry(scope);
      if (result.ok) {
        return { ok: true as const, payload: redactUnknown(result.payload) };
      }
      return { ok: false as const, payload: { inaccessible: true, kind: FAKE_TELEMETRY_KIND } };
    } catch {
      return { ok: false as const, payload: { inaccessible: true, kind: FAKE_TELEMETRY_KIND } };
    }
  }

  private async persist(
    claimed: ClaimedWork,
    workerId: string,
    input: PersistObservationInput,
  ): Promise<void> {
    const profile = await this.store.getProfile(claimed.run.profileVersionId);
    if (!profile) {
      throw new Error('profile version missing');
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

export function isFenceLost(error: unknown): boolean {
  return error instanceof FenceLostError;
}
