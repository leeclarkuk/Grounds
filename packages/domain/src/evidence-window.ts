export type EvidenceWindow = {
  readonly from: string;
  readonly to: string;
};

export function parseEvidenceWindow(value: unknown): EvidenceWindow {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('evidence window must be an object');
  }
  const record = value as { readonly [key: string]: unknown };
  const from = asInstant(record['from'], 'from');
  const to = asInstant(record['to'], 'to');
  if (Date.parse(from) >= Date.parse(to)) {
    throw new Error('evidence window from must be before to');
  }
  return { from, to };
}

function asInstant(value: unknown, field: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an RFC 3339 timestamp`);
  }
  return new Date(value).toISOString();
}
