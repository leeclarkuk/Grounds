import { describe, expect, it } from 'vitest';

import { assertDevelopmentIdentity } from './app.js';

describe('API identity', () => {
  it('refuses to start when identity mode is not development', () => {
    expect(() => assertDevelopmentIdentity('production')).toThrow(/refuses to listen/);
    expect(() => assertDevelopmentIdentity('')).toThrow(/refuses to listen/);
    expect(() => assertDevelopmentIdentity('development')).not.toThrow();
  });
});
