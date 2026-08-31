import type { EvidenceWindow, JsonValue, ResourceRef } from '@grounds/domain';
import type { AssuranceRun, ObservationRecord, PersistFindingInput } from './types.js';

export type CollectorObservation = {
  readonly kind: string;
  readonly payload: JsonValue;
  readonly inaccessible: boolean;
  readonly operation: string;
  readonly adapter: string;
  readonly requestDigest: string;
  readonly observedAt?: string;
};

export type CollectContext = {
  readonly scope: ResourceRef;
  readonly window: EvidenceWindow;
  readonly onPage: () => Promise<void>;
};

export interface ResourceInventoryPort {
  collect(context: CollectContext): Promise<readonly CollectorObservation[]>;
}

export interface TelemetryPort {
  collect(context: CollectContext): Promise<readonly CollectorObservation[]>;
}

export type DetectorInput = {
  readonly run: AssuranceRun;
  readonly observations: readonly ObservationRecord[];
  readonly detectorParameters: import('@grounds/domain').JsonObject;
};

export type DetectorOutput = Omit<PersistFindingInput, 'id'>;

export interface Detector {
  readonly id: string;
  readonly version: string;
  evaluate(input: DetectorInput): DetectorOutput;
}

export interface IdentityProvider {
  actorId(): string;
  organisationId(): string;
}
