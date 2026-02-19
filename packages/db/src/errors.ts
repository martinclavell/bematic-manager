/**
 * Custom database error classes for structured error handling
 */

export interface DatabaseErrorContext {
  operation?: string;
  table?: string;
  data?: unknown;
  query?: string;
  cause?: unknown;
}

/**
 * Base database error class
 */
export class DatabaseError extends Error {
  readonly context: DatabaseErrorContext;
  readonly timestamp: string;

  constructor(message: string, context: DatabaseErrorContext = {}) {
    super(message);
    this.name = 'DatabaseError';
    this.context = context;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Error thrown when a constraint violation occurs (UNIQUE, FOREIGN KEY, etc.)
 */
export class ConstraintViolationError extends DatabaseError {
  readonly constraintType: 'UNIQUE' | 'FOREIGN_KEY' | 'CHECK' | 'NOT_NULL' | 'UNKNOWN';

  constructor(message: string, constraintType: string, context: DatabaseErrorContext = {}) {
    super(message, context);
    this.name = 'ConstraintViolationError';
    this.constraintType = this.parseConstraintType(constraintType);
  }

  private parseConstraintType(type: string): 'UNIQUE' | 'FOREIGN_KEY' | 'CHECK' | 'NOT_NULL' | 'UNKNOWN' {
    const upperType = type.toUpperCase();
    if (upperType.includes('UNIQUE')) return 'UNIQUE';
    if (upperType.includes('FOREIGN')) return 'FOREIGN_KEY';
    if (upperType.includes('CHECK')) return 'CHECK';
    if (upperType.includes('NOT NULL')) return 'NOT_NULL';
    return 'UNKNOWN';
  }
}

/**
 * Error thrown when database is locked
 */
export class DatabaseLockedError extends DatabaseError {
  constructor(context: DatabaseErrorContext = {}) {
    super('Database is locked, operation failed', context);
    this.name = 'DatabaseLockedError';
  }
}

/**
 * Error thrown when disk I/O operations fail
 */
export class DiskIOError extends DatabaseError {
  constructor(message: string, context: DatabaseErrorContext = {}) {
    super(message, context);
    this.name = 'DiskIOError';
  }
}

/**
 * Error thrown when a requested record is not found
 */
export class RecordNotFoundError extends DatabaseError {
  readonly id: string | number;

  constructor(table: string, id: string | number, context: DatabaseErrorContext = {}) {
    super(`Record not found in ${table} with id: ${id}`, { ...context, table });
    this.name = 'RecordNotFoundError';
    this.id = id;
  }
}

/**
 * Error thrown when attempting to modify a record that has been changed by another process
 */
export class OptimisticLockError extends DatabaseError {
  constructor(table: string, id: string | number, context: DatabaseErrorContext = {}) {
    super(`Record in ${table} with id ${id} was modified by another process`, { ...context, table });
    this.name = 'OptimisticLockError';
  }
}

/**
 * Helper function to classify SQLite errors based on error message
 */
export function classifySQLiteError(error: unknown, context: DatabaseErrorContext = {}): DatabaseError {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorCode = (error as any)?.code;

  // SQLite error codes: https://www.sqlite.org/rescode.html
  switch (errorCode) {
    case 'SQLITE_CONSTRAINT':
    case 'SQLITE_CONSTRAINT_UNIQUE':
    case 'SQLITE_CONSTRAINT_FOREIGNKEY':
    case 'SQLITE_CONSTRAINT_CHECK':
    case 'SQLITE_CONSTRAINT_NOTNULL':
      return new ConstraintViolationError(errorMessage, errorCode, { ...context, cause: error });

    case 'SQLITE_BUSY':
    case 'SQLITE_LOCKED':
      return new DatabaseLockedError({ ...context, cause: error });

    case 'SQLITE_IOERR':
    case 'SQLITE_CORRUPT':
    case 'SQLITE_FULL':
      return new DiskIOError(errorMessage, { ...context, cause: error });

    default:
      // Fallback to message-based classification
      const lowerMessage = errorMessage.toLowerCase();

      if (lowerMessage.includes('unique constraint') || lowerMessage.includes('unique violation')) {
        return new ConstraintViolationError(errorMessage, 'UNIQUE', { ...context, cause: error });
      }

      if (lowerMessage.includes('foreign key') || lowerMessage.includes('foreign_key')) {
        return new ConstraintViolationError(errorMessage, 'FOREIGN_KEY', { ...context, cause: error });
      }

      if (lowerMessage.includes('not null') || lowerMessage.includes('null constraint')) {
        return new ConstraintViolationError(errorMessage, 'NOT_NULL', { ...context, cause: error });
      }

      if (lowerMessage.includes('database is locked') || lowerMessage.includes('busy')) {
        return new DatabaseLockedError({ ...context, cause: error });
      }

      if (lowerMessage.includes('disk i/o error') || lowerMessage.includes('database disk image is malformed')) {
        return new DiskIOError(errorMessage, { ...context, cause: error });
      }

      return new DatabaseError(errorMessage, { ...context, cause: error });
  }
}