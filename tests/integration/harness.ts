import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

import { PostgresOrchestrationStore } from '@grounds/persistence-postgres';
import { createPool, migrateUp } from '@grounds/persistence-postgres';

export type TestDb = {
  readonly container: StartedPostgreSqlContainer;
  readonly pool: pg.Pool;
  readonly store: PostgresOrchestrationStore;
  readonly url: string;
};

export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:16.10-alpine').start();
  const url = container.getConnectionUri();
  const pool = createPool(url);
  await migrateUp(pool);
  return { container, pool, store: new PostgresOrchestrationStore(pool), url };
}

export async function stopTestDb(db: TestDb): Promise<void> {
  await db.pool.end();
  await db.container.stop();
}
