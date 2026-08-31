#!/usr/bin/env node
import { createPool, migrateUp, PostgresOrchestrationStore } from '@grounds/persistence-postgres';
import { DEV_ORG, seedEcsProfile } from '@grounds/test-support';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('DATABASE_URL is required');
}

const pool = createPool(url);
await migrateUp(pool);
const store = new PostgresOrchestrationStore(pool);
const existing = await store.listProfiles(DEV_ORG);
if (existing.some((profile) => profile.profileId === 'ecs-payments')) {
  await pool.end();
  process.stdout.write('ecs-payments profile already present\n');
  process.exit(0);
}
await store.withTransaction((tx) => seedEcsProfile(tx));
await pool.end();
process.stdout.write('seeded ecs-payments profile version 1\n');
