import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical-json.js';
import type { JsonValue } from './json.js';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function sha256Canonical(value: JsonValue): string {
  return sha256Hex(canonicalJson(value));
}
