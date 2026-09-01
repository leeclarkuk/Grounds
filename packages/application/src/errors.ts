export class GrantNotConsumableError extends Error {
  public override readonly name = 'GrantNotConsumableError';
  public constructor(message = 'grant is expired, consumed or missing') {
    super(message);
  }
}

export class IdempotencyConflictError extends Error {
  public override readonly name = 'IdempotencyConflictError';
  public constructor(message = 'idempotency key reused with a different request') {
    super(message);
  }
}

export class FenceLostError extends Error {
  public override readonly name = 'FenceLostError';
  public constructor(message = 'lease fence rejected the write') {
    super(message);
  }
}

export class SchemaNotReadyError extends Error {
  public override readonly name = 'SchemaNotReadyError';
  public constructor(message = 'database schema is not ready') {
    super(message);
  }
}

export class UniqueConstraintError extends Error {
  public override readonly name = 'UniqueConstraintError';
  public constructor(message = 'unique constraint violated') {
    super(message);
  }
}

export class NotFoundError extends Error {
  public override readonly name = 'NotFoundError';
  public constructor(message = 'resource not found') {
    super(message);
  }
}

export class ValidationError extends Error {
  public override readonly name = 'ValidationError';
  public constructor(message: string) {
    super(message);
  }
}

export class FindingReplayMismatchError extends Error {
  public override readonly name = 'FindingReplayMismatchError';
  public constructor(message = 'finding replay did not match the original row') {
    super(message);
  }
}

export class InvariantViolationError extends Error {
  public override readonly name = 'InvariantViolationError';
  public constructor(message = 'invariant violation') {
    super(message);
  }
}
