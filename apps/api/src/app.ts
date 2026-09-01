import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  CancelRun,
  CreateAuthorisation,
  EnqueueRunHttp,
  GrantNotConsumableError,
  IdempotencyConflictError,
  InvariantViolationError,
  NotFoundError,
  UniqueConstraintError,
  ValidationError,
  storedHttpResponse,
  type IdentityProvider,
  type OrchestrationStore,
} from '@grounds/application';
import { log } from '@grounds/observability';
import {
  createPool,
  isSchemaReady,
  PostgresOrchestrationStore,
} from '@grounds/persistence-postgres';
import { assertJsonValue, isJsonObject, parseResourceRef, type JsonObject } from '@grounds/domain';

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  GROUNDS_IDENTITY_MODE: z.string(),
  GROUNDS_DEV_ACTOR_ID: z.string().min(1).default('dev-actor'),
  GROUNDS_DEV_ORGANISATION_ID: z.string().min(1).default('org_grounds_dev'),
  GROUNDS_LISTEN_HOST: z.string().default('127.0.0.1'),
  GROUNDS_LISTEN_PORT: z.coerce.number().int().positive().default(3000),
});

const IdParams = z.object({ id: z.string().min(1) });

export type ApiOptions = {
  readonly databaseUrl: string;
  readonly identityMode: string;
  readonly actorId?: string;
  readonly organisationId?: string;
  readonly host?: string;
  readonly port?: number;
  readonly store?: OrchestrationStore;
};

export function assertDevelopmentIdentity(identityMode: string): void {
  if (identityMode !== 'development') {
    throw new Error('API refuses to listen unless GROUNDS_IDENTITY_MODE=development');
  }
}

class DevelopmentIdentity implements IdentityProvider {
  public constructor(
    private readonly actor: string,
    private readonly organisation: string,
  ) {}
  public actorId(): string {
    return this.actor;
  }
  public organisationId(): string {
    return this.organisation;
  }
}

function problem(
  reply: FastifyReply,
  status: number,
  title: string,
  detail: string,
): ReturnType<FastifyReply['send']> {
  return reply.code(status).type('application/problem+json').send({
    type: 'about:blank',
    title,
    status,
    detail,
  });
}

function requireIdempotencyKey(request: FastifyRequest, reply: FastifyReply): string | undefined {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length === 0) {
    void problem(reply, 400, 'Bad Request', 'Idempotency-Key is required');
    return undefined;
  }
  return key;
}

function jsonObject(value: unknown, field: string): JsonObject {
  try {
    const parsed = assertJsonValue(value);
    if (!isJsonObject(parsed)) {
      throw new ValidationError(`${field} must be a JSON object`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(`${field} must be a JSON object`);
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${field} is required`);
  }
  return value;
}

function mapError(error: unknown, reply: FastifyReply): ReturnType<FastifyReply['send']> {
  if (error instanceof UniqueConstraintError) {
    return problem(reply, 409, 'Conflict', 'idempotency key reused with a different request');
  }
  if (error instanceof IdempotencyConflictError) {
    return problem(reply, 409, 'Conflict', 'idempotency key reused with a different request');
  }
  if (error instanceof NotFoundError) {
    return problem(reply, 404, 'Not Found', error.message);
  }
  if (error instanceof ValidationError || error instanceof GrantNotConsumableError) {
    return problem(reply, 400, 'Bad Request', error.message);
  }
  if (error instanceof InvariantViolationError) {
    log('error', 'api invariant violation', {}, error);
    return problem(reply, 500, 'Internal Server Error', 'request failed');
  }
  if (error instanceof z.ZodError) {
    return problem(reply, 400, 'Bad Request', 'request is invalid');
  }
  log('error', 'unhandled api error', {}, error);
  return problem(reply, 500, 'Internal Server Error', 'request failed');
}

export function buildApi(options: ApiOptions) {
  assertDevelopmentIdentity(options.identityMode);
  const pool = createPool(options.databaseUrl);
  const store = options.store ?? new PostgresOrchestrationStore(pool);
  const identity = new DevelopmentIdentity(
    options.actorId ?? 'dev-actor',
    options.organisationId ?? 'org_grounds_dev',
  );
  const app = Fastify({ logger: false });
  registerRoutes(app, store, identity, pool);
  app.addHook('onClose', async () => {
    await pool.end();
  });
  return { app, pool, store, identity };
}

function registerRoutes(
  app: FastifyInstance,
  store: OrchestrationStore,
  identity: IdentityProvider,
  pool: ReturnType<typeof createPool>,
): void {
  app.get('/health/live', () => ({ status: 'live' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      if (!(await isSchemaReady(pool))) {
        return await problem(
          reply,
          503,
          'Service Unavailable',
          'database migrations are not applied',
        );
      }
      return { status: 'ready' };
    } catch {
      return await problem(reply, 503, 'Service Unavailable', 'database unavailable');
    }
  });

  app.get('/v1/profiles', async () => {
    const profiles = await store.listProfiles(identity.organisationId());
    return {
      profiles: profiles.map((profile) => ({
        id: profile.id,
        profileId: profile.profileId,
        version: profile.version,
        scope: profile.scope,
        detectorVersions: profile.detectorVersions,
        freshnessPolicy: profile.freshnessPolicy,
      })),
    };
  });

  app.post('/v1/authorisations', async (request, reply) => {
    const key = requireIdempotencyKey(request, reply);
    if (!key) {
      return;
    }
    try {
      const record = jsonObject(request.body, 'body');
      let resourceScope;
      try {
        resourceScope = parseResourceRef(record['resourceScope']);
      } catch (error) {
        throw new ValidationError(
          error instanceof Error ? error.message : 'invalid resource scope',
        );
      }
      const window = jsonObject(record['evidenceWindow'], 'evidenceWindow');
      const created = await new CreateAuthorisation(store, identity).execute({
        profileVersionId: requiredString(record['profileVersionId'], 'profileVersionId'),
        resourceScope,
        evidenceWindow: {
          from: requiredString(window['from'], 'evidenceWindow.from'),
          to: requiredString(window['to'], 'evidenceWindow.to'),
        },
        clientIdempotencyKey: key,
      });
      return await reply.code(created.status).send(created.body);
    } catch (error) {
      return mapError(error, reply);
    }
  });

  app.post('/v1/runs', async (request, reply) => {
    const key = requireIdempotencyKey(request, reply);
    if (!key) {
      return;
    }
    try {
      const record = jsonObject(request.body, 'body');
      const created = await new EnqueueRunHttp(store, identity).execute({
        grantId: requiredString(record['grantId'], 'grantId'),
        clientIdempotencyKey: key,
      });
      return await reply.code(created.status).send(created.body);
    } catch (error) {
      return mapError(error, reply);
    }
  });

  app.get('/v1/runs', async () => {
    const runs = await store.listRuns(identity.organisationId());
    return {
      runs: runs.map((run) => ({
        id: run.id,
        state: run.state,
        result: run.result,
        resourceScope: run.resourceScope,
        evidenceWindow: run.evidenceWindow,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        terminalAt: run.terminalAt,
        profileVersionId: run.profileVersionId,
      })),
    };
  });

  app.get('/v1/runs/:id', async (request, reply) => {
    const parsed = IdParams.safeParse(request.params);
    if (!parsed.success) {
      return problem(reply, 400, 'Bad Request', 'id is required');
    }
    const run = await store.getRun(parsed.data.id);
    if (!run || run.organisationId !== identity.organisationId()) {
      return problem(reply, 404, 'Not Found', 'run not found');
    }
    const [steps, observations, findings, events] = await Promise.all([
      store.listSteps(run.id),
      store.listObservations(run.id),
      store.listFindings(run.id),
      store.listEvents('assurance_run', run.id),
    ]);
    return {
      run,
      steps,
      observations,
      findings,
      events,
    };
  });

  app.post('/v1/runs/:id/cancel', async (request, reply) => {
    const key = requireIdempotencyKey(request, reply);
    if (!key) {
      return;
    }
    const parsed = IdParams.safeParse(request.params);
    if (!parsed.success) {
      return problem(reply, 400, 'Bad Request', 'id is required');
    }
    try {
      await new CancelRun(store).execute(parsed.data.id, {
        organisationId: identity.organisationId(),
        actorId: identity.actorId(),
        clientIdempotencyKey: key,
      });
      const stored = await store.getHttpIdempotency({
        organisationId: identity.organisationId(),
        actorId: identity.actorId(),
        method: 'POST',
        route: `/v1/runs/${parsed.data.id}/cancel`,
        clientIdempotencyKey: key,
      });
      if (!stored) {
        throw new InvariantViolationError('cancel idempotency record missing after write');
      }
      const response = storedHttpResponse(stored);
      return await reply.code(response.status).send(response.body);
    } catch (error) {
      return mapError(error, reply);
    }
  });
}

export async function startApiFromEnv(env = process.env): Promise<void> {
  const parsed = Env.parse({
    DATABASE_URL: env['DATABASE_URL'],
    GROUNDS_IDENTITY_MODE: env['GROUNDS_IDENTITY_MODE'] ?? '',
    GROUNDS_DEV_ACTOR_ID: env['GROUNDS_DEV_ACTOR_ID'] ?? 'dev-actor',
    GROUNDS_DEV_ORGANISATION_ID: env['GROUNDS_DEV_ORGANISATION_ID'] ?? 'org_grounds_dev',
    GROUNDS_LISTEN_HOST: env['GROUNDS_LISTEN_HOST'] ?? '127.0.0.1',
    GROUNDS_LISTEN_PORT: env['GROUNDS_LISTEN_PORT'] ?? '3000',
  });
  const { app } = buildApi({
    databaseUrl: parsed.DATABASE_URL,
    identityMode: parsed.GROUNDS_IDENTITY_MODE,
    actorId: parsed.GROUNDS_DEV_ACTOR_ID,
    organisationId: parsed.GROUNDS_DEV_ORGANISATION_ID,
    host: parsed.GROUNDS_LISTEN_HOST,
    port: parsed.GROUNDS_LISTEN_PORT,
  });
  await app.listen({ host: parsed.GROUNDS_LISTEN_HOST, port: parsed.GROUNDS_LISTEN_PORT });
  log('info', 'api listening', {
    host: parsed.GROUNDS_LISTEN_HOST,
    port: parsed.GROUNDS_LISTEN_PORT,
  });
}
