export const ALLOWED_AWS_COMMANDS = [
  'DescribeServicesCommand',
  'ListTasksCommand',
  'DescribeTasksCommand',
  'DescribeTargetGroupsCommand',
  'DescribeTargetHealthCommand',
  'DescribeAlarmsCommand',
  'GetMetricDataCommand',
  'GetCallerIdentityCommand',
  'AssumeRoleCommand',
] as const;

export type AllowedAwsCommand = (typeof ALLOWED_AWS_COMMANDS)[number];
