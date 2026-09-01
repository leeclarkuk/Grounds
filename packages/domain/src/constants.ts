export const FAKE_DETECTOR_ID = 'GRD-FAKE-001';
export const FAKE_DETECTOR_VERSION = '1';
export const FAKE_INVENTORY_KIND = 'fake.inventory';
export const FAKE_TELEMETRY_KIND = 'fake.telemetry';
export const FAKE_INVENTORY_OPERATION = 'fake.DescribeInventory';
export const FAKE_TELEMETRY_OPERATION = 'fake.GetTelemetry';
export const FAKE_ADAPTER = 'fixture';

export const ECS_SERVICE_DETECTOR_ID = 'GRD-ECS-001';
export const ECS_SERVICE_DETECTOR_VERSION = '1';
export const ECS_OBS_DETECTOR_ID = 'GRD-OBS-001';
export const ECS_OBS_DETECTOR_VERSION = '1';
export const ECS_DETECTOR_IDS = [ECS_SERVICE_DETECTOR_ID, ECS_OBS_DETECTOR_ID] as const;

export const ECS_SERVICE_KIND = 'ecs.service';
export const ECS_TASKS_KIND = 'ecs.tasks';
export const ELB_TARGET_GROUP_KIND = 'elb.target_group';
export const ELB_TARGET_HEALTH_KIND = 'elb.target_health';
export const CW_ALARMS_KIND = 'cloudwatch.alarms';
export const CW_RUNNING_TASK_METRIC_KIND = 'cloudwatch.metrics.running_task_count';

export const REQUIRED_INVENTORY_KINDS = [
  ECS_SERVICE_KIND,
  ECS_TASKS_KIND,
  ELB_TARGET_GROUP_KIND,
  ELB_TARGET_HEALTH_KIND,
] as const;

export const REQUIRED_TELEMETRY_KINDS = [CW_ALARMS_KIND, CW_RUNNING_TASK_METRIC_KIND] as const;

export const ECS_DESCRIBE_SERVICES = 'ecs.DescribeServices';
export const ECS_LIST_TASKS = 'ecs.ListTasks';
export const ECS_DESCRIBE_TASKS = 'ecs.DescribeTasks';
export const ELB_DESCRIBE_TARGET_GROUPS = 'elasticloadbalancing.DescribeTargetGroups';
export const ELB_DESCRIBE_TARGET_HEALTH = 'elasticloadbalancing.DescribeTargetHealth';
export const CW_DESCRIBE_ALARMS = 'cloudwatch.DescribeAlarms';
export const CW_GET_METRIC_DATA = 'cloudwatch.GetMetricData';
export const STS_GET_CALLER_IDENTITY = 'sts.GetCallerIdentity';
export const STS_ASSUME_ROLE = 'sts.AssumeRole';

export const AWS_ADAPTER = 'adapter-aws';
export const AWS_SESSION_SECONDS = 900;
export const AWS_SESSION_REFRESH_SKEW_SECONDS = 60;
export const GRANT_TTL_SECONDS = 300;
export const MAX_EVIDENCE_WINDOW_SECONDS = 3600;
export const ALARM_PAGE_BOUND = 20;
export const ECS_DESCRIBE_TASKS_BATCH = 100;
export const CW_RUNNING_TASK_METRIC_NAME = 'RunningTaskCount';
export const CW_RUNNING_TASK_NAMESPACE = 'ECS/ContainerInsights';

export const DEFAULT_ECS_DETECTOR_PARAMETERS = {
  replacementCountThreshold: 2,
  runningDeficitThreshold: 1,
  unhealthyTargetReasons: ['Target.FailedHealthChecks'],
  deficitSustainedFraction: 0.8,
} as const;
