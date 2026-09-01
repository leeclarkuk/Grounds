import { REDACTED, redactUnknown, type JsonValue } from '@grounds/domain';

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

export function log(
  level: 'info' | 'error' | 'warn',
  message: string,
  fields: LogFields = {},
  error?: unknown,
): void {
  const record: { [key: string]: JsonValue } = { level, message };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    record[key] = value;
  }
  if (error !== undefined) {
    record['error'] = closedErrorDetail(error);
  }
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(redactUnknown(record))}\n`);
}

function closedErrorDetail(error: unknown): JsonValue {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  if (error !== null && typeof error === 'object' && !Array.isArray(error)) {
    const record = error as { readonly name?: unknown; readonly message?: unknown };
    const closed: { [key: string]: JsonValue } = {};
    if (typeof record.name === 'string') {
      closed['name'] = record.name;
    }
    if (typeof record.message === 'string') {
      closed['message'] = record.message;
    }
    if (Object.keys(closed).length > 0) {
      return closed;
    }
  }
  if (typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean') {
    return error;
  }
  return REDACTED;
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
