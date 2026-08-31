import { createFixturePorts } from '@grounds/adapter-aws';
import { GrdEcs001, GrdObs001 } from '@grounds/detectors-ecs';
import { PostgresOrchestrationStore, createPool } from '@grounds/persistence-postgres';
import { WorkerLoop } from '@grounds/worker';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('DATABASE_URL is required');
}

const pool = createPool(url);
const store = new PostgresOrchestrationStore(pool);
const ports = createFixturePorts('healthy');
const worker = new WorkerLoop({
  store,
  inventory: ports.inventory,
  telemetry: ports.telemetry,
  workerId: process.env['GROUNDS_WORKER_ID'] ?? 'crash-child',
  leaseTtlSeconds: 1,
  crashAfterObservations: true,
  detectors: [new GrdEcs001(), new GrdObs001()],
});
try {
  await worker.runOnce();
} catch {
  await new Promise(() => undefined);
}
