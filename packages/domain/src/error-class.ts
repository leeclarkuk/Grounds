export const ERROR_CLASSES = [
  'attempts_exhausted',
  'persist_failure',
  'invariant_violation',
  'cancelled',
] as const;

export type ErrorClass = (typeof ERROR_CLASSES)[number];

export const ERROR_MESSAGES = {
  attempts_exhausted: 'step attempts exhausted',
  persist_failure: 'durable persist failed',
  invariant_violation: 'orchestration invariant violated',
  cancelled: 'run cancelled',
} as const satisfies { readonly [K in ErrorClass]: string };

export function errorMessageFor(errorClass: ErrorClass): (typeof ERROR_MESSAGES)[ErrorClass] {
  return ERROR_MESSAGES[errorClass];
}

export function isErrorClass(value: string): value is ErrorClass {
  return (ERROR_CLASSES as readonly string[]).includes(value);
}
