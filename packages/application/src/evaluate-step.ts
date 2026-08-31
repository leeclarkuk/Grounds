import { randomUUID } from 'node:crypto';

import {
  assertDetectorPinSet,
  sha256Canonical,
  summariseResults,
  terminalStateForResults,
} from '@grounds/domain';
import { InvariantViolationError } from './errors.js';
import type { Detector } from './ports.js';
import type { OrchestrationStore } from './store.js';
import type { ClaimedWork, PersistFindingInput } from './types.js';

export class EvaluateStep {
  public constructor(
    private readonly store: OrchestrationStore,
    private readonly detectors: readonly Detector[],
  ) {}

  public async execute(claimed: ClaimedWork, workerId: string): Promise<void> {
    if (claimed.step.stepType !== 'evaluate') {
      throw new Error('evaluate step required');
    }
    const profile = await this.store.getProfile(claimed.run.profileVersionId);
    if (!profile || profile.organisationId !== claimed.run.organisationId) {
      throw new InvariantViolationError('profile version missing or organisation mismatch');
    }
    assertDetectorPinSet(claimed.run.detectorVersions);
    assertDetectorPinSet(profile.detectorVersions);
    if (
      sha256Canonical(claimed.run.detectorVersions) !== sha256Canonical(profile.detectorVersions)
    ) {
      throw new InvariantViolationError('run detector pins do not match the profile');
    }
    const observations = await this.store.listObservations(claimed.run.id);
    const outputs: PersistFindingInput[] = [];
    for (const [detectorId, detectorVersion] of Object.entries(claimed.run.detectorVersions)) {
      const detector = this.detectors.find(
        (item) => item.id === detectorId && item.version === detectorVersion,
      );
      if (!detector) {
        throw new InvariantViolationError('pinned detector is not registered');
      }
      const output = detector.evaluate({
        run: claimed.run,
        observations,
        detectorParameters: profile.detectorParameters,
      });
      outputs.push({ ...output, id: randomUUID() });
    }
    if (outputs.length === 0) {
      throw new Error('pinned detector set is empty');
    }
    await this.store.withTransaction(async (tx) => {
      const fence = await tx.requireFence({
        runId: claimed.run.id,
        stepId: claimed.step.id,
        workerId,
        leaseEpoch: claimed.step.leaseEpoch,
        expectedRunStates: ['evaluating'],
      });
      for (const output of outputs) {
        await tx.persistFinding(fence.run, output);
      }
      const results = outputs.map((item) => item.result);
      const result = summariseResults(results);
      const state = terminalStateForResults(results);
      await tx.completeEvaluate(fence, workerId, claimed.step.leaseEpoch, { state, result });
      await tx.appendEvent({
        aggregateType: 'assurance_run',
        aggregateId: claimed.run.id,
        type: 'step_succeeded',
        operationId: `evaluate:succeeded:${claimed.run.id}`,
        payload: { stepType: 'evaluate', result, state },
        actorId: null,
      });
    });
  }
}
