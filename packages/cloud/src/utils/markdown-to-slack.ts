/**
 * Converts GitHub-flavored Markdown to Slack mrkdwn format.
 *
 * Key differences:
 * - MD: **bold** → Slack: *bold*
 * - MD: *italic* / _italic_ → Slack: _italic_
 * - MD: ## Header → Slack: *Header*
 * - MD: [text](url) → Slack: <url|text>
 * - MD: ![alt](url) → Slack: <url|alt>
 * - Code blocks and inline code work the same
 */
export function markdownToSlack(md: string): string {
  if (!md) return md;

  let result = md;

  // Protect code blocks from being modified
  // NOTE: Placeholders use %% delimiters (not __) to avoid collision
  // with the __bold__ → *bold* conversion on line 38.
  const codeBlocks: string[] = [];
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `%%CODEBLOCK_${codeBlocks.length - 1}%%`;
  });

  // Protect inline code
  const inlineCode: string[] = [];
  result = result.replace(/`[^`]+`/g, (match) => {
    inlineCode.push(match);
    return `%%INLINECODE_${inlineCode.length - 1}%%`;
  });

  // Headers: ## Header → *Header*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Bold: **text** → *text*
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // Bold: __text__ → *text*
  result = result.replace(/__(.+?)__/g, '*$1*');

  // Italic with asterisks (single): leave as-is since Slack uses _italic_
  // But we need to be careful not to break already-converted bold
  // MD single *italic* that isn't part of **bold** → _italic_
  // This is tricky because we already converted **bold** to *bold*
  // Skip this conversion to avoid conflicts

  // Images: ![alt](url) → <url|alt>
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<$2|$1>');

  // Links: [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // Horizontal rules: --- or *** → ───
  result = result.replace(/^[-*_]{3,}$/gm, '───');

  // Restore inline code
  result = result.replace(/%%INLINECODE_(\d+)%%/g, (_, i) => inlineCode[parseInt(i)]);

  // Restore code blocks
  result = result.replace(/%%CODEBLOCK_(\d+)%%/g, (_, i) => codeBlocks[parseInt(i)]);

  return result;
}
