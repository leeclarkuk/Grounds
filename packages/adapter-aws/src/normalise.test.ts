import { describe, expect, it } from 'vitest';

import { normaliseTasks } from './normalise.js';

describe('normaliseTasks', () => {
  it('is complete when every requested ARN is described and there are no failures', () => {
    const payload = normaliseTasks(
      [{ taskArn: 'arn:task/1', lastStatus: 'RUNNING', desiredStatus: 'RUNNING' }],
      ['arn:task/1'],
      [],
    );
    expect(payload['complete']).toBe(true);
  });

  it('is incomplete when DescribeTasks returns failures', () => {
    const payload = normaliseTasks(
      [{ taskArn: 'arn:task/1', lastStatus: 'RUNNING', desiredStatus: 'RUNNING' }],
      ['arn:task/1', 'arn:task/2'],
      [{ arn: 'arn:task/2', reason: 'MISSING' }],
    );
    expect(payload['complete']).toBe(false);
  });

  it('is incomplete when a requested ARN is absent from tasks and failures', () => {
    const payload = normaliseTasks(
      [{ taskArn: 'arn:task/1', lastStatus: 'RUNNING', desiredStatus: 'RUNNING' }],
      ['arn:task/1', 'arn:task/2'],
      [],
    );
    expect(payload['complete']).toBe(false);
  });
});
