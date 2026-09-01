import { isJsonObject, type JsonObject, type JsonValue } from '@grounds/domain';

export type AwsPage = {
  readonly payload: JsonObject;
  readonly nextToken: string | null;
};

export type MetricQuery = {
  readonly clusterName: string;
  readonly serviceName: string;
  readonly from: string;
  readonly to: string;
};

export interface AwsOperations {
  describeServices(input: {
    readonly clusterName: string;
    readonly serviceName: string;
  }): Promise<JsonObject>;
  listTasks(
    input: {
      readonly clusterName: string;
      readonly serviceName: string;
      readonly desiredStatus: 'RUNNING' | 'STOPPED';
    },
    nextToken: string | null,
  ): Promise<AwsPage>;
  describeTasks(input: {
    readonly clusterName: string;
    readonly taskArns: readonly string[];
  }): Promise<JsonObject>;
  describeTargetGroups(input: { readonly targetGroupArns: readonly string[] }): Promise<JsonObject>;
  describeTargetHealth(
    input: { readonly targetGroupArn: string },
    nextToken: string | null,
  ): Promise<AwsPage>;
  describeAlarms(nextToken: string | null): Promise<AwsPage>;
  getMetricData(input: MetricQuery, nextToken: string | null): Promise<AwsPage>;
  assumeRole?(input: {
    readonly roleArn: string;
    readonly externalId: string;
    readonly sessionSeconds: number;
  }): Promise<JsonObject>;
  getCallerIdentity?(): Promise<JsonObject>;
}

export function asObject(value: JsonValue | undefined): JsonObject {
  if (value === undefined || !isJsonObject(value)) {
    return {};
  }
  return value;
}
