import {
  inaccessiblePayload,
  isJsonArray,
  isJsonObject,
  type InaccessibleErrorCode,
  type JsonObject,
  type JsonValue,
} from '@grounds/domain';
import { asObject } from './operations.js';
import { clusterNameFromArn, objectList, stringList } from './scope.js';
import { readNumber, readString, readValue } from './fields.js';

export function inaccessible(errorCode: InaccessibleErrorCode): JsonObject {
  return inaccessiblePayload(errorCode);
}

export function normaliseService(service: JsonObject, clusterName: string): JsonObject {
  const loadBalancers = objectList(readValue(service, 'loadBalancers', 'LoadBalancers'));
  const targetGroupArns = loadBalancers
    .map((item) => readString(item, 'targetGroupArn', 'TargetGroupArn'))
    .filter((item) => item.length > 0)
    .sort();
  const deployments = objectList(readValue(service, 'deployments', 'Deployments'));
  const primary =
    deployments.find((item) => readString(item, 'status', 'Status') === 'PRIMARY') ?? {};
  const runningTaskArns = stringList(
    readValue(primary, 'runningTaskArns', 'RunningTaskArns') ??
      readValue(service, 'runningTaskArns', 'RunningTaskArns'),
  );
  return {
    clusterName,
    serviceName: readString(service, 'serviceName', 'ServiceName'),
    desiredCount: readNumber(service, 'desiredCount', 'DesiredCount'),
    runningCount: readNumber(service, 'runningCount', 'RunningCount'),
    runningTaskArns,
    targetGroupArns,
    complete: true,
  };
}

export function normaliseTasks(
  tasks: readonly JsonObject[],
  requestedArns: readonly string[] = [],
  failures: readonly JsonObject[] = [],
): JsonObject {
  const normalised = tasks
    .map((task) => ({
      taskArn: readString(task, 'taskArn', 'TaskArn'),
      lastStatus: readString(task, 'lastStatus', 'LastStatus'),
      desiredStatus: readString(task, 'desiredStatus', 'DesiredStatus'),
      stoppedAt: readString(task, 'stoppedAt', 'StoppedAt') || null,
      startedAt: readString(task, 'startedAt', 'StartedAt') || null,
      stoppedReason: readString(task, 'stoppedReason', 'StoppedReason') || null,
    }))
    .sort((left, right) => left.taskArn.localeCompare(right.taskArn));
  const described = new Set(normalised.map((task) => task.taskArn).filter((arn) => arn.length > 0));
  const failed = failures.filter((item) => readString(item, 'arn', 'Arn').length > 0);
  const missingRequested = requestedArns.some((arn) => !described.has(arn));
  return {
    tasks: normalised,
    complete: failed.length === 0 && !missingRequested,
  };
}

export function normaliseTargetGroups(groups: readonly JsonObject[]): JsonObject {
  const targetGroups = groups
    .map((group) => {
      const matcher = asObject(readValue(group, 'matcher', 'Matcher'));
      return {
        targetGroupArn: readString(group, 'targetGroupArn', 'TargetGroupArn'),
        healthCheckPath: readString(group, 'healthCheckPath', 'HealthCheckPath'),
        matcher: readString(matcher, 'HttpCode', 'httpCode'),
      };
    })
    .sort((left, right) => left.targetGroupArn.localeCompare(right.targetGroupArn));
  return { targetGroups, complete: true };
}

export function normaliseTargetHealth(
  targetGroupArn: string,
  descriptions: readonly JsonObject[],
): JsonObject {
  const targets = descriptions
    .map((item) => {
      const target = asObject(readValue(item, 'target', 'Target'));
      const health = asObject(readValue(item, 'targetHealth', 'TargetHealth') ?? item);
      return {
        id: readString(target, 'id', 'Id') || readString(item, 'id', 'Id'),
        state: readString(health, 'state', 'State'),
        reason: readString(health, 'reason', 'Reason'),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  return { targetGroupArn, targets, complete: true };
}

export function normaliseAlarms(alarms: readonly JsonObject[], complete: boolean): JsonObject {
  const normalised = alarms
    .map((alarm) => {
      const dimensions = objectList(readValue(alarm, 'dimensions', 'Dimensions'))
        .map((dimension) => ({
          name: readString(dimension, 'name', 'Name'),
          value: readString(dimension, 'value', 'Value'),
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
      return {
        alarmName: readString(alarm, 'alarmName', 'AlarmName'),
        namespace: readString(alarm, 'namespace', 'Namespace'),
        metricName: readString(alarm, 'metricName', 'MetricName'),
        dimensions,
        actionsEnabled: alarm['actionsEnabled'] === true || alarm['ActionsEnabled'] === true,
        alarmActions: stringList(readValue(alarm, 'alarmActions', 'AlarmActions')),
      };
    })
    .sort((left, right) => left.alarmName.localeCompare(right.alarmName));
  return { alarms: normalised, complete };
}

export function normaliseMetrics(datapoints: readonly JsonObject[], complete: boolean): JsonObject {
  const points = datapoints
    .map((point) => ({
      timestamp: readString(point, 'timestamp', 'Timestamp'),
      value: readNumber(point, 'value', 'Value'),
    }))
    .filter((point) => point.timestamp.length > 0)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return {
    metricName: 'RunningTaskCount',
    namespace: 'ECS/ContainerInsights',
    datapoints: points,
    complete,
  };
}

export function newestMetricTimestamp(payload: JsonObject): string | undefined {
  const datapoints = payload['datapoints'];
  if (!isJsonArray(datapoints) || datapoints.length === 0) {
    return undefined;
  }
  const last = datapoints[datapoints.length - 1];
  if (
    last !== undefined &&
    isJsonObject(last) &&
    typeof last['timestamp'] === 'string' &&
    last['timestamp'].length > 0
  ) {
    return last['timestamp'];
  }
  return undefined;
}

export function clusterOfService(service: JsonObject): string | undefined {
  const arn = readString(service, 'clusterArn', 'ClusterArn');
  return clusterNameFromArn(arn);
}

export function jsonClone(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
