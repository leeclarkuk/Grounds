import { describe, expect, it } from 'vitest';

import { canonicalJson } from './canonical-json.js';
import { sha256Hex } from './digest.js';

describe('canonicalJson RFC 8785', () => {
  it('sorts object keys by UTF-16 code units and omits whitespace', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ amount: 300, from_account: '543 2323 0023' })).toBe(
      '{"amount":300,"from_account":"543 2323 0023"}',
    );
  });

  it('serialises empty object and array', () => {
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson([])).toBe('[]');
  });

  it('uses ECMAScript NumberToJSON for numbers', () => {
    expect(canonicalJson([333333333.3333333, 1e30, 4.5, 2e-3, 1e-27])).toBe(
      '[333333333.3333333,1e+30,4.5,0.002,1e-27]',
    );
  });

  it('produces a stable checked-in SHA-256 digest independent of key insertion order', () => {
    const first = sha256Hex(canonicalJson({ kind: 'fake.inventory', n: 1 }));
    const second = sha256Hex(canonicalJson({ n: 1, kind: 'fake.inventory' }));
    expect(first).toBe(second);
    expect(first).toBe('6119aea1a2fbd8d16f0285107111db7a9e3f7fa33b942ade623f36997d033159');
  });
});
