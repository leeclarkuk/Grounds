import { sha256Canonical, type JsonObject } from '@grounds/domain';
import { IdempotencyConflictError, InvariantViolationError, NotFoundError } from './errors.js';
import { storedHttpResponse } from './http-write.js';
import type { IdentityProvider } from './ports.js';
import { EnqueueRun } from './enqueue-run.js';
import type { HttpIdempotencyRecord, OrchestrationStore } from './store.js';
import type { AssuranceRun } from './types.js';

export type EnqueueRunHttpCommand = {
  readonly grantId: string;
  readonly clientIdempotencyKey: string;
};

export type EnqueueRunHttpResult = {
  readonly run: AssuranceRun;
  readonly replayed: boolean;
  readonly status: number;
  readonly body: JsonObject;
};

export class EnqueueRunHttp {
  public constructor(
    private readonly store: OrchestrationStore,
    private readonly identity: IdentityProvider,
  ) {}

  public async execute(command: EnqueueRunHttpCommand): Promise<EnqueueRunHttpResult> {
    const actorId = this.identity.actorId();
    const organisationId = this.identity.organisationId();
    const requestDigest = sha256Canonical({ grantId: command.grantId });
    const lookup = {
      organisationId,
      actorId,
      method: 'POST',
      route: '/v1/runs',
      clientIdempotencyKey: command.clientIdempotencyKey,
    };
    const existing = await this.store.getHttpIdempotency(lookup);
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        throw new IdempotencyConflictError();
      }
      return this.fromStored(existing, command.clientIdempotencyKey, true);
    }
    const grant = await this.store.getGrant(command.grantId);
    if (!grant || grant.organisationId !== organisationId || grant.actorId !== actorId) {
      throw new NotFoundError('authorisation grant not found');
    }
    const run = await new EnqueueRun(this.store).execute({
      grantId: command.grantId,
      clientIdempotencyKey: command.clientIdempotencyKey,
      requestDigest,
      http: {
        organisationId,
        actorId,
        method: 'POST',
        route: '/v1/runs',
      },
    });
    const stored = await this.store.getHttpIdempotency(lookup);
    if (!stored) {
      throw new InvariantViolationError('run idempotency record missing after write');
    }
    const response = storedHttpResponse(stored);
    return { run, replayed: false, status: response.status, body: response.body };
  }

  private async fromStored(
    record: HttpIdempotencyRecord,
    clientIdempotencyKey: string,
    replayed: boolean,
  ): Promise<EnqueueRunHttpResult> {
    const stored = storedHttpResponse(record);
    const run = await this.store.getRunByClientKey(clientIdempotencyKey);
    if (!run) {
      throw new NotFoundError('run not found');
    }
    return { run, replayed, status: stored.status, body: stored.body };
  }
}
