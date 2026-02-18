import { MessageType, createWSMessage, createLogger } from '@bematic/common';
import type { SDKMessage, SDKAssistantMessage } from '@anthropic-ai/claude-code';
import type { WSClient } from '../../connection/ws-client.js';

const logger = createLogger('message-handler');

/**
 * Processes Claude SDK stream messages
 * Responsibilities:
 * - Parse assistant messages
 * - Detect tool use
 * - Send TASK_STREAM and TASK_PROGRESS to cloud
 * - Track file changes and command executions
 */
export class MessageHandler {
  constructor(private readonly wsClient: WSClient) {}

  /**
   * Handle a single message from Claude SDK stream
   */
  handle(
    taskId: string,
    message: SDKMessage,
    filesChanged: Set<string>,
    commandsRun: Set<string>,
  ): void {
    if (message.type === 'assistant') {
      this.handleAssistantMessage(taskId, message as SDKAssistantMessage, filesChanged, commandsRun);
    }
  }

  /**
   * Process assistant message content blocks
   */
  private handleAssistantMessage(
    taskId: string,
    message: SDKAssistantMessage,
    filesChanged: Set<string>,
    commandsRun: Set<string>,
  ): void {
    if (!message.message?.content) return;

    for (const block of message.message.content) {
      if (block.type === 'tool_use') {
        this.handleToolUse(taskId, block.name, block.input as Record<string, unknown>, filesChanged, commandsRun);
      }

      if (block.type === 'text') {
        // Stream text content to cloud
        this.wsClient.send(
          createWSMessage(MessageType.TASK_STREAM, {
            taskId,
            delta: block.text,
            timestamp: Date.now(),
          }),
        );
      }
    }
  }

  /**
   * Handle tool use - track changes and send progress
   */
  private handleToolUse(
    taskId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    filesChanged: Set<string>,
    commandsRun: Set<string>,
  ): void {
    // Track file changes
    if (['Edit', 'Write', 'NotebookEdit'].includes(toolName)) {
      const filePath = (toolInput['file_path'] ?? toolInput['notebook_path']) as string;
      if (filePath) filesChanged.add(filePath);
    }

    // Track commands
    if (toolName === 'Bash') {
      const cmd = toolInput['command'] as string;
      if (cmd) commandsRun.add(cmd.slice(0, 200));
    }

    // Build descriptive progress message
    const progressMessage = this.describeToolUse(toolName, toolInput);

    // Send progress update
    this.wsClient.send(
      createWSMessage(MessageType.TASK_PROGRESS, {
        taskId,
        type: 'tool_use',
        message: progressMessage,
        timestamp: Date.now(),
      }),
    );
  }

  /**
   * Build a human-readable description of a tool use
   */
  private describeToolUse(toolName: string, input: Record<string, unknown>): string {
    const shortPath = (p: string) => {
      const parts = p.replace(/\\/g, '/').split('/');
      return parts.length > 2 ? parts.slice(-2).join('/') : p;
    };

    switch (toolName) {
      case 'Read': {
        const fp = input['file_path'] as string;
        return fp ? `Reading \`${shortPath(fp)}\`` : 'Reading file';
      }
      case 'Write': {
        const fp = input['file_path'] as string;
        return fp ? `Writing \`${shortPath(fp)}\`` : 'Writing file';
      }
      case 'Edit': {
        const fp = input['file_path'] as string;
        return fp ? `Editing \`${shortPath(fp)}\`` : 'Editing file';
      }
      case 'Glob': {
        const pattern = input['pattern'] as string;
        return pattern ? `Searching files: \`${pattern}\`` : 'Searching files';
      }
      case 'Grep': {
        const pattern = input['pattern'] as string;
        return pattern ? `Searching for: \`${pattern}\`` : 'Searching code';
      }
      case 'Bash': {
        const cmd = (input['command'] as string)?.slice(0, 80);
        return cmd ? `Running: \`${cmd}\`` : 'Running command';
      }
      case 'NotebookEdit': {
        const fp = input['notebook_path'] as string;
        return fp ? `Editing notebook \`${shortPath(fp)}\`` : 'Editing notebook';
      }
      case 'Task': {
        const desc = input['description'] as string;
        return desc ? `Spawning task: ${desc}` : 'Spawning sub-task';
      }
      case 'WebSearch': {
        const q = input['query'] as string;
        return q ? `Searching web: \`${q}\`` : 'Searching web';
      }
      case 'WebFetch': {
        return 'Fetching web content';
      }
      default:
        return `Using ${toolName}`;
    }
  }
}
