import { isJsonObject, type JsonValue } from './json.js';

export function canonicalJson(value: JsonValue): string {
  return serialize(value);
}

function serialize(value: JsonValue): string {
  if (value === null) {
    return 'null';
  }
  if (value === true) {
    return 'true';
  }
  if (value === false) {
    return 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('RFC 8785 numbers must be finite');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: JsonValue) => serialize(item)).join(',')}]`;
  }
  if (!isJsonObject(value)) {
    throw new Error('expected JSON object');
  }
  const keys = Object.keys(value).sort();
  const properties = keys.map((key) => {
    const nested = value[key];
    return `${JSON.stringify(key)}:${serialize(nested ?? null)}`;
  });
  return `{${properties.join(',')}}`;
}
