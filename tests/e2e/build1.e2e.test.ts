import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EnqueueRun } from '@grounds/application';
import { createFixturePorts } from '@grounds/adapter-aws';
import { GrdEcs001, GrdObs001 } from '@grounds/detectors-ecs';
import { CW_RUNNING_TASK_METRIC_KIND, OutOfScopeError } from '@grounds/domain';
import { PAYMENTS_SERVICE, seedEcsProfileAndGrant } from '@grounds/test-support';
import { WorkerLoop } from '@grounds/worker';
import { isSchemaReady, migrateUp } from '@grounds/persistence-postgres';
import { resetDomainTables, startTestDb, stopTestDb, type TestDb } from '../integration/harness.js';

describe('Build 1 fixture end to end', () => {
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

  async function runScenario(
    scenario:
      | 'healthy'
      | 'unhealthy-replacement'
      | 'partial-failure'
      | 'missing-alarm'
      | 'stale-metrics'
      | 'cross-scope',
  ) {
    const seeded = await db.store.withTransaction((tx) => seedEcsProfileAndGrant(tx));
    const run = await new EnqueueRun(db.store).execute({
      grantId: seeded.grant.id,
      clientIdempotencyKey: randomUUID(),
      requestDigest: randomUUID(),
    });
    const ports = createFixturePorts(scenario);
    const worker = new WorkerLoop({
      store: db.store,
      inventory: ports.inventory,
      telemetry: ports.telemetry,
      workerId: `e2e-${randomUUID()}`,
      leaseTtlSeconds: 15,
      detectors: [new GrdEcs001(), new GrdObs001()],
    });
    await worker.runUntilIdle();
    const terminal = await db.store.getRun(run.id);
    const findings = await db.store.listFindings(run.id);
    const observations = await db.store.listObservations(run.id);
    return { terminal, findings, observations, calls: ports.calls(), runId: run.id };
  }

  it('authorises and runs a healthy fixture to terminal healthy with cited PASS', async () => {
    const result = await runScenario('healthy');
    expect(result.terminal?.state).toBe('healthy');
    expect(result.terminal?.result).toBe('PASS');
    expect(result.findings).toHaveLength(2);
    expect(result.findings.every((item) => item.result === 'PASS')).toBe(true);
    expect(result.findings.every((item) => item.observationIds.length >= 1)).toBe(true);
    const events = await db.store.listEvents('assurance_run', result.runId);
    expect(events.some((item) => item.type === 'observation_persisted')).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/AccessKeyId|SecretAccessKey|SessionToken/);
    for (const event of events) {
      expect(event.payload).not.toHaveProperty('payload');
    }
  });

  it('runs the unhealthy replacement fixture to findings with detector failures', async () => {
    const result = await runScenario('unhealthy-replacement');
    expect(result.terminal?.state).toBe('findings');
    expect(result.terminal?.result).toBe('FAIL');
    expect(
      result.findings.some((item) => item.detectorId === 'GRD-ECS-001' && item.result === 'FAIL'),
    ).toBe(true);
    expect(
      result.findings.some((item) => item.detectorId === 'GRD-OBS-001' && item.result === 'FAIL'),
    ).toBe(true);
  });

  it('returns UNKNOWN findings, never healthy, when a required collector fails', async () => {
    const result = await runScenario('partial-failure');
    expect(result.terminal?.state).toBe('findings');
    expect(result.terminal?.result).toBe('UNKNOWN');
    expect(result.findings.some((item) => item.result === 'UNKNOWN')).toBe(true);
    expect(result.terminal?.state).not.toBe('healthy');
    expect(result.terminal?.state).not.toBe('evaluating');
  });

  it('fails GRD-OBS-001 when alarm inventory is complete and empty', async () => {
    const result = await runScenario('missing-alarm');
    expect(result.terminal?.state).toBe('findings');
    expect(
      result.findings.some((item) => item.detectorId === 'GRD-OBS-001' && item.result === 'FAIL'),
    ).toBe(true);
  });

  it('marks stale metric datapoints STALE', async () => {
    const result = await runScenario('stale-metrics');
    const metric = result.observations.find((item) => item.kind === CW_RUNNING_TASK_METRIC_KIND);
    expect(metric?.freshness).toBe('STALE');
  });

  it('fails the run on a cross-scope response without filtering', async () => {
    const result = await runScenario('cross-scope');
    expect(result.terminal?.state).toBe('failed');
  });

  it('recovers a crash after observation insert without duplicates', async () => {
    const seeded = await db.store.withTransaction((tx) => seedEcsProfileAndGrant(tx));
    const run = await new EnqueueRun(db.store).execute({
      grantId: seeded.grant.id,
      clientIdempotencyKey: randomUUID(),
      requestDigest: randomUUID(),
    });
    const ports = createFixturePorts('healthy');
    const crashing = new WorkerLoop({
      store: db.store,
      inventory: ports.inventory,
      telemetry: ports.telemetry,
      workerId: 'crasher',
      leaseTtlSeconds: 1,
      crashAfterObservations: true,
      detectors: [new GrdEcs001(), new GrdObs001()],
    });
    await expect(crashing.runOnce()).rejects.toThrow(/CrashAfterObservations/);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const recovering = new WorkerLoop({
      store: db.store,
      inventory: ports.inventory,
      telemetry: ports.telemetry,
      workerId: 'recover',
      leaseTtlSeconds: 15,
      detectors: [new GrdEcs001(), new GrdObs001()],
    });
    await recovering.runUntilIdle();
    const terminal = await db.store.getRun(run.id);
    const observations = await db.store.listObservations(run.id);
    const findings = await db.store.listFindings(run.id);
    const events = await db.store.listEvents('assurance_run', run.id);
    expect(terminal?.state === 'healthy' || terminal?.state === 'findings').toBe(true);
    const identities = observations.map((item) => item.contentIdentity).sort();
    expect(identities).toEqual([...new Set(identities)].sort());
    expect(findings).toHaveLength(2);
    const operationIds = events.map((item) => item.operationId).sort();
    expect(operationIds).toEqual([...new Set(operationIds)].sort());
  });

  it('makes zero AWS-shaped calls for an unapproved service', async () => {
    const ports = createFixturePorts('healthy');
    const window = { from: '2026-08-31T00:00:00.000Z', to: '2026-08-31T01:00:00.000Z' };
    await expect(
      ports.inventory.collect({
        scope: { ...PAYMENTS_SERVICE, resourceId: 'other-cluster/other' },
        window,
        onPage: async () => undefined,
      }),
    ).rejects.toThrow(/outside the authorised resource scope/);
    expect(ports.calls()).toEqual([]);
  });
});
