import { describe, expect, it } from 'vitest';

import { ALARM_PAGE_BOUND, OutOfScopeError, requestDigest } from '@grounds/domain';
import { PAYMENTS_SERVICE } from '../../packages/test-support/src/fixtures.js';
import { createFixturePorts } from '../../packages/adapter-aws/src/adapter.js';
import { collectInventory, collectTelemetry } from '../../packages/adapter-aws/src/collectors.js';
import {
  FixtureOperations,
  loadFixtureScenario,
} from '../../packages/adapter-aws/src/fixture-operations.js';
import { normaliseAlarms } from '../../packages/adapter-aws/src/normalise.js';
import type { AwsOperations } from '../../packages/adapter-aws/src/operations.js';

const window = { from: '2026-08-31T00:00:00.000Z', to: '2026-08-31T01:00:00.000Z' };

describe('adapter-aws fixtures', () => {
  it('collects a healthy fixture without AWS SDK types', () => {
    const ports = createFixturePorts('healthy');
    return Promise.all([
      ports.inventory.collect({ scope: PAYMENTS_SERVICE, window, onPage: async () => undefined }),
      ports.telemetry.collect({ scope: PAYMENTS_SERVICE, window, onPage: async () => undefined }),
    ]).then(([inventory, telemetry]) => {
      expect(
        inventory.some((item) => item.kind === 'ecs.service' && item.inaccessible === false),
      ).toBe(true);
      expect(telemetry.some((item) => item.kind === 'cloudwatch.alarms')).toBe(true);
      expect(JSON.stringify(inventory)).not.toMatch(/DescribeServicesCommand/);
    });
  });

  it('rejects a cross-scope response rather than filtering it', async () => {
    const operations = new FixtureOperations(loadFixtureScenario('cross-scope'));
    await expect(
      collectInventory(operations, {
        scope: PAYMENTS_SERVICE,
        window,
        onPage: async () => undefined,
      }),
    ).rejects.toThrow(/outside the authorised resource scope/);
  });

  it('retries throttling then collects', async () => {
    const ports = createFixturePorts('throttling');
    const inventory = await ports.inventory.collect({
      scope: PAYMENTS_SERVICE,
      window,
      onPage: async () => undefined,
    });
    expect(inventory.some((item) => item.kind === 'ecs.service' && !item.inaccessible)).toBe(true);
    expect(ports.calls().filter((item) => item === 'describeServices').length).toBeGreaterThan(1);
  });

  it('paginates alarm inventory', async () => {
    const pages: number[] = [];
    const operations = new FixtureOperations(loadFixtureScenario('pagination'));
    const telemetry = await collectTelemetry(operations, {
      scope: PAYMENTS_SERVICE,
      window,
      onPage: async () => {
        pages.push(1);
      },
    });
    const alarms = telemetry.find((item) => item.kind === 'cloudwatch.alarms');
    expect(alarms && typeof alarms.payload === 'object' && alarms.payload !== null).toBe(true);
    expect(pages.length).toBeGreaterThan(1);
  });

  it('changes request digest when the query, window or cursor changes', () => {
    const base = {
      operation: 'cloudwatch.GetMetricData',
      resource: PAYMENTS_SERVICE,
      window,
      query: { clusterName: 'payments-cluster', serviceName: 'payments', cursor: null },
    };
    expect(requestDigest(base)).not.toBe(
      requestDigest({
        ...base,
        query: { clusterName: 'other-cluster', serviceName: 'payments', cursor: null },
      }),
    );
    expect(requestDigest(base)).not.toBe(
      requestDigest({
        ...base,
        window: { from: window.from, to: '2026-08-31T00:30:00.000Z' },
      }),
    );
    expect(requestDigest(base)).not.toBe(
      requestDigest({ ...base, query: { ...base.query, cursor: '1' } }),
    );
  });

  it('makes zero provider calls for an unapproved service', async () => {
    const ports = createFixturePorts('healthy');
    await expect(
      ports.inventory.collect({
        scope: { ...PAYMENTS_SERVICE, resourceId: 'other-cluster/other' },
        window,
        onPage: async () => undefined,
      }),
    ).rejects.toThrow(/outside the authorised resource scope/);
    expect(ports.calls()).toEqual([]);
  });

  it('normalises shuffled alarm order identically', () => {
    const first = normaliseAlarms(
      [
        { alarmName: 'b', namespace: 'AWS/ECS', metricName: 'CPUUtilization', dimensions: [] },
        { alarmName: 'a', namespace: 'AWS/ECS', metricName: 'RunningTaskCount', dimensions: [] },
      ],
      true,
    );
    const second = normaliseAlarms(
      [
        { alarmName: 'a', namespace: 'AWS/ECS', metricName: 'RunningTaskCount', dimensions: [] },
        { alarmName: 'b', namespace: 'AWS/ECS', metricName: 'CPUUtilization', dimensions: [] },
      ],
      true,
    );
    expect(first).toEqual(second);
  });

  it('marks alarm inventory incomplete when the page bound is hit', async () => {
    let pages = 0;
    const operations: AwsOperations = {
      describeServices: () => Promise.resolve({}),
      listTasks: () => Promise.resolve({ payload: {}, nextToken: null }),
      describeTasks: () => Promise.resolve({}),
      describeTargetGroups: () => Promise.resolve({}),
      describeTargetHealth: () => Promise.resolve({ payload: {}, nextToken: null }),
      describeAlarms: () => {
        pages += 1;
        return Promise.resolve({ payload: { metricAlarms: [] }, nextToken: 'more' });
      },
      getMetricData: () => Promise.resolve({ payload: { metricDataResults: [] }, nextToken: null }),
    };
    const telemetry = await collectTelemetry(operations, {
      scope: PAYMENTS_SERVICE,
      window,
      onPage: async () => undefined,
    });
    const alarms = telemetry.find((item) => item.kind === 'cloudwatch.alarms');
    expect(pages).toBe(ALARM_PAGE_BOUND);
    expect(
      alarms &&
        typeof alarms.payload === 'object' &&
        alarms.payload !== null &&
        alarms.payload['complete'] === false,
    ).toBe(true);
  });

  it('marks partial collector failure inaccessible', async () => {
    const ports = createFixturePorts('partial-failure');
    const telemetry = await ports.telemetry.collect({
      scope: PAYMENTS_SERVICE,
      window,
      onPage: async () => undefined,
    });
    expect(telemetry.every((item) => item.inaccessible)).toBe(true);
  });
});
