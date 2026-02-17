/**
 * Converts GitHub-flavored Markdown to Slack mrkdwn format.
 *
 * Conversion map:
 * - MD: **bold** / __bold__      → Slack: *bold*
 * - MD: *italic* / _italic_      → Slack: _italic_
 * - MD: ***bold italic***        → Slack: *_bold italic_*
 * - MD: ~~strikethrough~~        → Slack: ~strikethrough~
 * - MD: ## Header                → Slack: *Header*
 * - MD: [text](url)              → Slack: <url|text>
 * - MD: ![alt](url)              → Slack: <url|alt>
 * - MD: > blockquote             → Slack: > blockquote
 * - MD: - [ ] task / - [x] task  → Slack: ☐ / ✅ task
 * - MD: - item / * item          → Slack: •  item (with indent)
 * - MD: 1. item                  → Slack: 1. item (preserved)
 * - MD: tables                   → Slack: preformatted code block
 * - MD: ---                      → Slack: ───
 * - Code blocks and inline code are preserved as-is
 */
export function markdownToSlack(md: string): string {
  if (!md) return md;

  let result = md;

  // ── Phase 1: Protect content that must not be modified ──────────────

  // Protect fenced code blocks
  // NOTE: Placeholders use %% delimiters (not __) to avoid collision
  // with the __bold__ → *bold* conversion.
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

  // ── Phase 2: Block-level conversions ────────────────────────────────

  // Convert Markdown tables to preformatted code blocks.
  // Must run BEFORE inline conversions so pipe characters aren't mangled.
  // The resulting code blocks are pushed into the codeBlocks array (protected).
  result = convertTables(result, codeBlocks, inlineCode);

  // Task lists: - [x] item / - [ ] item → emoji checkboxes
  // Must run BEFORE unordered list conversion so the `- ` prefix is handled here.
  result = result.replace(/^(\s*)[-*]\s+\[x\]\s+(.+)$/gm, '$1✅  $2');
  result = result.replace(/^(\s*)[-*]\s+\[ \]\s+(.+)$/gm, '$1☐  $2');

  // Unordered lists: - item or * item → •  item
  // Preserve indentation. Only match lines starting with - or * followed by space.
  // Must run BEFORE bold conversion so `* item` isn't turned into italic.
  result = result.replace(/^(\s*)[-*]\s+(.+)$/gm, '$1•  $2');

  // Headers: ## Header → *Header* (bold in Slack)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Blockquotes: > text → > text (Slack uses the same syntax)
  // But strip the extra space after > that Markdown uses, and handle nested >>
  result = result.replace(/^(\s*)>\s?/gm, '$1> ');

  // Horizontal rules: --- or *** or ___ → ───
  result = result.replace(/^[-*_]{3,}$/gm, '───');

  // ── Phase 3: Inline conversions ─────────────────────────────────────

  // Bold+italic combo: ***text*** → *_text_*
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, '*_$1_*');

  // Bold: **text** → *text*
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // Bold: __text__ → *text*
  result = result.replace(/__(.+?)__/g, '*$1*');

  // Strikethrough: ~~text~~ → ~text~
  result = result.replace(/~~(.+?)~~/g, '~$1~');

  // Images: ![alt](url) → <url|alt>
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<$2|$1>');

  // Links: [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // ── Phase 4: Restore protected content ──────────────────────────────

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

/**
 * Split a table row into trimmed cell values.
 * Drops leading/trailing empty segments from the split.
 * Resolves inline-code placeholders back to readable text (without backticks)
 * since the table will be rendered inside a monospace code block.
 */
function parseCells(row: string, inlineCode: string[]): string[] {
  return row
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => stripCellMarkdown(c.trim(), inlineCode));
}

/**
 * Strip Markdown formatting from a table cell so it reads cleanly in monospace.
 * Inline-code placeholders are resolved back to their text content (backticks
 * stripped since the whole table is already inside a ``` block).
 */
function stripCellMarkdown(text: string, inlineCode: string[]): string {
  return text
    // Resolve inline-code placeholders → raw text (drop backticks)
    .replace(/%%INLINECODE_(\d+)%%/g, (_, i) => {
      const raw = inlineCode[parseInt(i)] ?? '';
      // Strip surrounding backticks: `foo` → foo
      return raw.replace(/^`|`$/g, '');
    })
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')   // ***bold italic***
    .replace(/\*\*(.+?)\*\*/g, '$1')        // **bold**
    .replace(/__(.+?)__/g, '$1')             // __bold__
    .replace(/\*(.+?)\*/g, '$1')             // *italic*
    .replace(/_(.+?)_/g, '$1')               // _italic_
    .replace(/~~(.+?)~~/g, '$1')             // ~~strikethrough~~
    ;
}

/**
 * Find consecutive table-row blocks in the text and replace each block
 * with a placeholder pointing to a preformatted ``` code block.
 * The code block is pushed into the shared codeBlocks array so it is
 * protected from further inline conversions (bold, italic, links, etc.).
 */
function convertTables(text: string, codeBlocks: string[], inlineCode: string[]): string {
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
      output.push(...tableLines);
      continue;
    }

    // Check that there is actually a separator row (validates it's a real table)
    const hasSeparator = tableLines.some((l) => isSeparatorRow(l));
    if (!hasSeparator) {
      output.push(...tableLines);
      continue;
    }

    // Parse rows, dropping the separator
    const dataRows: string[][] = [];
    for (const line of tableLines) {
      if (isSeparatorRow(line)) continue;
      dataRows.push(parseCells(line, inlineCode));
    }

    if (dataRows.length === 0) {
      output.push(...tableLines);
      continue;
    }

    // Normalize column counts (some rows may have fewer cells)
    const colCount = Math.max(...dataRows.map((r) => r.length));

    // Calculate column widths
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
