import type { Detector, DetectorInput, DetectorOutput } from '@grounds/application';
import {
  CW_ALARMS_KIND,
  ECS_OBS_DETECTOR_ID,
  ECS_OBS_DETECTOR_VERSION,
  ECS_SERVICE_KIND,
  detectorParametersDigest,
  findingFingerprint,
  severityFor,
} from '@grounds/domain';
import {
  identityFromResource,
  observationsOfKind,
  parseAlarmsPayload,
  parseServicePayload,
  requiredUnusable,
} from './payload.js';

export class GrdObs001 implements Detector {
  public readonly id = ECS_OBS_DETECTOR_ID;
  public readonly version = ECS_OBS_DETECTOR_VERSION;

  public evaluate(input: DetectorInput): DetectorOutput {
    const alarmsObs = observationsOfKind(input.observations, CW_ALARMS_KIND)[0];
    const serviceObs = observationsOfKind(input.observations, ECS_SERVICE_KIND)[0];
    const cited = [alarmsObs, serviceObs].filter(
      (item): item is NonNullable<typeof item> => item !== undefined,
    );
    const observationIds = (cited.length > 0 ? cited : input.observations).map((item) => item.id);
    if (observationIds.length === 0) {
      throw new Error('GRD-OBS-001 cannot emit a finding without an observation');
    }
    const identity = identityFromResource(input.run.resourceScope.resourceId);
    const alarms = alarmsObs ? parseAlarmsPayload(alarmsObs.payload) : undefined;
    const service = serviceObs ? parseServicePayload(serviceObs.payload) : undefined;
    const inventoryComplete =
      !requiredUnusable(alarmsObs) && alarms !== undefined && alarms.complete;
    const targetGroupArns = [...new Set(service?.targetGroupArns ?? [])].sort();
    const uniqueGroup = targetGroupArns.length === 1 ? targetGroupArns[0] : undefined;
    const ambiguousGroups = targetGroupArns.length !== 1;

    const unhealthyTargetAlarm =
      inventoryComplete &&
      uniqueGroup !== undefined &&
      alarms.alarms.some(
        (alarm) =>
          alarm.actionsEnabled &&
          alarm.alarmActions.some((arn) => arn.length > 0) &&
          alarm.namespace === 'AWS/ApplicationELB' &&
          alarm.metricName === 'UnHealthyHostCount' &&
          uniqueGroup !== undefined &&
          targetGroupDimensionMatches(alarm.dimensions['TargetGroup'], uniqueGroup),
      );
    const runningTaskAlarm =
      inventoryComplete &&
      alarms.alarms.some(
        (alarm) =>
          alarm.actionsEnabled &&
          alarm.alarmActions.some((arn) => arn.length > 0) &&
          alarm.namespace === 'ECS/ContainerInsights' &&
          alarm.metricName === 'RunningTaskCount' &&
          alarm.dimensions['ClusterName'] === identity.clusterName &&
          alarm.dimensions['ServiceName'] === identity.serviceName,
      );

    let result: DetectorOutput['result'] = 'FAIL';
    if (!inventoryComplete || requiredUnusable(serviceObs) || service === undefined) {
      result = 'UNKNOWN';
    } else if (ambiguousGroups) {
      result = runningTaskAlarm ? 'PASS' : 'UNKNOWN';
    } else if (unhealthyTargetAlarm || runningTaskAlarm) {
      result = 'PASS';
    }

    const condition = {
      unhealthyTargetAlarm,
      runningTaskAlarm,
    };
    return {
      detectorId: this.id,
      detectorVersion: this.version,
      result,
      severity: severityFor(result),
      title:
        result === 'FAIL'
          ? 'No covering CloudWatch alarm has a configured notification action'
          : result === 'UNKNOWN'
            ? 'CloudWatch alarm inventory is incomplete or target-group scope is ambiguous'
            : 'A covering CloudWatch alarm has a configured notification action',
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

function explanation(result: DetectorOutput['result']): string {
  if (result === 'FAIL') {
    return 'Alarm inventory is complete and no enabled alarm in scope covers unhealthy target count or a sustained running-task deficit with at least one configured notification action ARN. This does not claim that an owner is notified or that an SNS topic has subscriptions.';
  }
  if (result === 'UNKNOWN') {
    return 'GRD-OBS-001 returns UNKNOWN when DescribeAlarms inventory is incomplete, truncated, stale or inaccessible, or when the service target-group set is empty or ambiguous without a covering RunningTaskCount alarm.';
  }
  return 'Alarm inventory is complete and at least one covering alarm has a configured notification action. Delivery to an owner is not evidenced.';
}

export function targetGroupDimensionMatches(
  dimensionValue: string | undefined,
  targetGroupArn: string,
): boolean {
  if (dimensionValue === undefined || dimensionValue.length === 0) {
    return false;
  }
  if (dimensionValue === targetGroupArn) {
    return true;
  }
  const suffix = targetGroupResourceSuffix(targetGroupArn);
  return suffix.length > 0 && dimensionValue === suffix;
}

function targetGroupResourceSuffix(targetGroupArn: string): string {
  const parts = targetGroupArn.split(':');
  if (parts.length < 6) {
    return '';
  }
  const resource = parts.slice(5).join(':');
  return resource.startsWith('targetgroup/') ? resource : '';
}
