export const RUN_STATES = [
  'queued',
  'collecting',
  'evaluating',
  'healthy',
  'findings',
  'failed',
  'cancelled',
] as const;

export type RunState = (typeof RUN_STATES)[number];

export const TERMINAL_RUN_STATES = ['healthy', 'findings', 'failed', 'cancelled'] as const;
export type TerminalRunState = (typeof TERMINAL_RUN_STATES)[number];

const ALLOWED: { readonly [K in RunState]: readonly RunState[] } = {
  queued: ['collecting', 'cancelled'],
  collecting: ['evaluating', 'failed', 'cancelled'],
  evaluating: ['healthy', 'findings', 'failed'],
  healthy: [],
  findings: [],
  failed: [],
  cancelled: [],
};

export function isRunState(value: string): value is RunState {
  return (RUN_STATES as readonly string[]).includes(value);
}

export function assertRunTransition(from: RunState, to: RunState): void {
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`illegal run transition ${from} -> ${to}`);
  }
}

export function isLegalRunTransition(from: RunState, to: RunState): boolean {
  return ALLOWED[from].includes(to);
}

export function allowedRunTransitions(from: RunState): readonly RunState[] {
  return ALLOWED[from];
}

export const ASSURANCE_RESULTS = ['PASS', 'FAIL', 'UNKNOWN'] as const;
export type AssuranceResult = (typeof ASSURANCE_RESULTS)[number];

export function summariseResults(results: readonly AssuranceResult[]): AssuranceResult {
  if (results.some((result) => result === 'FAIL')) {
    return 'FAIL';
  }
  if (results.some((result) => result === 'UNKNOWN')) {
    return 'UNKNOWN';
  }
  return 'PASS';
}

export function terminalStateForResults(
  results: readonly AssuranceResult[],
): 'healthy' | 'findings' {
  return summariseResults(results) === 'PASS' ? 'healthy' : 'findings';
}
