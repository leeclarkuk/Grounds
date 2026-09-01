import { describe, expect, it } from 'vitest';

import { log } from './index.js';

function exampleAccessKeyId(kind: 'AKIA' | 'ASIA'): string {
  return `${kind}${'IOSFODNN7EXAMPLE'}`;
}

function capture(stream: NodeJS.WriteStream, fn: () => void): string {
  const chunks: string[] = [];
  const original = stream.write.bind(stream);
  stream.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof stream.write;
  try {
    fn();
  } finally {
    stream.write = original;
  }
  return chunks.join('');
}

describe('log redaction', () => {
  it('redacts mid-string and suffix access keys from the message and fields', () => {
    const accessKeyId = exampleAccessKeyId('AKIA');
    const sessionKey = exampleAccessKeyId('ASIA');
    const output = capture(process.stdout, () => {
      log('info', `request failed for ${accessKeyId} during collect`, {
        trailer: `trace-${accessKeyId}`,
        url: `https://s3.amazonaws.com/bucket/key?X-Amz-Credential=${sessionKey}&X-Amz-Signature=abcdef`,
        runId: 'run-1',
      });
    });
    expect(output).not.toContain(accessKeyId);
    expect(output).not.toContain(sessionKey);
    expect(output).not.toContain('X-Amz-Credential');
    expect(output).not.toContain('X-Amz-Signature');
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('run-1');
  });

  it('redacts mid-string and suffix secrets from non-closed error detail', () => {
    const accessKeyId = exampleAccessKeyId('AKIA');
    const output = capture(process.stderr, () => {
      log(
        'error',
        'unhandled api error',
        {},
        new Error(`request failed for ${accessKeyId} suffix-${accessKeyId}`),
      );
    });
    expect(output).not.toContain(accessKeyId);
    expect(output).toContain('[REDACTED]');
    expect(output).not.toMatch(/Error: request failed for AKIA/);
  });

  it('redacts mid-string secrets from plain-object error detail', () => {
    const accessKeyId = exampleAccessKeyId('AKIA');
    const output = capture(process.stderr, () => {
      log('error', 'adapter failure', {}, { message: `token ${accessKeyId} rejected` });
    });
    expect(output).not.toContain(accessKeyId);
    expect(output).toContain('[REDACTED]');
  });
});
