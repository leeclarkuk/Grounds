import { randomUUID } from 'node:crypto';

import {
  FAKE_DETECTOR_ID,
  FAKE_DETECTOR_VERSION,
  summariseResults,
  terminalStateForResults,
} from '@grounds/domain';
import type { Detector } from './ports.js';
import type { OrchestrationStore } from './store.js';
import type { ClaimedWork } from './types.js';

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
    if (!profile) {
      throw new Error('profile version missing');
    }
    const observations = await this.store.listObservations(claimed.run.id);
    const detector = this.detectors.find(
      (item) => item.id === FAKE_DETECTOR_ID && item.version === FAKE_DETECTOR_VERSION,
    );
    if (!detector) {
      throw new Error('GRD-FAKE-001 is not registered');
    }
    const output = detector.evaluate({
      run: claimed.run,
      observations,
      detectorParameters: profile.detectorParameters,
    });
    await this.store.withTransaction(async (tx) => {
      const fence = await tx.requireFence({
        runId: claimed.run.id,
        stepId: claimed.step.id,
        workerId,
        leaseEpoch: claimed.step.leaseEpoch,
        expectedRunStates: ['evaluating'],
      });
      await tx.persistFinding(fence.run, { ...output, id: randomUUID() });
      const result = summariseResults([output.result]);
      const state = terminalStateForResults([output.result]);
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
