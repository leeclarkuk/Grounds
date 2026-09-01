import { z } from 'zod';

import { createFixturePorts, createLivePorts, DEFAULT_ALLOWED_SCOPE } from '@grounds/adapter-aws';
import { GrdEcs001, GrdObs001 } from '@grounds/detectors-ecs';
import { log } from '@grounds/observability';
import { createPool, PostgresOrchestrationStore } from '@grounds/persistence-postgres';
import { GrdFake001 } from '@grounds/test-support';

import { WorkerLoop } from './loop.js';

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  GROUNDS_IDENTITY_MODE: z.literal('development'),
  GROUNDS_PROVIDER: z.enum(['fixture', 'aws']).default('fixture'),
  GROUNDS_FIXTURE_SCENARIO: z
    .enum([
      'healthy',
      'unhealthy-replacement',
      'missing-alarm',
      'partial-failure',
      'stale-metrics',
      'cross-scope',
      'pagination',
      'throttling',
    ])
    .default('healthy'),
  GROUNDS_WORKER_ID: z.string().default('worker-1'),
  GROUNDS_LEASE_TTL_SECONDS: z.coerce.number().int().positive().default(15),
  GROUNDS_AWS_ROLE_ARN: z.string().optional(),
  GROUNDS_AWS_EXTERNAL_ID: z.string().optional(),
  GROUNDS_AWS_REGION: z.string().default('eu-west-2'),
  GROUNDS_ALLOWED_ACCOUNT_ID: z.string().default(DEFAULT_ALLOWED_SCOPE.accountId),
  GROUNDS_ALLOWED_RESOURCE_ID: z.string().default(DEFAULT_ALLOWED_SCOPE.resourceId),
});

export async function startWorkerFromEnv(env = process.env): Promise<void> {
  const parsed = Env.parse({
    DATABASE_URL: env['DATABASE_URL'],
    GROUNDS_IDENTITY_MODE: env['GROUNDS_IDENTITY_MODE'],
    GROUNDS_PROVIDER: env['GROUNDS_PROVIDER'] ?? 'fixture',
    GROUNDS_FIXTURE_SCENARIO: env['GROUNDS_FIXTURE_SCENARIO'] ?? 'healthy',
    GROUNDS_WORKER_ID: env['GROUNDS_WORKER_ID'] ?? 'worker-1',
    GROUNDS_LEASE_TTL_SECONDS: env['GROUNDS_LEASE_TTL_SECONDS'] ?? '15',
    GROUNDS_AWS_ROLE_ARN: env['GROUNDS_AWS_ROLE_ARN'],
    GROUNDS_AWS_EXTERNAL_ID: env['GROUNDS_AWS_EXTERNAL_ID'],
    GROUNDS_AWS_REGION: env['GROUNDS_AWS_REGION'] ?? 'eu-west-2',
    GROUNDS_ALLOWED_ACCOUNT_ID:
      env['GROUNDS_ALLOWED_ACCOUNT_ID'] ?? DEFAULT_ALLOWED_SCOPE.accountId,
    GROUNDS_ALLOWED_RESOURCE_ID:
      env['GROUNDS_ALLOWED_RESOURCE_ID'] ?? DEFAULT_ALLOWED_SCOPE.resourceId,
  });
  if (parsed.GROUNDS_PROVIDER === 'aws') {
    if (!parsed.GROUNDS_AWS_ROLE_ARN || !parsed.GROUNDS_AWS_EXTERNAL_ID) {
      throw new Error('live AWS requires GROUNDS_AWS_ROLE_ARN and GROUNDS_AWS_EXTERNAL_ID');
    }
  }
  const allowedScope = {
    provider: 'aws' as const,
    accountId: parsed.GROUNDS_ALLOWED_ACCOUNT_ID,
    region: parsed.GROUNDS_AWS_REGION,
    service: 'ecs' as const,
    resourceType: 'service' as const,
    resourceId: parsed.GROUNDS_ALLOWED_RESOURCE_ID,
  };
  const pool = createPool(parsed.DATABASE_URL);
  const store = new PostgresOrchestrationStore(pool);
  const ports =
    parsed.GROUNDS_PROVIDER === 'aws'
      ? createLivePorts({
          roleArn: parsed.GROUNDS_AWS_ROLE_ARN ?? '',
          externalId: parsed.GROUNDS_AWS_EXTERNAL_ID ?? '',
          region: parsed.GROUNDS_AWS_REGION,
          allowedScope,
        })
      : createFixturePorts(parsed.GROUNDS_FIXTURE_SCENARIO, allowedScope);
  const worker = new WorkerLoop({
    store,
    inventory: ports.inventory,
    telemetry: ports.telemetry,
    workerId: parsed.GROUNDS_WORKER_ID,
    leaseTtlSeconds: parsed.GROUNDS_LEASE_TTL_SECONDS,
    detectors: [new GrdFake001(), new GrdEcs001(), new GrdObs001()],
  });
  log('info', 'worker started', { workerId: parsed.GROUNDS_WORKER_ID });
  const shutdown = (): void => {
    worker.stop();
    void pool.end();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  for (;;) {
    await worker.runOnce();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

await startWorkerFromEnv();
