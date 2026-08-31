export type LogFields = {
  readonly traceId?: string;
  readonly runId?: string;
  readonly stepId?: string;
  readonly attempt?: number;
  readonly leaseEpoch?: number;
  readonly profileVersionId?: string;
  readonly resourceFingerprint?: string;
  readonly [key: string]: string | number | boolean | undefined;
};

const SECRET = /(password|secret|credential|authorization|token|accesskey|session)/i;

export function log(
  level: 'info' | 'error' | 'warn',
  message: string,
  fields: LogFields = {},
): void {
  const safe: { [key: string]: string | number | boolean } = { level, message };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || SECRET.test(key)) {
      continue;
    }
    if (typeof value === 'string' && SECRET.test(value)) {
      continue;
    }
    safe[key] = value;
  }
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(safe)}\n`);
}

export class Metrics {
  public runCount = 0;
  public leaseRecoveries = 0;
  public duplicateConflicts = 0;
  public rejectedOutOfScope = 0;
  public detectorTotals: { PASS: number; FAIL: number; UNKNOWN: number } = {
    PASS: 0,
    FAIL: 0,
    UNKNOWN: 0,
  };
}

export const metrics = new Metrics();
