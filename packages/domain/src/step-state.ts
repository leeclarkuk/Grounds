export const STEP_TYPES = ['collect', 'evaluate'] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const STEP_STATES = [
  'blocked',
  'ready',
  'leased',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type StepState = (typeof STEP_STATES)[number];

const ALLOWED: { readonly [K in StepState]: readonly StepState[] } = {
  blocked: ['ready'],
  ready: ['leased', 'failed', 'cancelled'],
  leased: ['leased', 'ready', 'succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export const MAX_STEP_ATTEMPTS = 5;

export function isStepState(value: string): value is StepState {
  return (STEP_STATES as readonly string[]).includes(value);
}

export function assertStepTransition(from: StepState, to: StepState): void {
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`illegal step transition ${from} -> ${to}`);
  }
}

export function isLegalStepTransition(from: StepState, to: StepState): boolean {
  return ALLOWED[from].includes(to);
}

export function allowedStepTransitions(from: StepState): readonly StepState[] {
  return ALLOWED[from];
}

export function backoffSeconds(attempt: number): number {
  if (attempt < 1) {
    return 1;
  }
  return Math.min(16, 2 ** (attempt - 1));
}

export function eligibleRunStatesForStep(stepType: StepType): readonly string[] {
  return stepType === 'collect' ? ['queued', 'collecting'] : ['evaluating'];
}
