import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import {
  createPool,
  PostgresOrchestrationStore,
  migrateUp,
  type Pool,
} from '@grounds/persistence-postgres';

export type TestDb = {
  readonly container: StartedPostgreSqlContainer | undefined;
  readonly pool: Pool;
  readonly store: PostgresOrchestrationStore;
  readonly url: string;
  readonly adminUrl?: string;
  readonly databaseName?: string;
};

export async function startTestDb(): Promise<TestDb> {
  const configured = process.env['GROUNDS_TEST_DATABASE_URL'];
  if (configured) {
    const admin = createPool(configured);
    const name = `grounds_it_${String(Date.now())}`;
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = configured.replace(/\/[^/]+$/, `/${name}`);
    const pool = createPool(url);
    await migrateUp(pool);
    return {
      container: undefined,
      pool,
      store: new PostgresOrchestrationStore(pool),
      url,
      adminUrl: configured,
      databaseName: name,
    };
  }
  const container = await new PostgreSqlContainer('postgres:16.10-alpine').start();
  const url = container.getConnectionUri();
  const pool = createPool(url);
  await migrateUp(pool);
  return { container, pool, store: new PostgresOrchestrationStore(pool), url };
}

export async function resetDomainTables(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE finding_citations, findings, observations, events, outbox, cases,
             run_steps, assurance_runs, authorisation_grants, profile_versions, http_idempotency
    RESTART IDENTITY CASCADE
  `);
}

export async function stopTestDb(db: TestDb | undefined): Promise<void> {
  if (!db) {
    return;
  }
  await db.pool.end();
  if (db.container) {
    await db.container.stop();
  }
  if (db.adminUrl && db.databaseName) {
    const admin = createPool(db.adminUrl);
    await admin.query(`DROP DATABASE IF EXISTS ${db.databaseName}`);
    await admin.end();
  }
}
