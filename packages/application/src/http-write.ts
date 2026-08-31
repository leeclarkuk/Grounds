import { isJsonObject, resourceToJson, windowToJson, type JsonObject } from '@grounds/domain';
import { InvariantViolationError } from './errors.js';
import type { HttpIdempotencyRecord } from './store.js';
import type { AssuranceRun, Grant } from './types.js';

export type StoredHttpResponse = {
  readonly status: number;
  readonly body: JsonObject;
};

export function storedHttpResponse(record: HttpIdempotencyRecord): StoredHttpResponse {
  if (!isJsonObject(record.responseBody)) {
    throw new InvariantViolationError('stored http idempotency body must be a JSON object');
  }
  return { status: record.responseStatus, body: record.responseBody };
}

export function authorisationResponseBody(grant: Grant): JsonObject {
  return {
    id: grant.id,
    profileVersionId: grant.profileVersionId,
    resourceScope: resourceToJson(grant.resourceScope),
    evidenceWindow: windowToJson(grant.evidenceWindow),
    expiresAt: grant.expiresAt,
  };
}

export function runWriteResponseBody(run: AssuranceRun): JsonObject {
  return {
    id: run.id,
    state: run.state,
    profileVersionId: run.profileVersionId,
    resourceScope: resourceToJson(run.resourceScope),
    evidenceWindow: windowToJson(run.evidenceWindow),
  };
}

export function cancelResponseBody(run: AssuranceRun): JsonObject {
  return { id: run.id, state: run.state };
}
