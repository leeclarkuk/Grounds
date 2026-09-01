export type JsonPrimitive = null | boolean | number | string;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

export function assertJsonValue(value: unknown, path = '$'): JsonValue {
  if (value === null) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} is not a finite JSON number`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => assertJsonValue(item, `${path}[${String(index)}]`));
  }
  if (typeof value === 'object') {
    const record = value as { readonly [key: string]: unknown };
    const out: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(record)) {
      const nested = record[key];
      if (nested === undefined) {
        continue;
      }
      out[key] = assertJsonValue(nested, `${path}.${key}`);
    }
    return out;
  }
  throw new Error(`${path} is not JSON`);
}
