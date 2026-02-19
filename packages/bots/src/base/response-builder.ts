import type { SlackBlock, SubtaskDefinition } from '@bematic/common';
import { truncateMessage, Limits, truncateForSectionBlock } from '@bematic/common';

/** Format milliseconds into human-readable duration (e.g. "2:32 minutes", "45 seconds") */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds} seconds`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')} minutes`;
}

/** Format a number into a compact human-readable string (e.g. 12323 → "12.3k") */
function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`;
  }
  return n.toString();
}

export function header(text: string): SlackBlock {
  return {
    type: 'header',
    text: { type: 'plain_text', text },
  };
}

export function section(text: string): SlackBlock {
  return {
    type: 'section',
    text: { type: 'mrkdwn', text },
  };
}

export function divider(): SlackBlock {
  return { type: 'divider' };
}

export function context(...texts: string[]): SlackBlock {
  return {
    type: 'context',
    elements: texts.map((t) => ({ type: 'mrkdwn', text: t })),
  };
}

export function actions(
  ...buttons: Array<{ text: string; actionId: string; value?: string; style?: 'primary' | 'danger' }>
): SlackBlock {
  return {
    type: 'actions',
    elements: buttons.map((b) => {
      const element: { type: 'button'; text: { type: 'plain_text'; text: string }; action_id: string; value?: string; style?: 'primary' | 'danger' } = {
        type: 'button' as const,
        text: { type: 'plain_text' as const, text: b.text },
        action_id: b.actionId,
      };
      if (b.value) element.value = b.value;
      if (b.style) element.style = b.style;
      return element;
    }),
  };
}

export function taskCompleteBlocks(
  result: string,
  metrics: { taskId?: string; inputTokens: number; outputTokens: number; estimatedCost: number; durationMs: number; filesChanged: string[]; basePath?: string },
): SlackBlock[] {
  // Guard against empty result — Slack rejects section blocks with empty text
  const displayResult = result.trim() || '_(Task completed with no text output)_';

  // Use smart truncation to preserve structure (code blocks, headers)
  const { truncated, wasTruncated, originalLength } = truncateMessage(displayResult, {
    maxLength: Limits.SLACK_FINAL_DISPLAY_LENGTH,
    strategy: 'smart',
    indicator: `\n\n_...response truncated for Slack display_`,
    preserveCodeBlocks: true,
  });

  // Split into multiple section blocks if needed (3000 char limit per block)
  const textBlocks = truncateForSectionBlock(truncated);

  const blocks: SlackBlock[] = [];

  // Add each text chunk as a section block
  for (const chunk of textBlocks) {
    blocks.push(section(chunk));
  }

  // Add truncation warning if needed
  if (wasTruncated) {
    blocks.push(
      context(`:warning: Full response was ${originalLength.toLocaleString()} characters (truncated to fit Slack limits)`),
    );
  }

  blocks.push(divider());
  blocks.push(
    context(
      `:white_check_mark: Completed in ${formatDuration(metrics.durationMs)}`,
      `Tokens: ${formatNumber(metrics.inputTokens + metrics.outputTokens)}`,
      `Cost: $${metrics.estimatedCost.toFixed(4)}`,
    ),
  );

  if (metrics.filesChanged.length > 0) {
    // Strip basePath from file paths if provided
    const stripBasePath = (path: string): string => {
      if (!metrics.basePath) return path;
      // Normalize both paths to use forward slashes for comparison
      const normalizedPath = path.replace(/\\/g, '/');
      const normalizedBase = metrics.basePath.replace(/\\/g, '/');
      // Remove trailing slash from base if present
      const baseWithoutTrailingSlash = normalizedBase.endsWith('/')
        ? normalizedBase.slice(0, -1)
        : normalizedBase;

      if (normalizedPath.startsWith(baseWithoutTrailingSlash + '/')) {
        return normalizedPath.slice(baseWithoutTrailingSlash.length + 1);
      }
      return path;
    };

    const fileList = metrics.filesChanged.map((f) => `• ${stripBasePath(f)}`).join('\n');
    // Truncate file list if extremely long
    const displayList = fileList.length > 500 ? fileList.slice(0, 500) + `\n...and ${metrics.filesChanged.length - fileList.slice(0, 500).split('\n').length} more` : fileList;
    blocks.push(
      context(`*Files changed:*\n${displayList}`),
    );
  }

  // Add feedback buttons (use taskId for clean action_ids)
  const feedbackId = metrics.taskId || 'task';
  blocks.push(
    actions(
      { text: '👍 Helpful', actionId: `feedback_positive_${feedbackId}`, value: feedbackId, style: 'primary' },
      { text: '👎 Not Helpful', actionId: `feedback_negative_${feedbackId}`, value: feedbackId },
      { text: '💡 Suggest Improvement', actionId: `feedback_suggest_${feedbackId}`, value: feedbackId }
    )
  );

  return blocks;
}

export function taskErrorBlocks(error: string, recoverable: boolean, taskId: string): SlackBlock[] {
  const blocks: SlackBlock[] = [
    section(`:x: *Task failed*\n\`\`\`${error}\`\`\``),
    context(`Task: \`${taskId}\``),
  ];

  // Only show retry button if the error is recoverable
  if (recoverable) {
    blocks.push(
      actions({ text: 'Retry', actionId: `retry_task_${taskId}`, value: taskId, style: 'primary' })
    );
  }

  return blocks;
}

export function queuedOfflineBlocks(taskId: string): SlackBlock[] {
  return [
    section(':satellite: *Agent is offline.* Your task has been queued and will execute when the agent reconnects.'),
    context(`Task: \`${taskId}\``),
  ];
}

/** Display the decomposition plan with subtask list and approval buttons */
export function subtaskPlanBlocks(parentTaskId: string, subtasks: SubtaskDefinition[]): SlackBlock[] {
  const list = subtasks
    .map((s, i) => `:white_small_square: *${i + 1}.* ${s.title} (\`${s.command}\`)`)
    .join('\n');

  return [
    section(`:jigsaw: *Task decomposed into ${subtasks.length} subtasks*`),
    section(list),
    divider(),
    context(`Parent: \`${parentTaskId}\``, 'Review the plan and approve to proceed'),
    actions(
      { text: 'Approve Plan', actionId: `approve_plan_${parentTaskId}`, value: parentTaskId, style: 'primary' },
      { text: 'Suggest a Change', actionId: `request_changes_${parentTaskId}`, value: parentTaskId }
    ),
  ];
}

/** Summary of all subtasks after parent task completes */
export function subtaskSummaryBlocks(
  parentTaskId: string,
  subtaskResults: Array<{
    taskId: string;
    status: string;
    result?: string;
    durationMs?: number;
    estimatedCost?: number;
  }>,
): SlackBlock[] {
  const totalCost = subtaskResults.reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0);
  const totalDuration = subtaskResults.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
  const completed = subtaskResults.filter((s) => s.status === 'completed').length;
  const failed = subtaskResults.filter((s) => s.status === 'failed').length;

  const statusEmoji = failed === 0 ? ':white_check_mark:' : ':warning:';
  const statusList = subtaskResults
    .map((s) => {
      const emoji = s.status === 'completed' ? ':white_check_mark:' : s.status === 'failed' ? ':x:' : ':no_entry_sign:';
      return `${emoji} \`${s.taskId}\` — ${s.status}`;
    })
    .join('\n');

  return [
    section(`${statusEmoji} *All subtasks finished* (${completed}/${subtaskResults.length} completed${failed > 0 ? `, ${failed} failed` : ''})`),
    section(statusList),
    divider(),
    context(
      `Parent: \`${parentTaskId}\``,
      `Total: ${formatDuration(totalDuration)}`,
      `Cost: $${totalCost.toFixed(4)}`,
    ),
  ];
}
