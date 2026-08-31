import type { JsonValue, ResourceRef } from '@grounds/domain';
import type { AssuranceRun, ObservationRecord, PersistFindingInput } from './types.js';

export type InventoryResult =
  { readonly ok: true; readonly payload: JsonValue } | { readonly ok: false };

export type TelemetryResult =
  { readonly ok: true; readonly payload: JsonValue } | { readonly ok: false };

export interface ResourceInventoryPort {
  describeInventory(scope: ResourceRef): Promise<InventoryResult>;
}

export interface TelemetryPort {
  getTelemetry(scope: ResourceRef): Promise<TelemetryResult>;
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
}
