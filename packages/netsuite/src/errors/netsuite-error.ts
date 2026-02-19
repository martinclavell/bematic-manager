/**
 * Base error class for all NetSuite-related errors
 */
export class NetSuiteError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly details?: Record<string, any>,
  ) {
    super(message);
    this.name = 'NetSuiteError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

export class NetSuiteAuthError extends NetSuiteError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'AUTH_ERROR', 401, details);
    this.name = 'NetSuiteAuthError';
  }
}

export class NetSuiteAPIError extends NetSuiteError {
  constructor(
    message: string,
    statusCode: number,
    code: string = 'API_ERROR',
    details?: Record<string, any>,
  ) {
    super(message, code, statusCode, details);
    this.name = 'NetSuiteAPIError';
  }
}

export class NetSuiteValidationError extends NetSuiteError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'NetSuiteValidationError';
  }
}

export class NetSuiteConfigError extends NetSuiteError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'CONFIG_ERROR', undefined, details);
    this.name = 'NetSuiteConfigError';
  }
}

export class NetSuiteTimeoutError extends NetSuiteError {
  constructor(message: string, timeoutMs: number) {
    super(message, 'TIMEOUT_ERROR', 408, { timeoutMs });
    this.name = 'NetSuiteTimeoutError';
  }
}

export class NetSuiteRateLimitError extends NetSuiteError {
  constructor(message: string, retryAfterMs?: number) {
    super(message, 'RATE_LIMIT_ERROR', 429, { retryAfterMs });
    this.name = 'NetSuiteRateLimitError';
  }
}
