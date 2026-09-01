import type { JsonObject } from './json.js';

export const INACCESSIBLE_ERROR_CODES = [
  'throttled',
  'timeout',
  'unavailable',
  'denied',
  'incomplete',
  'invalid',
] as const;

export type InaccessibleErrorCode = (typeof INACCESSIBLE_ERROR_CODES)[number];

export function isInaccessibleErrorCode(value: string): value is InaccessibleErrorCode {
  return (INACCESSIBLE_ERROR_CODES as readonly string[]).includes(value);
}

export function inaccessiblePayload(errorCode: InaccessibleErrorCode): JsonObject {
  return { inaccessible: true, complete: false, errorCode };
}
