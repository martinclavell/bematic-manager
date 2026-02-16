export class BematicError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly recoverable: boolean = false,
  ) {
    super(message);
    this.name = 'BematicError';
  }
}

export class AuthenticationError extends BematicError {
  constructor(message = 'Authentication failed') {
    super(message, 'AUTH_FAILED', 401, false);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends BematicError {
  constructor(message = 'Insufficient permissions') {
    super(message, 'FORBIDDEN', 403, false);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends BematicError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404, false);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends BematicError {
  constructor(
    public readonly retryAfterMs: number,
  ) {
    super('Rate limit exceeded', 'RATE_LIMITED', 429, true);
    this.name = 'RateLimitError';
  }
}

export class ValidationError extends BematicError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400, false);
    this.name = 'ValidationError';
  }
}

export class AgentOfflineError extends BematicError {
  constructor(agentId: string) {
    super(`Agent ${agentId} is offline`, 'AGENT_OFFLINE', 503, true);
    this.name = 'AgentOfflineError';
  }
}

export class BudgetExceededError extends BematicError {
  constructor(taskId: string, budget: number) {
    super(
      `Task ${taskId} exceeded budget of $${budget}`,
      'BUDGET_EXCEEDED',
      402,
      false,
    );
    this.name = 'BudgetExceededError';
  }
}
