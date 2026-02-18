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
    elements: buttons.map((b) => ({
      type: 'button',
      text: { type: 'plain_text', text: b.text },
      action_id: b.actionId,
      value: b.value,
      style: b.style,
    })),
  };
}

export function taskCompleteBlocks(
  result: string,
  metrics: { inputTokens: number; outputTokens: number; estimatedCost: number; durationMs: number; filesChanged: string[] },
): SlackBlock[] {
  // Use smart truncation to preserve structure (code blocks, headers)
  const { truncated, wasTruncated, originalLength } = truncateMessage(result, {
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
    const fileList = metrics.filesChanged.map((f) => `• ${f}`).join('\n');
    // Truncate file list if extremely long
    const displayList = fileList.length > 500 ? fileList.slice(0, 500) + `\n...and ${metrics.filesChanged.length - fileList.slice(0, 500).split('\n').length} more` : fileList;
    blocks.push(
      context(`*Files changed:*\n${displayList}`),
    );
  }

  return blocks;
}

export function taskErrorBlocks(error: string, taskId: string): SlackBlock[] {
  return [
    section(`:x: *Task failed*\n\`\`\`${error}\`\`\``),
    context(`Task: \`${taskId}\``),
    actions({ text: 'Retry', actionId: `retry_task_${taskId}`, value: taskId, style: 'primary' }),
  ];
}

export function queuedOfflineBlocks(taskId: string): SlackBlock[] {
  return [
    section(':satellite: *Agent is offline.* Your task has been queued and will execute when the agent reconnects.'),
    context(`Task: \`${taskId}\``),
  ];
}

/** Display the decomposition plan with subtask list */
export function subtaskPlanBlocks(parentTaskId: string, subtasks: SubtaskDefinition[]): SlackBlock[] {
  const list = subtasks
    .map((s, i) => `:white_small_square: *${i + 1}.* ${s.title} (\`${s.command}\`)`)
    .join('\n');

  return [
    section(`:jigsaw: *Task decomposed into ${subtasks.length} subtasks*`),
    section(list),
    divider(),
    context(`Parent: \`${parentTaskId}\``, 'Subtasks will execute sequentially'),
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
