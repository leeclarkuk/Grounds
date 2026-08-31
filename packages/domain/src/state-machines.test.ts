import { describe, expect, it } from 'vitest';

import {
  allowedRunTransitions,
  assertRunTransition,
  isLegalRunTransition,
  RUN_STATES,
  summariseResults,
  terminalStateForResults,
} from './run-state.js';
import {
  allowedStepTransitions,
  assertStepTransition,
  backoffSeconds,
  isLegalStepTransition,
  MAX_STEP_ATTEMPTS,
  STEP_STATES,
  type StepState,
} from './step-state.js';
import { ERROR_MESSAGES } from './error-class.js';

describe('run state machine', () => {
  const allowedPairs = new Set(
    RUN_STATES.flatMap((from) => allowedRunTransitions(from).map((to) => `${from}->${to}`)),
  );

  it.each(RUN_STATES.flatMap((from) => RUN_STATES.map((to) => [from, to] as const)))(
    '%s -> %s',
    (from, to) => {
      const allowed = allowedPairs.has(`${from}->${to}`);
      expect(isLegalRunTransition(from, to)).toBe(allowed);
      if (allowed) {
        expect(() => assertRunTransition(from, to)).not.toThrow();
      } else {
        expect(() => assertRunTransition(from, to)).toThrow(/illegal run transition/);
      }
    },
  );

  it('does not allow evaluating to remain evaluating or become healthy on UNKNOWN', () => {
    expect(terminalStateForResults(['UNKNOWN'])).toBe('findings');
    expect(terminalStateForResults(['PASS', 'UNKNOWN'])).toBe('findings');
    expect(terminalStateForResults(['PASS'])).toBe('healthy');
    expect(summariseResults(['PASS', 'FAIL', 'UNKNOWN'])).toBe('FAIL');
    expect(summariseResults(['PASS', 'UNKNOWN'])).toBe('UNKNOWN');
  });
});

describe('step state machine', () => {
  const allowedPairs = new Set(
    STEP_STATES.flatMap((from) => allowedStepTransitions(from).map((to) => `${from}->${to}`)),
  );

  it.each(STEP_STATES.flatMap((from) => STEP_STATES.map((to) => [from, to] as const)))(
    '%s -> %s',
    (from: StepState, to: StepState) => {
      const allowed = allowedPairs.has(`${from}->${to}`);
      expect(isLegalStepTransition(from, to)).toBe(allowed);
      if (allowed) {
        expect(() => assertStepTransition(from, to)).not.toThrow();
      } else {
        expect(() => assertStepTransition(from, to)).toThrow(/illegal step transition/);
      }
    },
  );

  it('caps attempts at 5 and uses the specified backoff', () => {
    expect(MAX_STEP_ATTEMPTS).toBe(5);
    expect([1, 2, 3, 4, 5].map((attempt) => backoffSeconds(attempt))).toEqual([1, 2, 4, 8, 16]);
    expect(backoffSeconds(6)).toBe(16);
  });
});

describe('error messages', () => {
  it('uses the closed mapping', () => {
    expect(ERROR_MESSAGES).toEqual({
      attempts_exhausted: 'step attempts exhausted',
      persist_failure: 'durable persist failed',
      invariant_violation: 'orchestration invariant violated',
      cancelled: 'run cancelled',
    });
  });
});
