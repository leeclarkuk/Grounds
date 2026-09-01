import type { ObservationRecord } from '@grounds/application';
import {
  isJsonObject,
  isJsonArray,
  splitEcsResourceId,
  type JsonObject,
  type JsonValue,
} from '@grounds/domain';

export type DetectorParameters = {
  readonly replacementCountThreshold: number;
  readonly runningDeficitThreshold: number;
  readonly unhealthyTargetReasons: readonly string[];
  readonly deficitSustainedFraction: number;
};

export function parseDetectorParameters(value: JsonObject): DetectorParameters {
  const replacementCountThreshold = asPositiveNumber(value['replacementCountThreshold']);
  const runningDeficitThreshold = asNonNegativeNumber(value['runningDeficitThreshold']);
  const deficitSustainedFraction = asFraction(value['deficitSustainedFraction']);
  const reasons = value['unhealthyTargetReasons'];
  if (!Array.isArray(reasons) || reasons.some((item) => typeof item !== 'string')) {
    throw new Error('unhealthyTargetReasons must be a string array');
  }
  return {
    replacementCountThreshold,
    runningDeficitThreshold,
    unhealthyTargetReasons: reasons.filter((item): item is string => typeof item === 'string'),
    deficitSustainedFraction,
  };
}

export function observationsOfKind(
  observations: readonly ObservationRecord[],
  kind: string,
): ObservationRecord[] {
  return observations.filter((item) => item.kind === kind);
}

export function requiredUnusable(observation: ObservationRecord | undefined): boolean {
  return (
    observation === undefined ||
    observation.inaccessible ||
    observation.truncated ||
    observation.freshness === 'STALE'
  );
}

export function payloadObject(observation: ObservationRecord | undefined): JsonObject | undefined {
  if (!observation || !isJsonObject(observation.payload)) {
    return undefined;
  }
  return observation.payload;
}

export function asComplete(payload: JsonObject | undefined): boolean {
  return payload?.['complete'] === true;
}

export type ServicePayload = {
  readonly clusterName: string;
  readonly serviceName: string;
  readonly desiredCount: number;
  readonly runningCount: number;
  readonly runningTaskArns: readonly string[];
  readonly targetGroupArns: readonly string[];
  readonly complete: boolean;
};

export function parseServicePayload(payload: JsonValue): ServicePayload | undefined {
  if (!isJsonObject(payload)) {
    return undefined;
  }
  const runningTaskArns = stringArray(payload['runningTaskArns']);
  const targetGroupArns = stringArray(payload['targetGroupArns']);
  if (
    typeof payload['clusterName'] !== 'string' ||
    typeof payload['serviceName'] !== 'string' ||
    typeof payload['desiredCount'] !== 'number' ||
    typeof payload['runningCount'] !== 'number' ||
    runningTaskArns === undefined ||
    targetGroupArns === undefined
  ) {
    return undefined;
  }
  return {
    clusterName: payload['clusterName'],
    serviceName: payload['serviceName'],
    desiredCount: payload['desiredCount'],
    runningCount: payload['runningCount'],
    runningTaskArns,
    targetGroupArns,
    complete: payload['complete'] === true,
  };
}

export type TaskRecord = {
  readonly taskArn: string;
  readonly lastStatus: string;
  readonly desiredStatus: string;
  readonly stoppedAt: string | null;
};

export type TasksPayload = {
  readonly tasks: readonly TaskRecord[];
  readonly complete: boolean;
};

export function parseTasksPayload(payload: JsonValue): TasksPayload | undefined {
  if (!isJsonObject(payload) || !isJsonArray(payload['tasks'])) {
    return undefined;
  }
  const tasks: TaskRecord[] = [];
  for (const item of payload['tasks']) {
    if (!isJsonObject(item) || typeof item['taskArn'] !== 'string') {
      return undefined;
    }
    tasks.push({
      taskArn: item['taskArn'],
      lastStatus: typeof item['lastStatus'] === 'string' ? item['lastStatus'] : '',
      desiredStatus: typeof item['desiredStatus'] === 'string' ? item['desiredStatus'] : '',
      stoppedAt: typeof item['stoppedAt'] === 'string' ? item['stoppedAt'] : null,
    });
  }
  return { tasks, complete: payload['complete'] === true };
}

export type TargetGroupRecord = {
  readonly targetGroupArn: string;
  readonly healthCheckPath: string;
  readonly matcher: string;
};

export type TargetGroupsPayload = {
  readonly targetGroups: readonly TargetGroupRecord[];
  readonly complete: boolean;
};

export function parseTargetGroupsPayload(payload: JsonValue): TargetGroupsPayload | undefined {
  if (!isJsonObject(payload) || !isJsonArray(payload['targetGroups'])) {
    return undefined;
  }
  const targetGroups: TargetGroupRecord[] = [];
  for (const item of payload['targetGroups']) {
    if (!isJsonObject(item) || typeof item['targetGroupArn'] !== 'string') {
      return undefined;
    }
    targetGroups.push({
      targetGroupArn: item['targetGroupArn'],
      healthCheckPath: typeof item['healthCheckPath'] === 'string' ? item['healthCheckPath'] : '',
      matcher: typeof item['matcher'] === 'string' ? item['matcher'] : '',
    });
  }
  return { targetGroups, complete: payload['complete'] === true };
}

export type TargetHealthRecord = {
  readonly id: string;
  readonly state: string;
  readonly reason: string;
};

export type TargetHealthPayload = {
  readonly targetGroupArn: string;
  readonly targets: readonly TargetHealthRecord[];
  readonly complete: boolean;
};

export function parseTargetHealthPayload(payload: JsonValue): TargetHealthPayload | undefined {
  if (
    !isJsonObject(payload) ||
    typeof payload['targetGroupArn'] !== 'string' ||
    !isJsonArray(payload['targets'])
  ) {
    return undefined;
  }
  const targets: TargetHealthRecord[] = [];
  for (const item of payload['targets']) {
    if (!isJsonObject(item)) {
      return undefined;
    }
    targets.push({
      id: typeof item['id'] === 'string' ? item['id'] : '',
      state: typeof item['state'] === 'string' ? item['state'] : '',
      reason: typeof item['reason'] === 'string' ? item['reason'] : '',
    });
  }
  return {
    targetGroupArn: payload['targetGroupArn'],
    targets,
    complete: payload['complete'] === true,
  };
}

export type AlarmRecord = {
  readonly alarmName: string;
  readonly namespace: string;
  readonly metricName: string;
  readonly dimensions: Readonly<Record<string, string>>;
  readonly actionsEnabled: boolean;
  readonly alarmActions: readonly string[];
};

export type AlarmsPayload = {
  readonly alarms: readonly AlarmRecord[];
  readonly complete: boolean;
};

export function parseAlarmsPayload(payload: JsonValue): AlarmsPayload | undefined {
  if (!isJsonObject(payload) || !isJsonArray(payload['alarms'])) {
    return undefined;
  }
  const alarms: AlarmRecord[] = [];
  for (const item of payload['alarms']) {
    if (!isJsonObject(item) || typeof item['alarmName'] !== 'string') {
      return undefined;
    }
    const dimensions: { [name: string]: string } = {};
    const rawDimensions = item['dimensions'];
    if (isJsonArray(rawDimensions)) {
      for (const dimension of rawDimensions) {
        if (
          isJsonObject(dimension) &&
          typeof dimension['name'] === 'string' &&
          typeof dimension['value'] === 'string'
        ) {
          dimensions[dimension['name']] = dimension['value'];
        }
      }
    }
    const alarmActions = stringArray(item['alarmActions']) ?? [];
    alarms.push({
      alarmName: item['alarmName'],
      namespace: typeof item['namespace'] === 'string' ? item['namespace'] : '',
      metricName: typeof item['metricName'] === 'string' ? item['metricName'] : '',
      dimensions,
      actionsEnabled: item['actionsEnabled'] === true,
      alarmActions,
    });
  }
  return { alarms, complete: payload['complete'] === true };
}

export type MetricPayload = {
  readonly datapoints: readonly { readonly timestamp: string; readonly value: number }[];
  readonly complete: boolean;
};

export function parseMetricPayload(payload: JsonValue): MetricPayload | undefined {
  if (!isJsonObject(payload) || !isJsonArray(payload['datapoints'])) {
    return undefined;
  }
  const datapoints: { timestamp: string; value: number }[] = [];
  for (const item of payload['datapoints']) {
    if (
      !isJsonObject(item) ||
      typeof item['timestamp'] !== 'string' ||
      typeof item['value'] !== 'number'
    ) {
      return undefined;
    }
    datapoints.push({ timestamp: item['timestamp'], value: item['value'] });
  }
  return { datapoints, complete: payload['complete'] === true };
}

export function identityFromResource(resourceId: string): {
  readonly clusterName: string;
  readonly serviceName: string;
} {
  return splitEcsResourceId(resourceId);
}

function stringArray(value: JsonValue | undefined): string[] | undefined {
  if (!isJsonArray(value) || value.some((item) => typeof item !== 'string')) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function asPositiveNumber(value: JsonValue | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    throw new Error('expected a positive number');
  }
  return value;
}

function asNonNegativeNumber(value: JsonValue | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('expected a non-negative number');
  }
  return value;
}

function asFraction(value: JsonValue | undefined): number {
  if (typeof value !== 'number' || value < 0 || value > 1) {
    throw new Error('expected a fraction between 0 and 1');
  }
  return value;
}
