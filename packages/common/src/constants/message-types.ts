export const MessageType = {
  // Authentication
  AUTH_REQUEST: 'auth:request',
  AUTH_RESPONSE: 'auth:response',

  // Heartbeat
  HEARTBEAT_PING: 'heartbeat:ping',
  HEARTBEAT_PONG: 'heartbeat:pong',

  // Task lifecycle
  TASK_SUBMIT: 'task:submit',
  TASK_ACK: 'task:ack',
  TASK_PROGRESS: 'task:progress',
  TASK_STREAM: 'task:stream',
  TASK_COMPLETE: 'task:complete',
  TASK_ERROR: 'task:error',
  TASK_CANCEL: 'task:cancel',
  TASK_CANCELLED: 'task:cancelled',

  // Agent status
  AGENT_STATUS: 'agent:status',
  AGENT_METRICS: 'agent:metrics',

  // Deploy
  DEPLOY_REQUEST: 'deploy:request',
  DEPLOY_RESULT: 'deploy:result',

  // System
  SYSTEM_ERROR: 'system:error',
  SYSTEM_SHUTDOWN: 'system:shutdown',
  SYSTEM_RESTART: 'system:restart',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];
