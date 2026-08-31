import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CancelRun, EnqueueRun } from '@grounds/application';
import type { CollectContext, ResourceInventoryPort, TelemetryPort } from '@grounds/application';
import { GrdEcs001, GrdObs001 } from '@grounds/detectors-ecs';
import { seedEcsProfileAndGrant, seedProfileAndGrant } from '@grounds/test-support';
import { WorkerLoop } from '@grounds/worker';
import { isSchemaReady, migrateUp } from '@grounds/persistence-postgres';
import { buildApi } from '../../apps/api/src/app.js';
import { resetDomainTables, startTestDb, stopTestDb, type TestDb } from './harness.js';

describe('Build 1 HTTP API', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb(db);
  });

  beforeEach(async () => {
    if (await isSchemaReady(db.pool)) {
      await resetDomainTables(db.pool);
    } else {
      await migrateUp(db.pool);
    }
  });

  async function api() {
    return buildApi({
      databaseUrl: db.url,
      identityMode: 'development',
      actorId: 'dev-actor',
      organisationId: 'org_grounds_dev',
      store: db.store,
    });
  }

  it('ignores a spoofed actor header and uses the server actor', async () => {
    const seeded = await db.store.withTransaction((tx) => seedEcsProfileAndGrant(tx));
    const { app } = await api();
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date().toISOString();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/authorisations',
      headers: { 'idempotency-key': randomUUID(), 'x-grounds-actor': 'spoofed' },
      payload: {
        profileVersionId: seeded.profile.id,
        resourceScope: seeded.profile.scope,
        evidenceWindow: { from, to },
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { id: string };
    const grant = await db.store.getGrant(body.id);
    expect(grant?.actorId).toBe('dev-actor');
    await app.close();
  });

  it('replays authorisation idempotency and conflicts on digest change', async () => {
    const seeded = await db.store.withTransaction((tx) => seedEcsProfileAndGrant(tx));
    const { app } = await api();
    const key = randomUUID();
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date().toISOString();
    const payload = {
      profileVersionId: seeded.profile.id,
      resourceScope: seeded.profile.scope,
      evidenceWindow: { from, to },
    };
    const first = await app.inject({
      method: 'POST',
      url: '/v1/authorisations',
      headers: { 'idempotency-key': key },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/authorisations',
      headers: { 'idempotency-key': key },
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect((second.json() as { id: string }).id).toBe((first.json() as { id: string }).id);
    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/authorisations',
      headers: { 'idempotency-key': key },
      payload: {
        ...payload,
        evidenceWindow: { from, to: new Date(Date.parse(to) - 1_000).toISOString() },
      },
    });
    expect(conflict.statusCode).toBe(409);
    await app.close();
  });

  it('replays concurrent authorisation, enqueue and cancel keys without duplicates', async () => {
    const seeded = await db.store.withTransaction((tx) => seedEcsProfileAndGrant(tx));
    const { app } = await api();
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date().toISOString();
    const authKey = randomUUID();
    const payload = {
      profileVersionId: seeded.profile.id,
      resourceScope: seeded.profile.scope,
      evidenceWindow: { from, to },
    };
    const auth = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/authorisations',
        headers: { 'idempotency-key': authKey },
        payload,
      }),
      app.inject({
        method: 'POST',
        url: '/v1/authorisations',
        headers: { 'idempotency-key': authKey },
        payload,
      }),
    ]);
    const statuses = auth.map((item) => item.statusCode).sort();
    expect(statuses[0] === 200 || statuses[0] === 201).toBe(true);
    expect(statuses[1] === 200 || statuses[1] === 201).toBe(true);
    expect((auth[0]?.json() as { id: string }).id).toBe((auth[1]?.json() as { id: string }).id);
    const grantId = (auth[0]?.json() as { id: string }).id;
    const runKey = randomUUID();
    const runs = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/runs',
        headers: { 'idempotency-key': runKey },
        payload: { grantId },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/runs',
        headers: { 'idempotency-key': runKey },
        payload: { grantId },
      }),
    ]);
    expect((runs[0]?.json() as { id: string }).id).toBe((runs[1]?.json() as { id: string }).id);
    const runId = (runs[0]?.json() as { id: string }).id;
    const cancelKey = randomUUID();
    const cancels = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/v1/runs/${runId}/cancel`,
        headers: { 'idempotency-key': cancelKey },
      }),
      app.inject({
        method: 'POST',
        url: `/v1/runs/${runId}/cancel`,
        headers: { 'idempotency-key': cancelKey },
      }),
    ]);
    expect(cancels.every((item) => item.statusCode === 200)).toBe(true);
    await app.close();
  });

  it('cancels during collect so later commits are fenced', async () => {
    const seeded = await db.store.withTransaction((tx) => seedProfileAndGrant(tx));
    const { app } = await api();
    const run = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { 'idempotency-key': randomUUID() },
      payload: { grantId: seeded.grant.id },
    });
    expect(run.statusCode).toBe(201);
    const id = (run.json() as { id: string }).id;
    const cancel = await app.inject({
      method: 'POST',
      url: `/v1/runs/${id}/cancel`,
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(cancel.statusCode).toBe(200);
    const detail = await app.inject({ method: 'GET', url: `/v1/runs/${id}` });
    expect((detail.json() as { run: { state: string } }).run.state).toBe('cancelled');
    await app.close();
  });

  it('cancels during pagination so later observation commits are fenced', async () => {
    const seeded = await db.store.withTransaction((tx) => seedEcsProfileAndGrant(tx));
    const run = await new EnqueueRun(db.store).execute({
      grantId: seeded.grant.id,
      clientIdempotencyKey: randomUUID(),
      requestDigest: randomUUID(),
    });
    let pages = 0;
    const inventory: ResourceInventoryPort = {
      collect: async (context: CollectContext) => {
        pages += 1;
        await context.onPage();
        await new CancelRun(db.store).execute(run.id);
        pages += 1;
        await context.onPage();
        return [];
      },
    };
    const telemetry: TelemetryPort = { collect: async () => [] };
    const worker = new WorkerLoop({
      store: db.store,
      inventory,
      telemetry,
      workerId: 'pager',
      leaseTtlSeconds: 15,
      detectors: [new GrdEcs001(), new GrdObs001()],
    });
    await worker.runOnce();
    const terminal = await db.store.getRun(run.id);
    const observations = await db.store.listObservations(run.id);
    expect(terminal?.state).toBe('cancelled');
    expect(observations).toHaveLength(0);
    expect(pages).toBeGreaterThanOrEqual(1);
  });
});
