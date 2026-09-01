import type { Detector, DetectorInput, DetectorOutput } from '@grounds/application';
import {
  ECS_SERVICE_DETECTOR_ID,
  ECS_SERVICE_DETECTOR_VERSION,
  ECS_SERVICE_KIND,
  ECS_TASKS_KIND,
  ELB_TARGET_GROUP_KIND,
  ELB_TARGET_HEALTH_KIND,
  detectorParametersDigest,
  findingFingerprint,
  sha256Canonical,
  severityFor,
} from '@grounds/domain';
import {
  identityFromResource,
  observationsOfKind,
  parseDetectorParameters,
  parseServicePayload,
  parseTargetGroupsPayload,
  parseTargetHealthPayload,
  parseTasksPayload,
  parseMetricPayload,
  requiredUnusable,
} from './payload.js';
import { CW_RUNNING_TASK_METRIC_KIND } from '@grounds/domain';

export class GrdEcs001 implements Detector {
  public readonly id = ECS_SERVICE_DETECTOR_ID;
  public readonly version = ECS_SERVICE_DETECTOR_VERSION;

  public evaluate(input: DetectorInput): DetectorOutput {
    const parameters = parseDetectorParameters(input.detectorParameters);
    const serviceObs = observationsOfKind(input.observations, ECS_SERVICE_KIND)[0];
    const tasksObs = observationsOfKind(input.observations, ECS_TASKS_KIND)[0];
    const groupsObs = observationsOfKind(input.observations, ELB_TARGET_GROUP_KIND)[0];
    const healthObs = observationsOfKind(input.observations, ELB_TARGET_HEALTH_KIND)[0];
    const metricObs = observationsOfKind(input.observations, CW_RUNNING_TASK_METRIC_KIND)[0];
    const identity = identityFromResource(input.run.resourceScope.resourceId);
    const service = serviceObs ? parseServicePayload(serviceObs.payload) : undefined;
    const tasks = tasksObs ? parseTasksPayload(tasksObs.payload) : undefined;
    const groups = groupsObs ? parseTargetGroupsPayload(groupsObs.payload) : undefined;
    const health = healthObs ? parseTargetHealthPayload(healthObs.payload) : undefined;
    const metrics = metricObs ? parseMetricPayload(metricObs.payload) : undefined;
    const metricUnusable =
      requiredUnusable(metricObs) ||
      metrics === undefined ||
      !metrics.complete ||
      metrics.datapoints.length === 0;
    const targetGroupArns = [...new Set(service?.targetGroupArns ?? [])].sort();
    const targetGroupSetDigest = sha256Canonical(targetGroupArns);
    const uniqueGroup = targetGroupArns.length === 1 ? targetGroupArns[0] : undefined;
    const groupRecord = uniqueGroup
      ? groups?.targetGroups.find((item) => item.targetGroupArn === uniqueGroup)
      : undefined;

    const unknownBecause =
      requiredUnusable(serviceObs) ||
      requiredUnusable(tasksObs) ||
      requiredUnusable(groupsObs) ||
      requiredUnusable(healthObs) ||
      service === undefined ||
      tasks === undefined ||
      groups === undefined ||
      health === undefined ||
      !service.complete ||
      !tasks.complete ||
      !groups.complete ||
      !health.complete ||
      service.clusterName !== identity.clusterName ||
      service.serviceName !== identity.serviceName ||
      targetGroupArns.length !== 1 ||
      uniqueGroup === undefined ||
      groupRecord === undefined ||
      health.targetGroupArn !== uniqueGroup ||
      runningCountContradicts(service.runningCount, tasks.tasks);

    const path = groupRecord?.healthCheckPath ?? null;
    const matcher = groupRecord?.matcher ?? null;
    const healthCheckPresent = Boolean(path && matcher);

    let failClause: 'replacement' | 'deficit' | 'both' | null = null;
    let result: DetectorOutput['result'] = 'PASS';
    if (unknownBecause || !healthCheckPresent) {
      result = 'UNKNOWN';
    } else {
      const unhealthy = health.targets.some(
        (target) =>
          target.state.toLowerCase() === 'unhealthy' &&
          parameters.unhealthyTargetReasons.includes(target.reason),
      );
      const replacements = tasks.tasks.filter(
        (task) =>
          task.lastStatus === 'STOPPED' &&
          task.stoppedAt !== null &&
          task.stoppedAt >= input.run.evidenceWindow.from &&
          task.stoppedAt <= input.run.evidenceWindow.to,
      ).length;
      const snapshotDeficit = service.desiredCount - service.runningCount;
      const snapshotHits = snapshotDeficit >= parameters.runningDeficitThreshold;
      const metricHits =
        !metricUnusable &&
        sustainedDeficit(metrics, service.desiredCount, parameters.deficitSustainedFraction);
      const replacementHits = replacements >= parameters.replacementCountThreshold;
      const deficitHits = snapshotHits || metricHits;
      if (unhealthy && (replacementHits || deficitHits)) {
        result = 'FAIL';
        failClause =
          replacementHits && deficitHits ? 'both' : replacementHits ? 'replacement' : 'deficit';
      } else if (unhealthy && !replacementHits && !snapshotHits && metricUnusable) {
        result = 'UNKNOWN';
      }
    }

    const present = [serviceObs, tasksObs, groupsObs, healthObs, metricObs].filter(
      (item): item is NonNullable<typeof item> => item !== undefined,
    );
    const cited =
      result === 'PASS' ? present.filter((item) => !requiredUnusable(item)) : present;
    const observationIds = (cited.length > 0 ? cited : input.observations).map((item) => item.id);
    if (observationIds.length === 0) {
      throw new Error('GRD-ECS-001 cannot emit a finding without an observation');
    }

    const condition = {
      targetGroupSetDigest,
      healthCheckPath: path,
      matcher,
      failClause,
    };
    return {
      detectorId: this.id,
      detectorVersion: this.version,
      result,
      severity: severityFor(result),
      title:
        result === 'FAIL'
          ? 'ECS service is repeatedly replacing unhealthy tasks'
          : result === 'UNKNOWN'
            ? 'Required ECS health evidence is missing, stale or contradictory'
            : 'ECS service is not showing repeated unhealthy replacement',
      explanation: explanation(result),
      fingerprint: findingFingerprint({
        organisationId: input.run.organisationId,
        detectorId: this.id,
        detectorVersion: this.version,
        detectorParametersDigest: detectorParametersDigest(input.detectorParameters),
        resource: input.run.resourceScope,
        result,
        condition,
      }),
      observationIds,
    };
  }
}

function runningCountContradicts(
  runningCount: number,
  tasks: readonly { readonly lastStatus: string }[],
): boolean {
  const described = tasks.filter((task) => task.lastStatus === 'RUNNING').length;
  return described !== runningCount;
}

function sustainedDeficit(
  metrics: ReturnType<typeof parseMetricPayload>,
  desiredCount: number,
  fraction: number,
): boolean {
  if (!metrics || metrics.datapoints.length === 0) {
    return false;
  }
  const below = metrics.datapoints.filter((point) => point.value < desiredCount).length;
  return below / metrics.datapoints.length >= fraction;
}

function explanation(result: DetectorOutput['result']): string {
  if (result === 'FAIL') {
    return 'The load-balancer health-check contract is failing. The service is attached to the inspected target group, that group reports a health-check failure, and task replacement or a running-task deficit is evidenced in the window.';
  }
  if (result === 'UNKNOWN') {
    return 'GRD-ECS-001 returns UNKNOWN when required service, task, target-group or target-health evidence is missing, stale, truncated, inaccessible or internally contradictory, or when an unhealthy target is present and RunningTaskCount evidence cannot be used to rule out a sustained deficit.';
  }
  return 'Required ECS evidence is complete and the repeated unhealthy replacement conjunction is false.';
}
