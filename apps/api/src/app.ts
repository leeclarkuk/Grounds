import Fastify from 'fastify';
import { z } from 'zod';

import { log } from '@grounds/observability';
import { createPool, isSchemaReady } from '@grounds/persistence-postgres';

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  GROUNDS_IDENTITY_MODE: z.string(),
  GROUNDS_LISTEN_HOST: z.string().default('127.0.0.1'),
  GROUNDS_LISTEN_PORT: z.coerce.number().int().positive().default(3000),
});

export type ApiOptions = {
  readonly databaseUrl: string;
  readonly identityMode: string;
  readonly host?: string;
  readonly port?: number;
};

export function assertDevelopmentIdentity(identityMode: string): void {
  if (identityMode !== 'development') {
    throw new Error('API refuses to listen unless GROUNDS_IDENTITY_MODE=development');
  }
}

export function buildApi(options: ApiOptions) {
  assertDevelopmentIdentity(options.identityMode);
  const pool = createPool(options.databaseUrl);
  const app = Fastify({ logger: false });
  app.get('/health/live', () => ({ status: 'live' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      if (!(await isSchemaReady(pool))) {
        return await reply.code(503).type('application/problem+json').send({
          type: 'about:blank',
          title: 'Service Unavailable',
          status: 503,
          detail: 'database migrations are not applied',
        });
      }
      return { status: 'ready' };
    } catch {
      return await reply.code(503).type('application/problem+json').send({
        type: 'about:blank',
        title: 'Service Unavailable',
        status: 503,
        detail: 'database unavailable',
      });
    }
  });
  app.addHook('onClose', async () => {
    await pool.end();
  });
  return { app, pool };
}

export async function startApiFromEnv(env = process.env): Promise<void> {
  const parsed = Env.parse({
    DATABASE_URL: env['DATABASE_URL'],
    GROUNDS_IDENTITY_MODE: env['GROUNDS_IDENTITY_MODE'] ?? '',
    GROUNDS_LISTEN_HOST: env['GROUNDS_LISTEN_HOST'] ?? '127.0.0.1',
    GROUNDS_LISTEN_PORT: env['GROUNDS_LISTEN_PORT'] ?? '3000',
  });
  const { app } = buildApi({
    databaseUrl: parsed.DATABASE_URL,
    identityMode: parsed.GROUNDS_IDENTITY_MODE,
    host: parsed.GROUNDS_LISTEN_HOST,
    port: parsed.GROUNDS_LISTEN_PORT,
  });
  await app.listen({ host: parsed.GROUNDS_LISTEN_HOST, port: parsed.GROUNDS_LISTEN_PORT });
  log('info', 'api listening', {
    host: parsed.GROUNDS_LISTEN_HOST,
    port: parsed.GROUNDS_LISTEN_PORT,
  });
}
