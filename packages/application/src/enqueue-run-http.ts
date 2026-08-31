import { sha256Canonical } from '@grounds/domain';
import { IdempotencyConflictError, NotFoundError } from './errors.js';
import type { IdentityProvider } from './ports.js';
import { EnqueueRun } from './enqueue-run.js';
import type { OrchestrationStore } from './store.js';
import type { AssuranceRun } from './types.js';

export type EnqueueRunHttpCommand = {
  readonly grantId: string;
  readonly clientIdempotencyKey: string;
};

export class EnqueueRunHttp {
  public constructor(
    private readonly store: OrchestrationStore,
    private readonly identity: IdentityProvider,
  ) {}

  public async execute(command: EnqueueRunHttpCommand): Promise<{
    readonly run: AssuranceRun;
    readonly replayed: boolean;
  }> {
    const actorId = this.identity.actorId();
    const organisationId = this.identity.organisationId();
    const requestDigest = sha256Canonical({ grantId: command.grantId });
    const existing = await this.store.getHttpIdempotency({
      organisationId,
      actorId,
      method: 'POST',
      route: '/v1/runs',
      clientIdempotencyKey: command.clientIdempotencyKey,
    });
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        throw new IdempotencyConflictError();
      }
      const run = await this.store.getRunByClientKey(command.clientIdempotencyKey);
      if (!run) {
        throw new NotFoundError('run not found');
      }
      return { run, replayed: true };
    }
    const grant = await this.store.getGrant(command.grantId);
    if (!grant || grant.organisationId !== organisationId || grant.actorId !== actorId) {
      throw new NotFoundError('authorisation grant not found');
    }
    const before = await this.store.getRunByClientKey(command.clientIdempotencyKey);
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
    return { run, replayed: before !== undefined && before.id === run.id };
  }
}
