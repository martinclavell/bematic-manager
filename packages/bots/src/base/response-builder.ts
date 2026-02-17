import type { SlackBlock } from '@bematic/common';

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

export function taskStartBlocks(taskId: string, botName: string, command: string): SlackBlock[] {
  return [
    section(`:hourglass_flowing_sand: *Working on it...* (${botName}/${command})`),
    context(`Task: \`${taskId}\``),
  ];
}

export function taskCompleteBlocks(
  result: string,
  metrics: { inputTokens: number; outputTokens: number; estimatedCost: number; durationMs: number; filesChanged: string[] },
): SlackBlock[] {
  const blocks: SlackBlock[] = [
    section(result.length > 3000 ? result.slice(0, 3000) + '\n\n_...truncated_' : result),
    divider(),
    context(
      `:white_check_mark: Completed in ${formatDuration(metrics.durationMs)}`,
      `Tokens: ${formatNumber(metrics.inputTokens + metrics.outputTokens)}`,
      `Cost: $${metrics.estimatedCost.toFixed(4)}`,
    ),
  ];

  if (metrics.filesChanged.length > 0) {
    const fileList = metrics.filesChanged.map((f) => `• ${f}`).join('\n');
    blocks.push(
      context(`*Files changed:*\n${fileList}`),
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
