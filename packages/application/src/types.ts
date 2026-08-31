import type {
  AssuranceResult,
  ErrorClass,
  EvidenceWindow,
  Freshness,
  JsonObject,
  JsonValue,
  ResourceRef,
  RunState,
  StepState,
  StepType,
} from '@grounds/domain';

export type DetectorVersions = { readonly [detectorId: string]: string };

export type FreshnessPolicy = {
  readonly freshnessMaxAgeSeconds: number;
};

export type ProfileVersion = {
  readonly id: string;
  readonly organisationId: string;
  readonly profileId: string;
  readonly version: number;
  readonly scope: ResourceRef;
  readonly detectorVersions: DetectorVersions;
  readonly freshnessPolicy: FreshnessPolicy;
  readonly detectorParameters: JsonObject;
  readonly contentDigest: string;
};

export type Grant = {
  readonly id: string;
  readonly organisationId: string;
  readonly actorId: string;
  readonly profileVersionId: string;
  readonly resourceScope: ResourceRef;
  readonly resourceScopeDigest: string;
  readonly evidenceWindow: EvidenceWindow;
  readonly detectorVersions: DetectorVersions;
  readonly grantedAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly clientIdempotencyKey: string;
  readonly requestDigest: string;
};

export type AssuranceRun = {
  readonly id: string;
  readonly organisationId: string;
  readonly profileVersionId: string;
  readonly authorisationGrantId: string;
  readonly resourceScope: ResourceRef;
  readonly resourceScopeDigest: string;
  readonly evidenceWindow: EvidenceWindow;
  readonly detectorVersions: DetectorVersions;
  readonly state: RunState;
  readonly result: AssuranceResult | null;
  readonly clientIdempotencyKey: string;
  readonly requestDigest: string;
  readonly runIdentityDigest: string;
  readonly cancelRequestedAt: string | null;
  readonly collectorAttemptCount: number;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly updatedAt: string;
  readonly terminalAt: string | null;
};

export type RunStep = {
  readonly id: string;
  readonly runId: string;
  readonly stepType: StepType;
  readonly state: StepState;
  readonly attempt: number;
  readonly nextAttemptAt: string | null;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly leaseEpoch: number;
  readonly errorClass: ErrorClass | null;
  readonly errorMessage: string | null;
};

export type ObservationRecord = {
  readonly id: string;
  readonly runId: string;
  readonly organisationId: string;
  readonly kind: string;
  readonly resource: ResourceRef;
  readonly collectedAt: string;
  readonly window: EvidenceWindow;
  readonly sourceAdapter: string;
  readonly sourceOperation: string;
  readonly requestDigest: string;
  readonly freshness: Freshness;
  readonly payload: JsonValue;
  readonly payloadDigest: string;
  readonly redactionVersion: string;
  readonly truncated: boolean;
  readonly inaccessible: boolean;
  readonly contentIdentity: string;
};

export type FindingRecord = {
  readonly id: string;
  readonly runId: string;
  readonly detectorId: string;
  readonly detectorVersion: string;
  readonly profileVersionId: string;
  readonly resource: ResourceRef;
  readonly result: AssuranceResult;
  readonly severity: string;
  readonly title: string;
  readonly explanation: string;
  readonly fingerprint: string;
  readonly citationCount: number;
  readonly observationIds: readonly string[];
};

export type ClaimedWork = {
  readonly run: AssuranceRun;
  readonly step: RunStep;
  readonly recovered: boolean;
  readonly exhausted: boolean;
};

export type EventInput = {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly type: string;
  readonly operationId: string;
  readonly payload: JsonObject;
  readonly actorId: string | null;
};

export type PersistObservationInput = {
  readonly id: string;
  readonly kind: string;
  readonly payload: JsonValue;
  readonly inaccessible: boolean;
  readonly operation: string;
  readonly adapter: string;
};

export type PersistFindingInput = {
  readonly id: string;
  readonly detectorId: string;
  readonly detectorVersion: string;
  readonly result: AssuranceResult;
  readonly severity: string;
  readonly title: string;
  readonly explanation: string;
  readonly fingerprint: string;
  readonly observationIds: readonly string[];
};
