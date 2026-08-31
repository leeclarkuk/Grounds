import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Pool, PoolClient } from 'pg';

export const EXPECTED_BUILD0_MIGRATIONS = ['0001_schema_migrations', '0002_build0_schema'] as const;

export function resolveMigrationsDir(): string {
  const fromEnv = process.env['GROUNDS_MIGRATIONS_DIR'];
  if (fromEnv && existsSync(join(fromEnv, '0001_schema_migrations.up.sql'))) {
    return fromEnv;
  }
  let current = process.cwd();
  for (let index = 0; index < 10; index += 1) {
    const candidate = join(current, 'migrations');
    if (existsSync(join(candidate, '0001_schema_migrations.up.sql'))) {
      return candidate;
    }
    current = dirname(current);
  }
  const fromModule = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations');
  if (existsSync(join(fromModule, '0001_schema_migrations.up.sql'))) {
    return fromModule;
  }
  throw new Error('migrations directory not found');
}

export async function appliedMigrationIds(client: Pool | PoolClient): Promise<string[]> {
  const exists = await client.query<{ t: string | null }>(
    `SELECT to_regclass('public.schema_migrations') AS t`,
  );
  if (!exists.rows[0]?.t) {
    return [];
  }
  const rows = await client.query<{ id: string }>(`SELECT id FROM schema_migrations ORDER BY id`);
  return rows.rows.map((row) => row.id);
}

export async function isSchemaReady(client: Pool | PoolClient): Promise<boolean> {
  const applied = await appliedMigrationIds(client);
  return EXPECTED_BUILD0_MIGRATIONS.every((id) => applied.includes(id));
}

export async function migrateUp(pool: Pool, migrationsDir = resolveMigrationsDir()): Promise<void> {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.up.sql'))
    .sort();
  const client = await pool.connect();
  try {
    for (const file of files) {
      const id = file.replace(/\.up\.sql$/, '');
      const applied = await appliedMigrationIds(client);
      if (applied.includes(id)) {
        continue;
      }
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        if (id !== '0001_schema_migrations') {
          await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [id]);
        } else {
          await client.query(
            `INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING`,
            [id],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

export async function migrateDown(
  pool: Pool,
  migrationsDir = resolveMigrationsDir(),
): Promise<void> {
  const client = await pool.connect();
  try {
    const applied = await appliedMigrationIds(client);
    for (const id of [...applied].reverse()) {
      const sql = readFileSync(join(migrationsDir, `${id}.down.sql`), 'utf8');
      await client.query('BEGIN');
      try {
        if (id === '0001_schema_migrations') {
          await client.query(sql);
        } else {
          await client.query(sql);
          await client.query(`DELETE FROM schema_migrations WHERE id = $1`, [id]);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
  }
}
