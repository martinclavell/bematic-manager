/**
 * Converts GitHub-flavored Markdown to Slack mrkdwn format.
 *
 * Key differences:
 * - MD: **bold** → Slack: *bold*
 * - MD: *italic* / _italic_ → Slack: _italic_
 * - MD: ## Header → Slack: *Header*
 * - MD: [text](url) → Slack: <url|text>
 * - MD: ![alt](url) → Slack: <url|alt>
 * - MD tables → Slack: preformatted code block with aligned columns
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

  // Convert Markdown tables to preformatted code blocks.
  // Must run BEFORE inline conversions so pipe characters aren't mangled.
  // The resulting code blocks are pushed into the codeBlocks array (protected).
  result = convertTables(result, codeBlocks);

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

  // Restore code blocks first (they may contain inline-code placeholders)
  result = result.replace(/%%CODEBLOCK_(\d+)%%/g, (_, i) => codeBlocks[parseInt(i)]);

  // Restore inline code (both in normal text and inside restored code blocks)
  result = result.replace(/%%INLINECODE_(\d+)%%/g, (_, i) => inlineCode[parseInt(i)]);

  return result;
}

// ── Table helpers ──────────────────────────────────────────────────────

/** True when a line looks like a Markdown table row: starts with `|` */
function isTableRow(line: string): boolean {
  return /^\s*\|/.test(line);
}

/** True for the separator row, e.g. `|------|--------|` or `| :---: | --- |` */
function isSeparatorRow(line: string): boolean {
  return /^\s*\|[\s:-]+\|[\s:|-]*$/.test(line);
}

/** Split a table row into trimmed cell values (drops leading/trailing empty segments). */
function parseCells(row: string): string[] {
  return row
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => stripInlineMarkdown(c.trim()));
}

/**
 * Strip lightweight Markdown formatting so the monospace table reads cleanly.
 * Restores inline-code placeholder content but drops the backticks so it
 * stays readable inside a ``` block.
 */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')      // **bold**
    .replace(/__(.+?)__/g, '$1')            // __bold__
    .replace(/\*(.+?)\*/g, '$1')            // *italic*
    .replace(/_(.+?)_/g, '$1')              // _italic_
    .replace(/%%INLINECODE_\d+%%/g, (m) => m)  // keep placeholder (restored later)
    ;
}

/**
 * Find consecutive table-row blocks in the text and replace each block
 * with a placeholder pointing to a preformatted ``` code block.
 * The code block is pushed into the shared codeBlocks array so it is
 * protected from further inline conversions (bold, italic, links, etc.).
 */
function convertTables(text: string, codeBlocks: string[]): string {
  const lines = text.split('\n');
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!isTableRow(lines[i])) {
      output.push(lines[i]);
      i++;
      continue;
    }

    // Collect all consecutive table lines
    const tableLines: string[] = [];
    while (i < lines.length && isTableRow(lines[i])) {
      tableLines.push(lines[i]);
      i++;
    }

    // Need at least a header + separator (2 lines) to be a table
    if (tableLines.length < 2) {
      // Not really a table, keep as-is
      output.push(...tableLines);
      continue;
    }

    // Parse rows, dropping the separator
    const dataRows: string[][] = [];
    for (const line of tableLines) {
      if (isSeparatorRow(line)) continue;
      dataRows.push(parseCells(line));
    }

    if (dataRows.length === 0) {
      output.push(...tableLines);
      continue;
    }

    // Calculate column widths
    const colCount = Math.max(...dataRows.map((r) => r.length));
    const widths: number[] = new Array(colCount).fill(0);
    for (const row of dataRows) {
      for (let c = 0; c < colCount; c++) {
        widths[c] = Math.max(widths[c], (row[c] ?? '').length);
      }
    }

    // Build the formatted table
    const formatted: string[] = [];
    for (let r = 0; r < dataRows.length; r++) {
      const cells = dataRows[r];
      const padded = widths.map((w, c) => (cells[c] ?? '').padEnd(w));
      formatted.push(padded.join('  │  '));

      // Add a divider after the header row
      if (r === 0) {
        formatted.push(widths.map((w) => '─'.repeat(w)).join('──┼──'));
      }
    }

    // Wrap in a code block and register as a protected block
    const block = '```\n' + formatted.join('\n') + '\n```';
    codeBlocks.push(block);
    output.push(`%%CODEBLOCK_${codeBlocks.length - 1}%%`);
  }

  return output.join('\n');
}
