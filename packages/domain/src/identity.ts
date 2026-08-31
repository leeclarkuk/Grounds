import { sha256Canonical } from './digest.js';
import type { JsonObject } from './json.js';
import type { EvidenceWindow } from './evidence-window.js';
import { resourceRefsEqual, type ResourceRef } from './resource-ref.js';

export type ObservationSource = {
  readonly adapter: string;
  readonly operation: string;
  readonly requestDigest: string;
};

export type Freshness = 'FRESH' | 'STALE';

export function resourceToJson(resource: ResourceRef): JsonObject {
  return {
    provider: resource.provider,
    accountId: resource.accountId,
    region: resource.region,
    service: resource.service,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
  };
}

export function windowToJson(window: EvidenceWindow): JsonObject {
  return { from: window.from, to: window.to };
}

export function contentIdentity(input: {
  readonly organisationId: string;
  readonly kind: string;
  readonly resource: ResourceRef;
  readonly window: EvidenceWindow;
  readonly operation: string;
  readonly payloadDigest: string;
  readonly redactionVersion: string;
}): string {
  return sha256Canonical({
    organisationId: input.organisationId,
    kind: input.kind,
    resource: resourceToJson(input.resource),
    window: windowToJson(input.window),
    source: { operation: input.operation },
    payloadDigest: input.payloadDigest,
    redactionVersion: input.redactionVersion,
  });
}

export function runIdentityDigest(input: {
  readonly organisationId: string;
  readonly profileVersionId: string;
  readonly resourceScope: ResourceRef;
  readonly evidenceWindow: EvidenceWindow;
  readonly triggerIdentity: JsonObject;
}): string {
  return sha256Canonical({
    organisationId: input.organisationId,
    profileVersionId: input.profileVersionId,
    resourceScope: resourceToJson(input.resourceScope),
    evidenceWindow: windowToJson(input.evidenceWindow),
    triggerIdentity: input.triggerIdentity,
  });
}

export function resourceScopeDigest(resource: ResourceRef): string {
  return sha256Canonical(resourceToJson(resource));
}

export function requestDigest(input: {
  readonly operation: string;
  readonly resource: ResourceRef;
  readonly window?: EvidenceWindow;
  readonly query?: JsonObject;
}): string {
  return sha256Canonical({
    operation: input.operation,
    resource: resourceToJson(input.resource),
    window: input.window ? windowToJson(input.window) : null,
    query: input.query ?? {},
  });
}

export function detectorParametersDigest(parameters: JsonObject): string {
  return sha256Canonical(parameters);
}

export function scopesEqual(requested: ResourceRef, authorised: ResourceRef): boolean {
  return resourceRefsEqual(requested, authorised);
}

export function assertInScope(requested: ResourceRef, authorised: ResourceRef): void {
  if (!scopesEqual(requested, authorised)) {
    throw new OutOfScopeError(requested, authorised);
  }
}

export class OutOfScopeError extends Error {
  public override readonly name = 'OutOfScopeError';

  public constructor(
    public readonly requested: ResourceRef,
    public readonly authorised: ResourceRef,
  ) {
    super('request is outside the authorised resource scope');
  }
}

export function freshnessFromAge(ageSeconds: number, freshnessMaxAgeSeconds: number): Freshness {
  return ageSeconds >= freshnessMaxAgeSeconds ? 'STALE' : 'FRESH';
}
