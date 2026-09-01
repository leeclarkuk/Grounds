import { canonicalJson } from './canonical-json.js';
import { sha256Hex } from './digest.js';
import { assertJsonValue, isJsonObject, type JsonObject, type JsonValue } from './json.js';

export const REDACTION_VERSION = 'redaction.v1';
export const REDACTED = '[REDACTED]';
export const MAX_PAYLOAD_BYTES = 1_048_576;

const SENSITIVE_KEY =
  /^(password|passwd|secret|credential|authorization|token|accesskeyid|accesskey|access_key|sessiontoken|session_token|aws_secret_access_key|aws_secret|private_key|api_key|apikey|x-amz-security-token|signature)$/i;

export function redactJson(value: JsonValue): JsonValue {
  return redact(value);
}

function redact(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item: JsonValue) => redact(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, nested] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redact(nested);
      }
    }
    return out;
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  return value;
}

function isSensitiveKey(key: string): boolean {
  const compact = key.replace(/[^A-Za-z]/g, '');
  return SENSITIVE_KEY.test(key) || SENSITIVE_KEY.test(compact);
}

function redactString(value: string): string {
  if (
    ACCESS_KEY.test(value) ||
    PRESIGNED.test(value) ||
    /BEGIN [A-Z ]*PRIVATE KEY/.test(value) ||
    /AWS[A-Za-z0-9/+=]{30,}/.test(value)
  ) {
    return REDACTED;
  }
  return value;
}

const ACCESS_KEY = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/;
const PRESIGNED = /(?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|X-Amz-SignedHeaders)=/i;

export function payloadDigestOf(redactedPayload: JsonValue): string {
  return sha256Hex(canonicalJson(redactedPayload));
}

export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

export type TruncationEnvelope = {
  readonly truncated: true;
  readonly originalByteLength: number;
  readonly fullPayloadDigest: string;
};

export function boundPayload(redactedPayload: JsonValue): {
  readonly persisted: JsonValue;
  readonly payloadDigest: string;
  readonly truncated: boolean;
} {
  const canonical = canonicalJson(redactedPayload);
  const payloadDigest = sha256Hex(canonical);
  const originalByteLength = utf8ByteLength(canonical);
  if (originalByteLength <= MAX_PAYLOAD_BYTES) {
    return { persisted: redactedPayload, payloadDigest, truncated: false };
  }
  const envelope: TruncationEnvelope = {
    truncated: true,
    originalByteLength,
    fullPayloadDigest: payloadDigest,
  };
  return { persisted: envelope, payloadDigest, truncated: true };
}

export function redactUnknown(raw: unknown): JsonValue {
  return redactJson(assertJsonValue(raw));
}

export function asJsonObject(value: JsonValue): JsonObject {
  if (!isJsonObject(value)) {
    throw new Error('expected JSON object');
  }
  return value;
}
