import {
  MessageType,
  createWSMessage,
  createLogger,
  type HeartbeatPingPayload,
} from '@bematic/common';
import type { WSClient } from './ws-client.js';
import type { QueueProcessor } from '../executor/queue-processor.js';
import * as os from 'node:os';

const logger = createLogger('heartbeat');

export function setupHeartbeat(
  wsClient: WSClient,
  agentId: string,
  queueProcessor: QueueProcessor,
): void {
  wsClient.on('heartbeat:ping', (payload: HeartbeatPingPayload) => {
    const cpus = os.cpus();
    const cpuUsage = cpus.reduce((acc, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      return acc + (1 - idle / total);
    }, 0) / cpus.length;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memoryUsage = (totalMem - freeMem) / totalMem;

    const pong = createWSMessage(MessageType.HEARTBEAT_PONG, {
      agentId,
      serverTime: payload.serverTime,
      activeTasks: queueProcessor.getActiveTaskCount(),
      cpuUsage: Math.round(cpuUsage * 100) / 100,
      memoryUsage: Math.round(memoryUsage * 100) / 100,
    });

    wsClient.send(pong);
    logger.debug({ activeTasks: queueProcessor.getActiveTaskCount() }, 'Heartbeat pong sent');
  });
}
