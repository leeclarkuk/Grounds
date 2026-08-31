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

export function inaccessible(errorCode: InaccessibleErrorCode): JsonObject {
  return inaccessiblePayload(errorCode);
}

export function normaliseService(service: JsonObject, clusterName: string): JsonObject {
  const loadBalancers = objectList(service['loadBalancers']);
  const targetGroupArns = loadBalancers
    .map((item) => item['targetGroupArn'])
    .filter((item): item is string => typeof item === 'string')
    .sort();
  const deployments = objectList(service['deployments']);
  const primary = deployments.find((item) => item['status'] === 'PRIMARY') ?? {};
  const runningTaskArns = stringList(primary['runningTaskArns'] ?? service['runningTaskArns']);
  return {
    clusterName,
    serviceName: typeof service['serviceName'] === 'string' ? service['serviceName'] : '',
    desiredCount: typeof service['desiredCount'] === 'number' ? service['desiredCount'] : 0,
    runningCount: typeof service['runningCount'] === 'number' ? service['runningCount'] : 0,
    runningTaskArns,
    targetGroupArns,
    complete: true,
  };
}

export function normaliseTasks(tasks: readonly JsonObject[]): JsonObject {
  const normalised = tasks
    .map((task) => ({
      taskArn: typeof task['taskArn'] === 'string' ? task['taskArn'] : '',
      lastStatus: typeof task['lastStatus'] === 'string' ? task['lastStatus'] : '',
      desiredStatus: typeof task['desiredStatus'] === 'string' ? task['desiredStatus'] : '',
      stoppedAt: typeof task['stoppedAt'] === 'string' ? task['stoppedAt'] : null,
      startedAt: typeof task['startedAt'] === 'string' ? task['startedAt'] : null,
      stoppedReason: typeof task['stoppedReason'] === 'string' ? task['stoppedReason'] : null,
    }))
    .sort((left, right) => left.taskArn.localeCompare(right.taskArn));
  return { tasks: normalised, complete: true };
}

export function normaliseTargetGroups(groups: readonly JsonObject[]): JsonObject {
  const targetGroups = groups
    .map((group) => {
      const matcher = asObject(group['matcher']);
      const httpCode =
        typeof matcher['HttpCode'] === 'string'
          ? matcher['HttpCode']
          : typeof matcher['httpCode'] === 'string'
            ? matcher['httpCode']
            : '';
      return {
        targetGroupArn: typeof group['targetGroupArn'] === 'string' ? group['targetGroupArn'] : '',
        healthCheckPath:
          typeof group['healthCheckPath'] === 'string' ? group['healthCheckPath'] : '',
        matcher: httpCode,
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
      const target = asObject(item['target']);
      const health = asObject(item['targetHealth'] ?? item);
      return {
        id:
          typeof target['id'] === 'string'
            ? target['id']
            : typeof item['id'] === 'string'
              ? item['id']
              : '',
        state: typeof health['state'] === 'string' ? health['state'] : '',
        reason: typeof health['reason'] === 'string' ? health['reason'] : '',
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  return { targetGroupArn, targets, complete: true };
}

export function normaliseAlarms(alarms: readonly JsonObject[], complete: boolean): JsonObject {
  const normalised = alarms
    .map((alarm) => {
      const dimensions = objectList(alarm['dimensions'])
        .map((dimension) => ({
          name:
            typeof dimension['name'] === 'string'
              ? dimension['name']
              : typeof dimension['Name'] === 'string'
                ? dimension['Name']
                : '',
          value:
            typeof dimension['value'] === 'string'
              ? dimension['value']
              : typeof dimension['Value'] === 'string'
                ? dimension['Value']
                : '',
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
      const actions = stringList(alarm['alarmActions'] ?? alarm['AlarmActions']);
      return {
        alarmName:
          typeof alarm['alarmName'] === 'string'
            ? alarm['alarmName']
            : typeof alarm['AlarmName'] === 'string'
              ? alarm['AlarmName']
              : '',
        namespace:
          typeof alarm['namespace'] === 'string'
            ? alarm['namespace']
            : typeof alarm['Namespace'] === 'string'
              ? alarm['Namespace']
              : '',
        metricName:
          typeof alarm['metricName'] === 'string'
            ? alarm['metricName']
            : typeof alarm['MetricName'] === 'string'
              ? alarm['MetricName']
              : '',
        dimensions,
        actionsEnabled: alarm['actionsEnabled'] === true || alarm['ActionsEnabled'] === true,
        alarmActions: actions,
      };
    })
    .sort((left, right) => left.alarmName.localeCompare(right.alarmName));
  return { alarms: normalised, complete };
}

export function normaliseMetrics(datapoints: readonly JsonObject[], complete: boolean): JsonObject {
  const points = datapoints
    .map((point) => ({
      timestamp:
        typeof point['timestamp'] === 'string'
          ? point['timestamp']
          : typeof point['Timestamp'] === 'string'
            ? point['Timestamp']
            : '',
      value:
        typeof point['value'] === 'number'
          ? point['value']
          : typeof point['Value'] === 'number'
            ? point['Value']
            : 0,
    }))
    .filter((point) => point.timestamp.length > 0)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return {
    metricName: 'RunningTaskCount',
    namespace: 'AWS/ECS',
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
  const arn = typeof service['clusterArn'] === 'string' ? service['clusterArn'] : '';
  return clusterNameFromArn(arn);
}

export function jsonClone(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
