import { describe, expect, it } from 'vitest';

import type { JsonObject } from '@grounds/domain';
import { collectInventory } from './collectors.js';
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
});
