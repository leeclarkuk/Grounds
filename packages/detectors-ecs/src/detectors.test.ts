import { describe, expect, it } from 'vitest';

import type { DetectorInput, ObservationRecord } from '@grounds/application';
import {
  CW_ALARMS_KIND,
  CW_RUNNING_TASK_METRIC_KIND,
  ECS_SERVICE_KIND,
  ECS_TASKS_KIND,
  ELB_TARGET_GROUP_KIND,
  ELB_TARGET_HEALTH_KIND,
  type ResourceRef,
} from '@grounds/domain';
import { GrdEcs001 } from './grd-ecs-001.js';
import { GrdObs001 } from './grd-obs-001.js';

const PAYMENTS_SERVICE: ResourceRef = {
  provider: 'aws',
  accountId: '123456789012',
  region: 'eu-west-2',
  service: 'ecs',
  resourceType: 'service',
  resourceId: 'payments-cluster/payments',
};
const TG = 'arn:aws:elasticloadbalancing:eu-west-2:123456789012:targetgroup/pay/abc';
const PARAMETERS = {
  replacementCountThreshold: 2,
  runningDeficitThreshold: 1,
  unhealthyTargetReasons: ['Target.FailedHealthChecks'],
  deficitSustainedFraction: 0.8,
};

function obs(
  kind: string,
  payload: ObservationRecord['payload'],
  overrides: Partial<ObservationRecord> = {},
): ObservationRecord {
  return {
    id: `obs-${kind}`,
    runId: 'run',
    organisationId: 'org_grounds_dev',
    kind,
    resource: PAYMENTS_SERVICE,
    collectedAt: '2026-08-31T00:30:00.000Z',
    window: { from: '2026-08-31T00:00:00.000Z', to: '2026-08-31T01:00:00.000Z' },
    sourceAdapter: 'adapter-aws',
    sourceOperation: kind,
    requestDigest: 'req',
    freshness: 'FRESH',
    payload,
    payloadDigest: 'p',
    redactionVersion: 'redaction.v1',
    truncated: false,
    inaccessible: false,
    contentIdentity: kind,
    ...overrides,
  };
}

function baseObservations(): ObservationRecord[] {
  return [
    obs(ECS_SERVICE_KIND, {
      clusterName: 'payments-cluster',
      serviceName: 'payments',
      desiredCount: 2,
      runningCount: 2,
      runningTaskArns: ['arn:task/1', 'arn:task/2'],
      targetGroupArns: [TG],
      complete: true,
    }),
    obs(ECS_TASKS_KIND, {
      tasks: [
        { taskArn: 'arn:task/1', lastStatus: 'RUNNING', desiredStatus: 'RUNNING', stoppedAt: null },
        { taskArn: 'arn:task/2', lastStatus: 'RUNNING', desiredStatus: 'RUNNING', stoppedAt: null },
      ],
      complete: true,
    }),
    obs(ELB_TARGET_GROUP_KIND, {
      targetGroups: [{ targetGroupArn: TG, healthCheckPath: '/health', matcher: '200' }],
      complete: true,
    }),
    obs(ELB_TARGET_HEALTH_KIND, {
      targetGroupArn: TG,
      targets: [{ id: 'i-1', state: 'healthy', reason: '' }],
      complete: true,
    }),
    obs(CW_RUNNING_TASK_METRIC_KIND, {
      datapoints: [
        { timestamp: '2026-08-31T00:10:00.000Z', value: 2 },
        { timestamp: '2026-08-31T00:20:00.000Z', value: 2 },
      ],
      complete: true,
    }),
    obs(CW_ALARMS_KIND, {
      alarms: [
        {
          alarmName: 'unhealthy',
          namespace: 'AWS/ApplicationELB',
          metricName: 'UnHealthyHostCount',
          dimensions: [{ name: 'TargetGroup', value: TG }],
          actionsEnabled: true,
          alarmActions: ['arn:aws:sns:eu-west-2:123456789012:ops'],
        },
      ],
      complete: true,
    }),
  ];
}

function input(observations: ObservationRecord[]): DetectorInput {
  return {
    run: {
      id: 'run',
      organisationId: 'org_grounds_dev',
      profileVersionId: 'profile',
      authorisationGrantId: 'grant',
      resourceScope: PAYMENTS_SERVICE,
      resourceScopeDigest: 'digest',
      evidenceWindow: { from: '2026-08-31T00:00:00.000Z', to: '2026-08-31T01:00:00.000Z' },
      detectorVersions: { 'GRD-ECS-001': '1', 'GRD-OBS-001': '1' },
      state: 'evaluating',
      result: null,
      clientIdempotencyKey: 'k',
      requestDigest: 'r',
      runIdentityDigest: 'i',
      cancelRequestedAt: null,
      collectorAttemptCount: 1,
      createdAt: '2026-08-31T00:00:00.000Z',
      startedAt: '2026-08-31T00:00:01.000Z',
      updatedAt: '2026-08-31T00:00:01.000Z',
      terminalAt: null,
    },
    observations,
    detectorParameters: PARAMETERS,
  };
}

describe('GRD-ECS-001', () => {
  const detector = new GrdEcs001();

  it('returns PASS on a healthy service', () => {
    expect(detector.evaluate(input(baseObservations())).result).toBe('PASS');
  });

  it('returns FAIL for repeated unhealthy replacement', () => {
    const observations = baseObservations();
    const health = observations.find((item) => item.kind === ELB_TARGET_HEALTH_KIND);
    const tasks = observations.find((item) => item.kind === ECS_TASKS_KIND);
    if (!health || !tasks) {
      throw new Error('missing');
    }
    observations.splice(
      observations.indexOf(health),
      1,
      obs(ELB_TARGET_HEALTH_KIND, {
        targetGroupArn: TG,
        targets: [{ id: 'i-1', state: 'unhealthy', reason: 'Target.FailedHealthChecks' }],
        complete: true,
      }),
    );
    observations.splice(
      observations.indexOf(tasks),
      1,
      obs(ECS_TASKS_KIND, {
        tasks: [
          {
            taskArn: 'arn:task/old-1',
            lastStatus: 'STOPPED',
            desiredStatus: 'STOPPED',
            stoppedAt: '2026-08-31T00:10:00.000Z',
          },
          {
            taskArn: 'arn:task/old-2',
            lastStatus: 'STOPPED',
            desiredStatus: 'STOPPED',
            stoppedAt: '2026-08-31T00:20:00.000Z',
          },
          {
            taskArn: 'arn:task/1',
            lastStatus: 'RUNNING',
            desiredStatus: 'RUNNING',
            stoppedAt: null,
          },
          {
            taskArn: 'arn:task/2',
            lastStatus: 'RUNNING',
            desiredStatus: 'RUNNING',
            stoppedAt: null,
          },
        ],
        complete: true,
      }),
    );
    const finding = detector.evaluate(input(observations));
    expect(finding.result).toBe('FAIL');
    expect(finding.explanation).not.toMatch(/missing application route/i);
  });

  it('returns UNKNOWN for missing, stale, truncated or contradictory evidence', () => {
    expect(detector.evaluate(input([])).result).toBe('UNKNOWN');
    const stale = baseObservations().map((item) =>
      item.kind === ECS_SERVICE_KIND ? { ...item, freshness: 'STALE' as const } : item,
    );
    expect(detector.evaluate(input(stale)).result).toBe('UNKNOWN');
    const truncated = baseObservations().map((item) =>
      item.kind === ELB_TARGET_GROUP_KIND ? { ...item, truncated: true } : item,
    );
    expect(detector.evaluate(input(truncated)).result).toBe('UNKNOWN');
    const mismatch = baseObservations();
    const health = mismatch.find((item) => item.kind === ELB_TARGET_HEALTH_KIND);
    if (!health) {
      throw new Error('missing');
    }
    mismatch.splice(
      mismatch.indexOf(health),
      1,
      obs(ELB_TARGET_HEALTH_KIND, {
        targetGroupArn: 'arn:aws:elasticloadbalancing:eu-west-2:123456789012:targetgroup/other/x',
        targets: [{ id: 'i-1', state: 'unhealthy', reason: 'Target.FailedHealthChecks' }],
        complete: true,
      }),
    );
    expect(detector.evaluate(input(mismatch)).result).toBe('UNKNOWN');
  });

  it('returns UNKNOWN for zero or multiple target groups', () => {
    const none = baseObservations();
    const service = none.find((item) => item.kind === ECS_SERVICE_KIND);
    if (!service) {
      throw new Error('missing');
    }
    none.splice(
      none.indexOf(service),
      1,
      obs(ECS_SERVICE_KIND, {
        clusterName: 'payments-cluster',
        serviceName: 'payments',
        desiredCount: 2,
        runningCount: 2,
        runningTaskArns: ['arn:task/1', 'arn:task/2'],
        targetGroupArns: [],
        complete: true,
      }),
    );
    expect(detector.evaluate(input(none)).result).toBe('UNKNOWN');
  });

  it('keeps fingerprints stable across equivalent observations', () => {
    const first = detector.evaluate(input(baseObservations())).fingerprint;
    const second = detector.evaluate(input(baseObservations())).fingerprint;
    expect(first).toBe(second);
  });
});

describe('GRD-OBS-001', () => {
  const detector = new GrdObs001();

  it('returns PASS when a covering alarm has configured actions', () => {
    const finding = detector.evaluate(input(baseObservations()));
    expect(finding.result).toBe('PASS');
    expect(finding.explanation).not.toMatch(/owner is notified/i);
    expect(finding.explanation).not.toMatch(/subscription/i);
  });

  it('returns FAIL when inventory is complete and no covering alarm exists', () => {
    const observations = baseObservations().filter((item) => item.kind !== CW_ALARMS_KIND);
    observations.push(
      obs(CW_ALARMS_KIND, {
        alarms: [
          {
            alarmName: 'cpu',
            namespace: 'AWS/ECS',
            metricName: 'CPUUtilization',
            dimensions: [
              { name: 'ClusterName', value: 'payments-cluster' },
              { name: 'ServiceName', value: 'payments' },
            ],
            actionsEnabled: true,
            alarmActions: ['arn:aws:sns:eu-west-2:123456789012:ops'],
          },
        ],
        complete: true,
      }),
    );
    expect(detector.evaluate(input(observations)).result).toBe('FAIL');
  });

  it('does not treat another cluster as coverage', () => {
    const observations = baseObservations().filter((item) => item.kind !== CW_ALARMS_KIND);
    observations.push(
      obs(CW_ALARMS_KIND, {
        alarms: [
          {
            alarmName: 'tasks',
            namespace: 'AWS/ECS',
            metricName: 'RunningTaskCount',
            dimensions: [
              { name: 'ClusterName', value: 'other-cluster' },
              { name: 'ServiceName', value: 'payments' },
            ],
            actionsEnabled: true,
            alarmActions: ['arn:aws:sns:eu-west-2:123456789012:ops'],
          },
        ],
        complete: true,
      }),
    );
    expect(detector.evaluate(input(observations)).result).toBe('FAIL');
  });

  it('returns UNKNOWN when alarm inventory is incomplete', () => {
    const observations = baseObservations().filter((item) => item.kind !== CW_ALARMS_KIND);
    observations.push(obs(CW_ALARMS_KIND, { alarms: [], complete: false }, { inaccessible: true }));
    expect(detector.evaluate(input(observations)).result).toBe('UNKNOWN');
  });

  it('returns UNKNOWN for ambiguous target groups without a RunningTaskCount alarm', () => {
    const observations = baseObservations();
    const service = observations.find((item) => item.kind === ECS_SERVICE_KIND);
    if (!service) {
      throw new Error('missing');
    }
    observations.splice(
      observations.indexOf(service),
      1,
      obs(ECS_SERVICE_KIND, {
        clusterName: 'payments-cluster',
        serviceName: 'payments',
        desiredCount: 2,
        runningCount: 2,
        runningTaskArns: ['arn:task/1', 'arn:task/2'],
        targetGroupArns: [TG, `${TG}2`],
        complete: true,
      }),
    );
    const withoutTasksAlarm = observations.filter((item) => item.kind !== CW_ALARMS_KIND);
    withoutTasksAlarm.push(obs(CW_ALARMS_KIND, { alarms: [], complete: true }));
    expect(detector.evaluate(input(withoutTasksAlarm)).result).toBe('UNKNOWN');
  });
});
