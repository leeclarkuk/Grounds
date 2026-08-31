import { z } from 'zod';

import { log } from '@grounds/observability';
import { createPool, PostgresOrchestrationStore } from '@grounds/persistence-postgres';
import { FakeInventory, FakeTelemetry } from '@grounds/test-support';

import { WorkerLoop } from './loop.js';

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  GROUNDS_IDENTITY_MODE: z.literal('development'),
  GROUNDS_PROVIDER: z.literal('fixture'),
  GROUNDS_WORKER_ID: z.string().default('worker-1'),
  GROUNDS_LEASE_TTL_SECONDS: z.coerce.number().int().positive().default(15),
  GROUNDS_CRASH_AFTER_OBSERVATIONS: z.string().optional(),
});

export async function startWorkerFromEnv(env = process.env): Promise<void> {
  const parsed = Env.parse({
    DATABASE_URL: env['DATABASE_URL'],
    GROUNDS_IDENTITY_MODE: env['GROUNDS_IDENTITY_MODE'],
    GROUNDS_PROVIDER: env['GROUNDS_PROVIDER'] ?? 'fixture',
    GROUNDS_WORKER_ID: env['GROUNDS_WORKER_ID'] ?? 'worker-1',
    GROUNDS_LEASE_TTL_SECONDS: env['GROUNDS_LEASE_TTL_SECONDS'] ?? '15',
    GROUNDS_CRASH_AFTER_OBSERVATIONS: env['GROUNDS_CRASH_AFTER_OBSERVATIONS'],
  });
  const pool = createPool(parsed.DATABASE_URL);
  const store = new PostgresOrchestrationStore(pool);
  const worker = new WorkerLoop({
    store,
    inventory: new FakeInventory(),
    telemetry: new FakeTelemetry(),
    workerId: parsed.GROUNDS_WORKER_ID,
    leaseTtlSeconds: parsed.GROUNDS_LEASE_TTL_SECONDS,
    crashAfterObservations: parsed.GROUNDS_CRASH_AFTER_OBSERVATIONS === '1',
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
