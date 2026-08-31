import { sha256Canonical } from './digest.js';
import type { JsonObject, JsonValue } from './json.js';
import { resourceToJson } from './identity.js';
import type { ResourceRef } from './resource-ref.js';
import type { AssuranceResult } from './run-state.js';

export const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];

export function findingFingerprint(input: {
  readonly organisationId: string;
  readonly detectorId: string;
  readonly detectorVersion: string;
  readonly detectorParametersDigest: string;
  readonly resource: ResourceRef;
  readonly result: AssuranceResult;
  readonly condition: JsonObject;
}): string {
  return sha256Canonical({
    organisationId: input.organisationId,
    detectorId: input.detectorId,
    detectorVersion: input.detectorVersion,
    detectorParametersDigest: input.detectorParametersDigest,
    resource: resourceToJson(input.resource),
    result: input.result,
    condition: input.condition,
  });
}

export function severityFor(result: AssuranceResult): Severity {
  if (result === 'FAIL') {
    return 'HIGH';
  }
  if (result === 'UNKNOWN') {
    return 'MEDIUM';
  }
  return 'INFO';
}

export type FindingCondition = JsonObject;

export function conditionValue(value: string | boolean | null): JsonValue {
  return value;
}
