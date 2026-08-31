import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { ECSClient } from '@aws-sdk/client-ecs';
import { ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { STSClient } from '@aws-sdk/client-sts';

import {
  AWS_SESSION_SECONDS,
  assertJsonValue,
  isJsonObject,
  type JsonObject,
} from '@grounds/domain';
import {
  AssumeRoleCommand,
  DescribeAlarmsCommand,
  DescribeServicesCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
  DescribeTasksCommand,
  GetCallerIdentityCommand,
  GetMetricDataCommand,
  ListTasksCommand,
} from './commands.js';
import type { AwsOperations, AwsPage, MetricQuery } from './operations.js';
import { asObject } from './operations.js';
import { pageOf } from './scope.js';

export type AwsSessionCredentials = {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken: string;
  readonly region: string;
};

export async function assumeRoleSession(input: {
  readonly roleArn: string;
  readonly externalId: string;
  readonly region: string;
}): Promise<AwsSessionCredentials> {
  if (!input.externalId) {
    throw new Error('external ID is required');
  }
  const sts = new STSClient({ region: input.region });
  const response = await sts.send(
    new AssumeRoleCommand({
      RoleArn: input.roleArn,
      RoleSessionName: 'grounds-assurance',
      ExternalId: input.externalId,
      DurationSeconds: AWS_SESSION_SECONDS,
    }),
  );
  const creds = response.Credentials;
  if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
    throw new Error('assume role did not return credentials');
  }
  return {
    accessKeyId: creds.AccessKeyId,
    secretAccessKey: creds.SecretAccessKey,
    sessionToken: creds.SessionToken,
    region: input.region,
  };
}

export class LiveAwsOperations implements AwsOperations {
  private readonly ecs: ECSClient;
  private readonly elb: ElasticLoadBalancingV2Client;
  private readonly cloudwatch: CloudWatchClient;
  private readonly sts: STSClient;

  public constructor(credentials: AwsSessionCredentials) {
    const config = {
      region: credentials.region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    };
    this.ecs = new ECSClient(config);
    this.elb = new ElasticLoadBalancingV2Client(config);
    this.cloudwatch = new CloudWatchClient(config);
    this.sts = new STSClient(config);
  }

  public async describeServices(input: {
    clusterName: string;
    serviceName: string;
  }): Promise<JsonObject> {
    return sendJson(
      this.ecs.send(
        new DescribeServicesCommand({ cluster: input.clusterName, services: [input.serviceName] }),
      ),
    );
  }

  public async listTasks(
    input: { clusterName: string; serviceName: string; desiredStatus: 'RUNNING' | 'STOPPED' },
    nextToken: string | null,
  ): Promise<AwsPage> {
    const payload = await sendJson(
      this.ecs.send(
        new ListTasksCommand({
          cluster: input.clusterName,
          serviceName: input.serviceName,
          desiredStatus: input.desiredStatus,
          ...(nextToken ? { nextToken } : {}),
        }),
      ),
    );
    return pageOf(payload, 'nextToken');
  }

  public async describeTasks(input: {
    clusterName: string;
    taskArns: readonly string[];
  }): Promise<JsonObject> {
    return sendJson(
      this.ecs.send(
        new DescribeTasksCommand({ cluster: input.clusterName, tasks: [...input.taskArns] }),
      ),
    );
  }

  public async describeTargetGroups(input: {
    targetGroupArns: readonly string[];
  }): Promise<JsonObject> {
    return sendJson(
      this.elb.send(
        new DescribeTargetGroupsCommand({ TargetGroupArns: [...input.targetGroupArns] }),
      ),
    );
  }

  public async describeTargetHealth(
    input: { targetGroupArn: string },
    nextToken: string | null,
  ): Promise<AwsPage> {
    const payload = await sendJson(
      this.elb.send(
        new DescribeTargetHealthCommand({
          TargetGroupArn: input.targetGroupArn,
          ...(nextToken ? { Marker: nextToken } : {}),
        }),
      ),
    );
    return pageOf(payload, 'NextMarker');
  }

  public async describeAlarms(nextToken: string | null): Promise<AwsPage> {
    const payload = await sendJson(
      this.cloudwatch.send(
        new DescribeAlarmsCommand({
          ...(nextToken ? { NextToken: nextToken } : {}),
        }),
      ),
    );
    return pageOf(asObject(payload), 'NextToken');
  }

  public async getMetricData(input: MetricQuery, nextToken: string | null): Promise<AwsPage> {
    const payload = await sendJson(
      this.cloudwatch.send(
        new GetMetricDataCommand({
          StartTime: new Date(input.from),
          EndTime: new Date(input.to),
          MetricDataQueries: [
            {
              Id: 'running',
              MetricStat: {
                Metric: {
                  Namespace: 'AWS/ECS',
                  MetricName: 'RunningTaskCount',
                  Dimensions: [
                    { Name: 'ClusterName', Value: input.clusterName },
                    { Name: 'ServiceName', Value: input.serviceName },
                  ],
                },
                Period: 60,
                Stat: 'Average',
              },
            },
          ],
          ...(nextToken ? { NextToken: nextToken } : {}),
        }),
      ),
    );
    return pageOf(payload, 'NextToken');
  }

  public async getCallerIdentity(): Promise<JsonObject> {
    return sendJson(this.sts.send(new GetCallerIdentityCommand({})));
  }
}

async function sendJson(promise: Promise<unknown>): Promise<JsonObject> {
  const response = await promise;
  const parsed = assertJsonValue(JSON.parse(JSON.stringify(response)));
  if (!isJsonObject(parsed)) {
    return {};
  }
  return parsed;
}
