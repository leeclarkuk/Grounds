import { describe, expect, it } from 'vitest';

import { CW_RUNNING_TASK_METRIC_KIND, type JsonObject } from '@grounds/domain';
import { collectInventory, collectTelemetry } from './collectors.js';
import { normaliseMetrics } from './normalise.js';
import type { AwsOperations, AwsPage } from './operations.js';
import { DEFAULT_ALLOWED_SCOPE } from './scope.js';

const window = { from: '2026-08-31T00:00:00.000Z', to: '2026-08-31T01:00:00.000Z' };

function page(payload: JsonObject, nextToken: string | null = null): AwsPage {
  return { payload, nextToken };
}

describe('collectInventory task description', () => {
  it('batches DescribeTasks at 100 ARNs and merges failures into incomplete inventory', async () => {
    const arns = Array.from(
      { length: 101 },
      (_, index) => `arn:aws:ecs:eu-west-2:123456789012:task/payments-cluster/${index}`,
    );
    const batches: number[] = [];
    const operations: AwsOperations = {
      describeServices: () =>
        Promise.resolve({
          services: [
            {
              serviceName: 'payments',
              serviceArn: 'arn:aws:ecs:eu-west-2:123456789012:service/payments-cluster/payments',
              clusterArn: 'arn:aws:ecs:eu-west-2:123456789012:cluster/payments-cluster',
              desiredCount: 2,
              runningCount: 2,
              loadBalancers: [
                {
                  targetGroupArn:
                    'arn:aws:elasticloadbalancing:eu-west-2:123456789012:targetgroup/pay/abc',
                },
              ],
            },
          ],
        }),
      listTasks: (_input, nextToken) => {
        if (nextToken === 'stopped') {
          return Promise.resolve(page({ taskArns: [] }));
        }
        return Promise.resolve(page({ taskArns: arns }, 'stopped'));
      },
      describeTasks: (input) => {
        batches.push(input.taskArns.length);
        if (input.taskArns.length > 100) {
          throw new Error('DescribeTasks accepts at most 100 ARNs');
        }
        const tasks = input.taskArns.slice(0, -1).map((taskArn) => ({
          taskArn,
          lastStatus: 'RUNNING',
          desiredStatus: 'RUNNING',
        }));
        const missing = input.taskArns[input.taskArns.length - 1];
        return Promise.resolve({
          tasks,
          failures: missing ? [{ arn: missing, reason: 'MISSING' }] : [],
        });
      },
      describeTargetGroups: () =>
        Promise.resolve({
          targetGroups: [
            {
              targetGroupArn:
                'arn:aws:elasticloadbalancing:eu-west-2:123456789012:targetgroup/pay/abc',
              healthCheckPath: '/health',
              matcher: { HttpCode: '200' },
            },
          ],
        }),
      describeTargetHealth: () =>
        Promise.resolve(
          page({
            targetHealthDescriptions: [
              { target: { id: 'i-1' }, targetHealth: { state: 'healthy', reason: '' } },
            ],
          }),
        ),
      describeAlarms: () => Promise.resolve(page({ metricAlarms: [] })),
      getMetricData: () => Promise.resolve(page({ metricDataResults: [] })),
    };
    const inventory = await collectInventory(operations, {
      scope: DEFAULT_ALLOWED_SCOPE,
      window,
      onPage: async () => undefined,
    });
    expect(batches).toEqual([100, 1]);
    const tasks = inventory.find((item) => item.kind === 'ecs.tasks');
    expect(tasks?.payload).toMatchObject({ complete: false });
  });

  it('marks PascalCase DescribeTasks Failures as incomplete', async () => {
    const operations: AwsOperations = {
      describeServices: () =>
        Promise.resolve({
          services: [
            {
              serviceName: 'payments',
              serviceArn: 'arn:aws:ecs:eu-west-2:123456789012:service/payments-cluster/payments',
              clusterArn: 'arn:aws:ecs:eu-west-2:123456789012:cluster/payments-cluster',
              desiredCount: 2,
              runningCount: 2,
              loadBalancers: [
                {
                  targetGroupArn:
                    'arn:aws:elasticloadbalancing:eu-west-2:123456789012:targetgroup/pay/abc',
                },
              ],
            },
          ],
        }),
      listTasks: (_input, nextToken) => {
        if (nextToken === 'stopped') {
          return Promise.resolve(page({ taskArns: [] }));
        }
        return Promise.resolve(
          page(
            {
              taskArns: [
                'arn:aws:ecs:eu-west-2:123456789012:task/payments-cluster/1',
                'arn:aws:ecs:eu-west-2:123456789012:task/payments-cluster/2',
              ],
            },
            'stopped',
          ),
        );
      },
      describeTasks: () =>
        Promise.resolve({
          Tasks: [
            {
              TaskArn: 'arn:aws:ecs:eu-west-2:123456789012:task/payments-cluster/1',
              LastStatus: 'RUNNING',
              DesiredStatus: 'RUNNING',
            },
          ],
          Failures: [
            {
              Arn: 'arn:aws:ecs:eu-west-2:123456789012:task/payments-cluster/2',
              Reason: 'MISSING',
            },
          ],
        }),
      describeTargetGroups: () =>
        Promise.resolve({
          targetGroups: [
            {
              targetGroupArn:
                'arn:aws:elasticloadbalancing:eu-west-2:123456789012:targetgroup/pay/abc',
              healthCheckPath: '/health',
              matcher: { HttpCode: '200' },
            },
          ],
        }),
      describeTargetHealth: () =>
        Promise.resolve(
          page({
            targetHealthDescriptions: [
              { target: { id: 'i-1' }, targetHealth: { state: 'healthy', reason: '' } },
            ],
          }),
        ),
      describeAlarms: () => Promise.resolve(page({ metricAlarms: [] })),
      getMetricData: () => Promise.resolve(page({ metricDataResults: [] })),
    };
    const inventory = await collectInventory(operations, {
      scope: DEFAULT_ALLOWED_SCOPE,
      window,
      onPage: async () => undefined,
    });
    expect(inventory.find((item) => item.kind === 'ecs.tasks')?.payload).toMatchObject({
      complete: false,
    });
  });
});

describe('collectTelemetry RunningTaskCount namespace', () => {
  it('records ECS/ContainerInsights on the metric observation', async () => {
    const operations: AwsOperations = {
      describeServices: () => Promise.resolve({}),
      listTasks: () => Promise.resolve(page({})),
      describeTasks: () => Promise.resolve({}),
      describeTargetGroups: () => Promise.resolve({}),
      describeTargetHealth: () => Promise.resolve(page({})),
      describeAlarms: () => Promise.resolve(page({ metricAlarms: [] })),
      getMetricData: () =>
        Promise.resolve(
          page({
            metricDataResults: [
              {
                timestamps: ['2026-08-31T00:10:00.000Z'],
                values: [2],
              },
            ],
          }),
        ),
    };
    const telemetry = await collectTelemetry(operations, {
      scope: DEFAULT_ALLOWED_SCOPE,
      window,
      onPage: async () => undefined,
    });
    const metric = telemetry.find((item) => item.kind === CW_RUNNING_TASK_METRIC_KIND);
    expect(metric?.payload).toMatchObject({
      namespace: 'ECS/ContainerInsights',
      metricName: 'RunningTaskCount',
    });
    expect(normaliseMetrics([], true)['namespace']).toBe('ECS/ContainerInsights');
  });
});
