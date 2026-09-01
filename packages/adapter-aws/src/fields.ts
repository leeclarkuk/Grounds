import type { JsonObject, JsonValue } from '@grounds/domain';

export function readString(obj: JsonObject, ...keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
}

export function readNumber(obj: JsonObject, ...keys: string[]): number {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number') {
      return value;
    }
  }
  return 0;
}

export function readValue(obj: JsonObject, ...keys: string[]): JsonValue | undefined {
  for (const key of keys) {
    if (obj[key] !== undefined) {
      return obj[key];
    }
  }
  return undefined;
}
