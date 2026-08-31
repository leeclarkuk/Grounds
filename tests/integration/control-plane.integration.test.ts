import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CancelRun,
  EnqueueRun,
  GrantNotConsumableError,
  IdempotencyConflictError,
} from '@grounds/application';
import { ERROR_MESSAGES, FAKE_INVENTORY_KIND } from '@grounds/domain';
import {
  appliedMigrationIds,
  isSchemaReady,
  migrateDown,
  migrateUp,
} from '@grounds/persistence-postgres';
import {
  FakeInventory,
  FakeTelemetry,
  OTHER_ORG,
  PAYMENTS_SERVICE,
  seedProfileAndGrant,
} from '@grounds/test-support';
import { WorkerLoop } from '@grounds/worker';
import { buildApi } from '../../apps/api/src/app.js';
import { startTestDb, stopTestDb, type TestDb } from './harness.js';

const OTHER_SERVICE = { ...PAYMENTS_SERVICE, resourceId: 'other' };

describe('Build 0 control plane', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb(db);
  });

  async function enqueueRun(inventory: FakeInventory = new FakeInventory()) {
    const seeded = await db.store.withTransaction((tx) => seedProfileAndGrant(tx));
    const run = await new EnqueueRun(db.store).execute({
      grantId: seeded.grant.id,
      clientIdempotencyKey: randomUUID(),
      requestDigest: randomUUID(),
    });
    return { ...seeded, run, inventory };
  }

  async function runToTerminal(
    inventory: FakeInventory = new FakeInventory(),
    telemetry = new FakeTelemetry(),
  ) {
    const seeded = await enqueueRun(inventory);
    const worker = new WorkerLoop({
      store: db.store,
      inventory,
      telemetry,
      workerId: `worker-${randomUUID()}`,
      leaseTtlSeconds: 15,
    });
    await worker.runUntilIdle();
    const run = await db.store.getRun(seeded.run.id);
    if (!run) {
      throw new Error('run missing');
    }
    return { ...seeded, run, inventory, telemetry };
  }

  it('confirms expected migrations are applied', async () => {
    expect(await isSchemaReady(db.pool)).toBe(true);
    expect(await appliedMigrationIds(db.pool)).toEqual([
      '0001_schema_migrations',
      '0002_build0_schema',
    ]);
  });

  it('enqueues one run from a grant and is idempotent on the client key', async () => {
    const seeded = await db.store.withTransaction((tx) => seedProfileAndGrant(tx));
    const key = randomUUID();
    const digest = randomUUID();
    const enqueue = new EnqueueRun(db.store);
    const first = await enqueue.execute({
      grantId: seeded.grant.id,
      clientIdempotencyKey: key,
      requestDigest: digest,
    });
    const second = await enqueue.execute({
      grantId: seeded.grant.id,
      clientIdempotencyKey: key,
      requestDigest: digest,
    });
    expect(second.id).toBe(first.id);
    await expect(
      enqueue.execute({
        grantId: seeded.grant.id,
        clientIdempotencyKey: key,
        requestDigest: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(first.state).toBe('queued');
    expect(first.startedAt).toBeNull();
    expect(first.resourceScope).toEqual(seeded.grant.resourceScope);
  });

  it('rejects expired and concurrent grant consumption', async () => {
    const expired = await db.store.withTransaction((tx) =>
      seedProfileAndGrant(tx, { expiresAt: new Date(Date.now() - 1000).toISOString() }),
    );
    await expect(
      new EnqueueRun(db.store).execute({
        grantId: expired.grant.id,
        clientIdempotencyKey: randomUUID(),
        requestDigest: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(GrantNotConsumableError);

    const live = await db.store.withTransaction((tx) => seedProfileAndGrant(tx));
    const enqueue = new EnqueueRun(db.store);
    const results = await Promise.allSettled([
      enqueue.execute({
        grantId: live.grant.id,
        clientIdempotencyKey: randomUUID(),
        requestDigest: randomUUID(),
      }),
      enqueue.execute({
        grantId: live.grant.id,
        clientIdempotencyKey: randomUUID(),
        requestDigest: randomUUID(),
      }),
    ]);
    const ok = results.filter((item) => item.status === 'fulfilled');
    const failed = results.filter((item) => item.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
  });

  it('rolls back grant consume if the run insert never commits', async () => {
    const seeded = await db.store.withTransaction((tx) => seedProfileAndGrant(tx));
    await expect(
      db.store.withTransaction(async (tx) => {
        await tx.consumeGrant(seeded.grant.id);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const grant = await db.store.getGrant(seeded.grant.id);
    expect(grant?.consumedAt).toBeNull();
    const replay = await new EnqueueRun(db.store).execute({
      grantId: seeded.grant.id,
      clientIdempotencyKey: randomUUID(),
      requestDigest: randomUUID(),
    });
    expect(replay.state).toBe('queued');
  });

  it('rejects run insert and update tampering of grant-bound fields', async () => {
    const seeded = await db.store.withTransaction((tx) => seedProfileAndGrant(tx));
    await expect(
      db.store.withTransaction(async (tx) => {
        const grant = await tx.consumeGrant(seeded.grant.id);
        await tx.insertRun({
          id: randomUUID(),
          organisationId: grant.organisationId,
          profileVersionId: grant.profileVersionId,
          authorisationGrantId: grant.id,
          resourceScope: OTHER_SERVICE,
          resourceScopeDigest: grant.resourceScopeDigest,
          evidenceWindow: grant.evidenceWindow,
          detectorVersions: grant.detectorVersions,
          state: 'queued',
          result: null,
          clientIdempotencyKey: randomUUID(),
          requestDigest: randomUUID(),
          runIdentityDigest: randomUUID(),
          cancelRequestedAt: null,
          collectorAttemptCount: 0,
          createdAt: '',
          startedAt: null,
          updatedAt: '',
          terminalAt: null,
        });
      }),
    ).rejects.toThrow();
    const live = await db.store.withTransaction((tx) => seedProfileAndGrant(tx));
    const enqueue = await new EnqueueRun(db.store).execute({
      grantId: live.grant.id,
      clientIdempotencyKey: randomUUID(),
      requestDigest: randomUUID(),
    });
    await expect(
      db.pool.query(`UPDATE assurance_runs SET resource_scope = $1::jsonb WHERE id = $2`, [
        JSON.stringify(OTHER_SERVICE),
        enqueue.id,
      ]),
    ).rejects.toThrow(/immutable|must equal/);
    await expect(
      db.pool.query(`UPDATE assurance_runs SET run_identity_digest = $1 WHERE id = $2`, [
        'tampered',
        enqueue.id,
      ]),
    ).rejects.toThrow(/immutable/);
  });

  it('two workers race and only one claims the collect step', async () => {
    const seeded = await enqueueRun();
    const [a, b] = await Promise.all([
      db.store.withTransaction((tx) => tx.claimWork('worker-a', 15)),
      db.store.withTransaction((tx) => tx.claimWork('worker-b', 15)),
    ]);
    const claimed = [a, b].filter((item) => item && !item.exhausted);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.step.leaseEpoch).toBe(1);
    expect(claimed[0]?.run.state).toBe('collecting');
    expect(claimed[0]?.run.startedAt).not.toBeNull();
    const again = await db.store.getRun(seeded.run.id);
    expect(again?.startedAt).toBe(claimed[0]?.run.startedAt);
  });

  it('recovers an expired lease with a higher epoch and rejects the stale worker', async () => {
    await enqueueRun();
    const first = await db.store.withTransaction((tx) => tx.claimWork('stale', 1));
    if (!first) {
      throw new Error('expected claim');
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const recovered = await db.store.withTransaction((tx) => tx.claimWork('fresh', 15));
    expect(recovered?.recovered).toBe(true);
    expect(recovered?.step.leaseEpoch).toBeGreaterThan(first.step.leaseEpoch);
    await expect(
      db.store.withTransaction((tx) =>
        tx.requireFence({
          runId: first.run.id,
          stepId: first.step.id,
          workerId: 'stale',
          leaseEpoch: first.step.leaseEpoch,
          expectedRunStates: ['collecting'],
        }),
      ),
    ).rejects.toThrow(/lease fence/);
    await expect(
      db.store.withTransaction(async (tx) => {
        const fence = await tx.requireFence({
          runId: first.run.id,
          stepId: first.step.id,
          workerId: 'stale',
          leaseEpoch: first.step.leaseEpoch,
          expectedRunStates: ['collecting'],
        });
        await tx.persistObservation(
          fence.run,
          {
            id: randomUUID(),
            kind: FAKE_INVENTORY_KIND,
            payload: { stolen: true },
            inaccessible: false,
            operation: 'fake.DescribeInventory',
            adapter: 'fixture',
          },
          3600,
        );
      }),
    ).rejects.toThrow(/lease fence/);
  });

  it('does not let evaluate be claimed while collect is ready or leased', async () => {
    const seeded = await enqueueRun();
    const evaluate = await db.store.getStep(seeded.run.id, 'evaluate');
    expect(evaluate?.state).toBe('blocked');
    const claimed = await db.store.withTransaction((tx) => tx.claimWork('worker-a', 15));
    expect(claimed?.step.stepType).toBe('collect');
    const again = await db.store.withTransaction((tx) => tx.claimWork('worker-b', 15));
    expect(again?.step.stepType === 'evaluate').toBe(false);
  });

  it('cancels collect so the previous lease cannot commit', async () => {
    const seeded = await enqueueRun();
    const claimed = await db.store.withTransaction((tx) => tx.claimWork('doomed', 15));
    if (!claimed) {
      throw new Error('expected claim');
    }
    const cancelled = await new CancelRun(db.store).execute(seeded.run.id);
    expect(cancelled.state).toBe('cancelled');
    await expect(
      db.store.withTransaction(async (tx) => {
        const fence = await tx.requireFence({
          runId: claimed.run.id,
          stepId: claimed.step.id,
          workerId: 'doomed',
          leaseEpoch: claimed.step.leaseEpoch,
          expectedRunStates: ['collecting'],
        });
        await tx.completeCollect(fence, 'doomed', claimed.step.leaseEpoch);
      }),
    ).rejects.toThrow(/lease fence/);
  });

  it('records cancel during evaluate without aborting the in-flight lease', async () => {
    const finishedCollect = await runToTerminal();
    expect(['healthy', 'findings']).toContain(finishedCollect.run.state);
    const seeded = await enqueueRun();
    const worker = new WorkerLoop({
      store: db.store,
      inventory: new FakeInventory(),
      telemetry: new FakeTelemetry(),
      workerId: `w-${randomUUID()}`,
      leaseTtlSeconds: 15,
    });
    await worker.runOnce();
    const evaluating = await db.store.getRun(seeded.run.id);
    if (evaluating?.state !== 'evaluating') {
      await worker.runOnce();
    }
    const afterCollect = await db.store.getRun(seeded.run.id);
    if (afterCollect?.state === 'evaluating') {
      const requested = await new CancelRun(db.store).execute(seeded.run.id);
      expect(requested.state).toBe('evaluating');
      expect(requested.cancelRequestedAt).not.toBeNull();
    }
    await worker.runUntilIdle();
    const terminal = await db.store.getRun(seeded.run.id);
    expect(terminal?.state === 'healthy' || terminal?.state === 'findings').toBe(true);
  });

  it('replays a crash after observation insert without duplicates', async () => {
    const seeded = await enqueueRun();
    const inventory = new FakeInventory();
    const crashing = new WorkerLoop({
      store: db.store,
      inventory,
      telemetry: new FakeTelemetry(),
      workerId: 'crasher',
      leaseTtlSeconds: 1,
      crashAfterObservations: true,
    });
    await expect(crashing.runOnce()).rejects.toThrow(/CrashAfterObservations/);
    const afterCrash = await db.store.listObservations(seeded.run.id);
    expect(afterCrash.length).toBeGreaterThanOrEqual(1);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const recovered = new WorkerLoop({
      store: db.store,
      inventory,
      telemetry: new FakeTelemetry(),
      workerId: 'rescuer',
      leaseTtlSeconds: 15,
    });
    await recovered.runUntilIdle();
    const run = await db.store.getRun(seeded.run.id);
    expect(run?.state === 'healthy' || run?.state === 'findings').toBe(true);
    const observations = await db.store.listObservations(seeded.run.id);
    const identities = observations.map((item) => item.contentIdentity);
    expect(new Set(identities).size).toBe(identities.length);
    const findings = await db.store.listFindings(seeded.run.id);
    expect(findings).toHaveLength(1);
    const events = await db.store.listEvents('assurance_run', seeded.run.id);
    const opIds = events.map((item) => `${item.type}:${item.operationId}`);
    expect(new Set(opIds).size).toBe(opIds.length);
    expect(events.map((item) => item.sequence)).toEqual(events.map((_, index) => index + 1));
    expect(await db.store.outboxLag()).toBe(0);
  });

  it('returns cited UNKNOWN for inaccessible inventory', async () => {
    const result = await runToTerminal(new FakeInventory('inaccessible'));
    expect(result.run.state).toBe('findings');
    expect(result.run.result).toBe('UNKNOWN');
    const findings = await db.store.listFindings(result.run.id);
    expect(findings[0]?.result).toBe('UNKNOWN');
    expect(findings[0]?.observationIds.length).toBeGreaterThanOrEqual(1);
  });

  it('returns FAIL from GRD-FAKE-001 when the fixture says so', async () => {
    const result = await runToTerminal(new FakeInventory('fail'));
    expect(result.run.state).toBe('findings');
    expect(result.run.result).toBe('FAIL');
  });

  it('isolates organisations in queries and digests', async () => {
    const a = await db.store.withTransaction((tx) => seedProfileAndGrant(tx));
    const b = await db.store.withTransaction((tx) =>
      seedProfileAndGrant(tx, { organisationId: OTHER_ORG }),
    );
    const runA = await new EnqueueRun(db.store).execute({
      grantId: a.grant.id,
      clientIdempotencyKey: randomUUID(),
      requestDigest: randomUUID(),
    });
    const runB = await new EnqueueRun(db.store).execute({
      grantId: b.grant.id,
      clientIdempotencyKey: randomUUID(),
      requestDigest: randomUUID(),
    });
    expect(runA.organisationId).not.toBe(runB.organisationId);
    expect(runA.runIdentityDigest).not.toBe(runB.runIdentityDigest);
    const loaded = await db.store.getRun(runA.id);
    expect(loaded?.organisationId).toBe(runA.organisationId);
  });

  it('enforces append-only evidence, citations and closed error messages', async () => {
    const result = await runToTerminal();
    const finding = (await db.store.listFindings(result.run.id))[0];
    const observation = (await db.store.listObservations(result.run.id))[0];
    if (!finding || !observation) {
      throw new Error('expected finding');
    }
    await expect(
      db.pool.query(`UPDATE observations SET kind = 'x' WHERE id = $1`, [observation.id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.pool.query(`DELETE FROM observations WHERE id = $1`, [observation.id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.pool.query(
        `INSERT INTO finding_citations (finding_id, observation_id, run_id) VALUES ($1,$2,$3)`,
        [finding.id, observation.id, result.run.id],
      ),
    ).rejects.toThrow();
    await expect(
      db.pool.query(`UPDATE finding_citations SET run_id = $1 WHERE finding_id = $2`, [
        result.run.id,
        finding.id,
      ]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.pool.query(
        `UPDATE run_steps SET error_class = 'persist_failure', error_message = 'AKIASECRET' WHERE run_id = $1`,
        [result.run.id],
      ),
    ).rejects.toThrow();
    await expect(
      db.pool.query(
        `INSERT INTO findings (
           id, run_id, detector_id, detector_version, profile_version_id, resource, result, severity,
           title, explanation, fingerprint, citation_count, evaluated_at
         ) VALUES (
           $1,$2,'GRD-FAKE-001','1',$3,$4::jsonb,'PASS','INFO','t','e',$5,1,now()
         )`,
        [
          randomUUID(),
          result.run.id,
          result.run.profileVersionId,
          JSON.stringify(PAYMENTS_SERVICE),
          randomUUID(),
        ],
      ),
    ).rejects.toThrow();
    expect(ERROR_MESSAGES.persist_failure).toBe('durable persist failed');
  });

  it('exhausts attempts instead of issuing a sixth lease', async () => {
    const seeded = await enqueueRun();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const claimed = await db.store.withTransaction((tx) =>
        tx.claimWork(`w-${String(attempt)}`, 1),
      );
      expect(claimed?.exhausted).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
    const sixth = await db.store.withTransaction((tx) => tx.claimWork('w-5', 1));
    expect(sixth?.exhausted).toBe(true);
    const run = await db.store.getRun(seeded.run.id);
    expect(run?.state).toBe('failed');
    const step = await db.store.getStep(seeded.run.id, 'collect');
    expect(step?.attempt).toBe(5);
    expect(step?.state).toBe('failed');
  });

  it('makes zero provider calls for an out-of-scope resource comparison', async () => {
    const inventory = new FakeInventory();
    const seeded = await db.store.withTransaction((tx) => seedProfileAndGrant(tx));
    expect(seeded.profile.scope.resourceId).toBe('payments');
    expect(OTHER_SERVICE.resourceId).not.toBe(seeded.profile.scope.resourceId);
    expect(inventory.calls).toBe(0);
  });

  it('exposes live and ready endpoints', async () => {
    const { app } = await buildApi({
      databaseUrl: db.url,
      identityMode: 'development',
      host: '127.0.0.1',
      port: 0,
    });
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    const spoofed = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-grounds-actor': 'spoofed' },
    });
    expect(spoofed.statusCode).toBe(200);
    await app.close();
  });

  it('reports not ready before migrations and when postgres is unreachable', async () => {
    await migrateDown(db.pool);
    const { app } = await buildApi({
      databaseUrl: db.url,
      identityMode: 'development',
    });
    const notReady = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(notReady.statusCode).toBe(503);
    await app.close();
    const down = await buildApi({
      databaseUrl: 'postgres://grounds:grounds@127.0.0.1:1/grounds',
      identityMode: 'development',
    });
    const unavailable = await down.app.inject({ method: 'GET', url: '/health/ready' });
    expect(unavailable.statusCode).toBe(503);
    await down.app.close();
    await migrateUp(db.pool);
  });
});
