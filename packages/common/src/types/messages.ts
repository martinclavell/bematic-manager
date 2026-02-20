import type { MessageType } from '../constants/message-types.js';
import type { AuthRequestPayload, AuthResponsePayload } from './auth.js';
import type {
  TaskSubmitPayload,
  TaskProgressPayload,
  TaskStreamPayload,
  TaskCompletePayload,
  TaskErrorPayload,
  TaskCancelPayload,
} from './task.js';

/** Maps each message type to its payload type */
export interface MessagePayloadMap {
  [MessageType.AUTH_REQUEST]: AuthRequestPayload;
  [MessageType.AUTH_RESPONSE]: AuthResponsePayload;
  [MessageType.HEARTBEAT_PING]: HeartbeatPingPayload;
  [MessageType.HEARTBEAT_PONG]: HeartbeatPongPayload;
  [MessageType.TASK_SUBMIT]: TaskSubmitPayload;
  [MessageType.TASK_ACK]: TaskAckPayload;
  [MessageType.TASK_PROGRESS]: TaskProgressPayload;
  [MessageType.TASK_STREAM]: TaskStreamPayload;
  [MessageType.TASK_COMPLETE]: TaskCompletePayload;
  [MessageType.TASK_ERROR]: TaskErrorPayload;
  [MessageType.TASK_CANCEL]: TaskCancelPayload;
  [MessageType.TASK_CANCELLED]: TaskCancelledPayload;
  [MessageType.AGENT_STATUS]: AgentStatusPayload;
  [MessageType.AGENT_METRICS]: AgentMetricsPayload;
  [MessageType.DEPLOY_REQUEST]: DeployRequestPayload;
  [MessageType.DEPLOY_RESULT]: DeployResultPayload;
  [MessageType.PATH_VALIDATE_REQUEST]: PathValidateRequestPayload;
  [MessageType.PATH_VALIDATE_RESULT]: PathValidateResultPayload;
  [MessageType.SYSTEM_ERROR]: SystemErrorPayload;
  [MessageType.SYSTEM_SHUTDOWN]: SystemShutdownPayload;
  [MessageType.SYSTEM_RESTART]: SystemRestartPayload;
}

/** Type-safe WebSocket message envelope */
export interface WSMessage<T extends MessageType = MessageType> {
  id: string;
  type: T;
  payload: MessagePayloadMap[T];
  timestamp: number;
}

export interface HeartbeatPingPayload {
  serverTime: number;
}

export interface HeartbeatPongPayload {
  agentId: string;
  serverTime: number;
  activeTasks: number;
  cpuUsage: number;
  memoryUsage: number;
}

export interface TaskAckPayload {
  taskId: string;
  accepted: boolean;
  reason?: string;
  queuePosition?: number;
}

export interface TaskCancelledPayload {
  taskId: string;
  reason: string;
}

export interface AgentStatusPayload {
  agentId: string;
  status: 'online' | 'busy' | 'offline';
  activeTasks: string[];
  version: string;
  resourceStatus?: {
    healthScore: number;
    memoryUsagePercent: number;
    cpuUsagePercent: number;
    canAcceptTasks: boolean;
  };
}

export interface AgentMetricsPayload {
  agentId: string;
  cpuUsage: number;
  memoryUsageMb: number;
  activeTasks: number;
  completedTasks: number;
  uptimeSeconds: number;
}

export interface SystemErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface SystemShutdownPayload {
  reason: string;
  gracePeriodMs: number;
}

export interface DeployRequestPayload {
  requestId: string;
  localPath: string;
  slackChannelId: string;
  slackThreadTs: string | null;
  requestedBy: string;
  railwayProjectId?: string | null;
  railwayServiceId?: string | null;
  railwayEnvironmentId?: string | null;
}

export interface DeployResultPayload {
  requestId: string;
  success: boolean;
  output: string;
  buildLogsUrl?: string;
}

export interface SystemRestartPayload {
  reason: string;
  rebuild: boolean;
}

export interface PathValidateRequestPayload {
  requestId: string;
  localPath: string;
  agentId: string;
}

export interface PathValidateResultPayload {
  requestId: string;
  success: boolean;
  exists: boolean;
  created: boolean;
  error?: string;
}
