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
