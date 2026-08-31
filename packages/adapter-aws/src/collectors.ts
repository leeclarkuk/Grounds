import type { CollectContext, CollectorObservation } from '@grounds/application';
import {
  ALARM_PAGE_BOUND,
  AWS_ADAPTER,
  CW_ALARMS_KIND,
  CW_DESCRIBE_ALARMS,
  CW_GET_METRIC_DATA,
  CW_RUNNING_TASK_METRIC_KIND,
  ECS_DESCRIBE_SERVICES,
  ECS_DESCRIBE_TASKS,
  ECS_SERVICE_KIND,
  ECS_TASKS_KIND,
  ELB_DESCRIBE_TARGET_GROUPS,
  ELB_DESCRIBE_TARGET_HEALTH,
  ELB_TARGET_GROUP_KIND,
  ELB_TARGET_HEALTH_KIND,
  REQUIRED_INVENTORY_KINDS,
  REQUIRED_TELEMETRY_KINDS,
  OutOfScopeError,
  requestDigest,
  splitEcsResourceId,
  type InaccessibleErrorCode,
  type JsonObject,
} from '@grounds/domain';
import type { AwsOperations } from './operations.js';
import { asObject } from './operations.js';
import {
  inaccessible,
  newestMetricTimestamp,
  normaliseAlarms,
  normaliseMetrics,
  normaliseService,
  normaliseTargetGroups,
  normaliseTargetHealth,
  normaliseTasks,
} from './normalise.js';
import { assertServiceInScope, assertTargetGroupInScope, objectList, stringList } from './scope.js';
import { FixtureUnavailableError } from './fixture-operations.js';
import { readValue } from './fields.js';

export async function collectInventory(
  operations: AwsOperations,
  context: CollectContext,
): Promise<readonly CollectorObservation[]> {
  const identity = splitEcsResourceId(context.scope.resourceId);
  try {
    const serviceResponse = await retryOp(
      () =>
        operations.describeServices({
          clusterName: identity.clusterName,
          serviceName: identity.serviceName,
        }),
      context,
    );
    await context.onPage();
    const services = objectList(readValue(serviceResponse, 'services', 'Services'));
    if (services.length !== 1 || !services[0]) {
      return allInaccessible(REQUIRED_INVENTORY_KINDS, context, 'incomplete');
    }
    assertServiceInScope(context.scope, services[0]);
    const servicePayload = normaliseService(services[0], identity.clusterName);
    const observations: CollectorObservation[] = [
      observation(context, ECS_SERVICE_KIND, ECS_DESCRIBE_SERVICES, servicePayload, {
        clusterName: identity.clusterName,
        serviceName: identity.serviceName,
      }),
    ];
    const taskArns: string[] = [];
    let taskToken: string | null = null;
    for (const desiredStatus of ['RUNNING', 'STOPPED'] as const) {
      taskToken = null;
      do {
        const page = await retryOp(
          () =>
            operations.listTasks(
              {
                clusterName: identity.clusterName,
                serviceName: identity.serviceName,
                desiredStatus,
              },
              taskToken,
            ),
          context,
        );
        await context.onPage();
        taskArns.push(...stringList(readValue(page.payload, 'taskArns', 'TaskArns')));
        taskToken = page.nextToken;
      } while (taskToken);
    }
    const uniqueTaskArns = [...new Set(taskArns)].sort();
    const described =
      uniqueTaskArns.length === 0
        ? { tasks: [] }
        : await retryOp(
            () =>
              operations.describeTasks({
                clusterName: identity.clusterName,
                taskArns: uniqueTaskArns,
              }),
            context,
          );
    await context.onPage();
    observations.push(
      observation(
        context,
        ECS_TASKS_KIND,
        ECS_DESCRIBE_TASKS,
        normaliseTasks(objectList(readValue(described, 'tasks', 'Tasks'))),
        {
          clusterName: identity.clusterName,
          taskArns: uniqueTaskArns,
        },
      ),
    );
    const targetGroupArns = stringList(servicePayload['targetGroupArns']);
    for (const arn of targetGroupArns) {
      assertTargetGroupInScope(context.scope, arn);
    }
    if (targetGroupArns.length !== 1) {
      if (targetGroupArns.length > 1) {
        const groups = await retryOp(
          () => operations.describeTargetGroups({ targetGroupArns }),
          context,
        );
        await context.onPage();
        observations.push(
          observation(
            context,
            ELB_TARGET_GROUP_KIND,
            ELB_DESCRIBE_TARGET_GROUPS,
            normaliseTargetGroups(objectList(readValue(groups, 'targetGroups', 'TargetGroups'))),
            { targetGroupArns },
          ),
        );
      } else {
        observations.push(
          observation(
            context,
            ELB_TARGET_GROUP_KIND,
            ELB_DESCRIBE_TARGET_GROUPS,
            {
              targetGroups: [],
              complete: true,
            },
            { targetGroupArns: [] },
          ),
        );
      }
      observations.push(
        observation(
          context,
          ELB_TARGET_HEALTH_KIND,
          ELB_DESCRIBE_TARGET_HEALTH,
          {
            targetGroupArn: '',
            targets: [],
            complete: false,
          },
          { targetGroupArn: '', reason: 'ambiguous-or-empty-target-group-set' },
        ),
      );
      return observations;
    }
    const uniqueArn = targetGroupArns[0];
    if (!uniqueArn) {
      throw new Error('unique target group missing after length check');
    }
    const groups = await retryOp(
      () => operations.describeTargetGroups({ targetGroupArns }),
      context,
    );
    await context.onPage();
    observations.push(
      observation(
        context,
        ELB_TARGET_GROUP_KIND,
        ELB_DESCRIBE_TARGET_GROUPS,
        normaliseTargetGroups(objectList(readValue(groups, 'targetGroups', 'TargetGroups'))),
        { targetGroupArns },
      ),
    );
    const healthTargets: JsonObject[] = [];
    let healthToken: string | null = null;
    do {
      const page = await retryOp(
        () => operations.describeTargetHealth({ targetGroupArn: uniqueArn }, healthToken),
        context,
      );
      await context.onPage();
      healthTargets.push(
        ...objectList(
          readValue(page.payload, 'targetHealthDescriptions', 'TargetHealthDescriptions'),
        ),
      );
      healthToken = page.nextToken;
    } while (healthToken);
    observations.push(
      observation(
        context,
        ELB_TARGET_HEALTH_KIND,
        ELB_DESCRIBE_TARGET_HEALTH,
        normaliseTargetHealth(uniqueArn, healthTargets),
        { targetGroupArn: uniqueArn, cursor: healthToken },
      ),
    );
    return observations;
  } catch (error) {
    if (error instanceof OutOfScopeError) {
      throw error;
    }
    return handleCollectError(error, REQUIRED_INVENTORY_KINDS, context);
  }
}

export async function collectTelemetry(
  operations: AwsOperations,
  context: CollectContext,
): Promise<readonly CollectorObservation[]> {
  const identity = splitEcsResourceId(context.scope.resourceId);
  try {
    const alarms: JsonObject[] = [];
    let alarmToken: string | null = null;
    let pages = 0;
    let complete = true;
    do {
      const page = await retryOp(() => operations.describeAlarms(alarmToken), context);
      await context.onPage();
      pages += 1;
      alarms.push(...objectList(readValue(page.payload, 'metricAlarms', 'MetricAlarms')));
      alarmToken = page.nextToken;
      if (pages >= ALARM_PAGE_BOUND && alarmToken) {
        complete = false;
        break;
      }
    } while (alarmToken);
    const alarmPayload = normaliseAlarms(alarms, complete);
    const observations: CollectorObservation[] = [
      observation(context, CW_ALARMS_KIND, CW_DESCRIBE_ALARMS, alarmPayload, {
        pages,
        complete,
        pageBound: ALARM_PAGE_BOUND,
        cursor: alarmToken,
      }),
    ];
    const metricPoints: JsonObject[] = [];
    let metricToken: string | null = null;
    const metricComplete = true;
    do {
      const page = await retryOp(
        () =>
          operations.getMetricData(
            {
              clusterName: identity.clusterName,
              serviceName: identity.serviceName,
              from: context.window.from,
              to: context.window.to,
            },
            metricToken,
          ),
        context,
      );
      await context.onPage();
      const results = objectList(readValue(page.payload, 'metricDataResults', 'MetricDataResults'));
      for (const result of results) {
        const timestamps = Array.isArray(readValue(result, 'timestamps', 'Timestamps'))
          ? (readValue(result, 'timestamps', 'Timestamps') as unknown[])
          : [];
        const values = Array.isArray(readValue(result, 'values', 'Values'))
          ? (readValue(result, 'values', 'Values') as unknown[])
          : [];
        timestamps.forEach((timestamp, index) => {
          if (typeof timestamp === 'string' && typeof values[index] === 'number') {
            metricPoints.push({ timestamp, value: values[index] });
          }
        });
        metricPoints.push(...objectList(readValue(result, 'datapoints', 'Datapoints')));
      }
      metricToken = page.nextToken;
    } while (metricToken);
    const metricPayload = normaliseMetrics(metricPoints, metricComplete);
    observations.push(
      observation(
        context,
        CW_RUNNING_TASK_METRIC_KIND,
        CW_GET_METRIC_DATA,
        metricPayload,
        {
          clusterName: identity.clusterName,
          serviceName: identity.serviceName,
          namespace: 'AWS/ECS',
          metricName: 'RunningTaskCount',
          window: { from: context.window.from, to: context.window.to },
          cursor: metricToken,
        },
        newestMetricTimestamp(metricPayload),
      ),
    );
    return observations;
  } catch (error) {
    if (error instanceof OutOfScopeError) {
      throw error;
    }
    return handleCollectError(error, REQUIRED_TELEMETRY_KINDS, context);
  }
}

function observation(
  context: CollectContext,
  kind: string,
  operation: string,
  payload: JsonObject,
  query: JsonObject,
  observedAt?: string,
): CollectorObservation {
  return {
    kind,
    payload,
    inaccessible: payload['inaccessible'] === true,
    operation,
    adapter: AWS_ADAPTER,
    requestDigest: requestDigest({
      operation,
      resource: context.scope,
      window: context.window,
      query,
    }),
    ...(observedAt === undefined ? {} : { observedAt }),
  };
}

function allInaccessible(
  kinds: readonly string[],
  context: CollectContext,
  errorCode: InaccessibleErrorCode,
): CollectorObservation[] {
  const operations: Record<string, string> = {
    [ECS_SERVICE_KIND]: ECS_DESCRIBE_SERVICES,
    [ECS_TASKS_KIND]: ECS_DESCRIBE_TASKS,
    [ELB_TARGET_GROUP_KIND]: ELB_DESCRIBE_TARGET_GROUPS,
    [ELB_TARGET_HEALTH_KIND]: ELB_DESCRIBE_TARGET_HEALTH,
    [CW_ALARMS_KIND]: CW_DESCRIBE_ALARMS,
    [CW_RUNNING_TASK_METRIC_KIND]: CW_GET_METRIC_DATA,
  };
  return kinds.map((kind) =>
    observation(context, kind, operations[kind] ?? kind, inaccessible(errorCode), { errorCode }),
  );
}

function handleCollectError(
  error: unknown,
  kinds: readonly string[],
  context: CollectContext,
): CollectorObservation[] {
  if (error instanceof OutOfScopeError) {
    throw error;
  }
  if (error instanceof FixtureUnavailableError) {
    return allInaccessible(kinds, context, error.errorCode);
  }
  return allInaccessible(kinds, context, 'unavailable');
}

async function retryOp<T>(operation: () => Promise<T>, context: CollectContext): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof FixtureUnavailableError && error.errorCode === 'throttled') {
      await context.onPage();
      return operation();
    }
    throw error;
  }
}

export { asObject };
