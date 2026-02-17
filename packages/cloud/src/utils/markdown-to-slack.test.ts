import { describe, it, expect } from 'vitest';
import { markdownToSlack } from './markdown-to-slack.js';

// ── Helpers ────────────────────────────────────────────────────────────

/** Trim leading indentation so multi-line template strings read cleanly. */
function dedent(s: string): string {
  const lines = s.split('\n');
  // drop leading/trailing blank lines
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const indent = lines.reduce((min, l) => {
    if (l.trim() === '') return min;
    const m = l.match(/^(\s*)/);
    return Math.min(min, m ? m[1].length : 0);
  }, Infinity);
  return lines.map((l) => l.slice(indent)).join('\n');
}

// ── Edge cases & falsy inputs ──────────────────────────────────────────

describe('markdownToSlack', () => {
  describe('edge cases', () => {
    it('returns empty string for empty input', () => {
      expect(markdownToSlack('')).toBe('');
    });

    it('returns plain text unchanged', () => {
      expect(markdownToSlack('hello world')).toBe('hello world');
    });

    it('handles undefined-ish values gracefully', () => {
      // The function checks `if (!md)` so these should pass through
      expect(markdownToSlack(null as any)).toBe(null);
      expect(markdownToSlack(undefined as any)).toBe(undefined);
    });
  });

  // ── Headers ────────────────────────────────────────────────────────

  describe('headers', () => {
    it('converts h1 to bold', () => {
      expect(markdownToSlack('# Title')).toBe('*Title*');
    });

    it('converts h2 to bold', () => {
      expect(markdownToSlack('## Subtitle')).toBe('*Subtitle*');
    });

    it('converts h3-h6 to bold', () => {
      expect(markdownToSlack('### H3')).toBe('*H3*');
      expect(markdownToSlack('#### H4')).toBe('*H4*');
      expect(markdownToSlack('##### H5')).toBe('*H5*');
      expect(markdownToSlack('###### H6')).toBe('*H6*');
    });

    it('preserves header with inline formatting', () => {
      expect(markdownToSlack('## **Important** header')).toBe('**Important* header*');
    });
  });

  // ── Bold ───────────────────────────────────────────────────────────

  describe('bold', () => {
    it('converts **text** to *text*', () => {
      expect(markdownToSlack('this is **bold** text')).toBe('this is *bold* text');
    });

    it('converts __text__ to *text*', () => {
      expect(markdownToSlack('this is __bold__ text')).toBe('this is *bold* text');
    });

    it('handles multiple bold spans', () => {
      expect(markdownToSlack('**one** and **two**')).toBe('*one* and *two*');
    });
  });

  // ── Strikethrough ──────────────────────────────────────────────────

  describe('strikethrough', () => {
    it('converts ~~text~~ to ~text~', () => {
      expect(markdownToSlack('this is ~~deleted~~ text')).toBe('this is ~deleted~ text');
    });

    it('handles multiple strikethroughs', () => {
      expect(markdownToSlack('~~one~~ and ~~two~~')).toBe('~one~ and ~two~');
    });
  });

  // ── Bold+Italic combo ─────────────────────────────────────────────

  describe('bold+italic combo', () => {
    it('converts ***text*** to *_text_*', () => {
      expect(markdownToSlack('this is ***important*** text')).toBe('this is *_important_* text');
    });
  });

  // ── Links ──────────────────────────────────────────────────────────

  describe('links', () => {
    it('converts [text](url) to <url|text>', () => {
      expect(markdownToSlack('[click here](https://example.com)')).toBe('<https://example.com|click here>');
    });

    it('converts image ![alt](url) to <url|alt>', () => {
      expect(markdownToSlack('![logo](https://example.com/img.png)')).toBe('<https://example.com/img.png|logo>');
    });

    it('handles image with empty alt text', () => {
      expect(markdownToSlack('![](https://example.com/img.png)')).toBe('<https://example.com/img.png|>');
    });

    it('handles multiple links', () => {
      const input = '[a](https://a.com) and [b](https://b.com)';
      expect(markdownToSlack(input)).toBe('<https://a.com|a> and <https://b.com|b>');
    });
  });

  // ── Horizontal rules ──────────────────────────────────────────────

  describe('horizontal rules', () => {
    it('converts --- to ───', () => {
      expect(markdownToSlack('---')).toBe('───');
    });

    it('converts *** to ───', () => {
      expect(markdownToSlack('***')).toBe('───');
    });

    it('converts ___ to ───', () => {
      expect(markdownToSlack('___')).toBe('───');
    });

    it('converts longer rules', () => {
      expect(markdownToSlack('----------')).toBe('───');
    });
  });

  // ── Code blocks ───────────────────────────────────────────────────

  describe('code blocks', () => {
    it('preserves fenced code blocks unchanged', () => {
      const input = '```\nconst x = **not bold**;\n```';
      expect(markdownToSlack(input)).toBe(input);
    });

    it('preserves code blocks with language tag', () => {
      const input = '```typescript\nconst x: string = "hello";\n```';
      expect(markdownToSlack(input)).toBe(input);
    });

    it('preserves inline code unchanged', () => {
      expect(markdownToSlack('use `**not bold**` here')).toBe('use `**not bold**` here');
    });

    it('handles code blocks with markdown-like content inside', () => {
      const input = '```\n## Not a header\n**not bold**\n[not a link](foo)\n```';
      expect(markdownToSlack(input)).toBe(input);
    });

    it('does not break when code block contains backticks', () => {
      const input = 'before\n```\ncode\n```\nafter **bold**';
      expect(markdownToSlack(input)).toBe('before\n```\ncode\n```\nafter *bold*');
    });
  });

  // ── Blockquotes ───────────────────────────────────────────────────

  describe('blockquotes', () => {
    it('normalizes > text to > text', () => {
      expect(markdownToSlack('> quoted text')).toBe('> quoted text');
    });

    it('handles blockquote without space after >', () => {
      expect(markdownToSlack('>no space')).toBe('> no space');
    });

    it('handles multi-line blockquotes', () => {
      const input = '> line one\n> line two';
      expect(markdownToSlack(input)).toBe('> line one\n> line two');
    });
  });

  // ── Lists ─────────────────────────────────────────────────────────

  describe('unordered lists', () => {
    it('converts - item to bullet', () => {
      expect(markdownToSlack('- first item')).toBe('•  first item');
    });

    it('converts * item to bullet', () => {
      expect(markdownToSlack('* first item')).toBe('•  first item');
    });

    it('preserves indentation for nested lists', () => {
      const input = '- parent\n  - child';
      const expected = '•  parent\n  •  child';
      expect(markdownToSlack(input)).toBe(expected);
    });

    it('handles multiple items', () => {
      const input = '- one\n- two\n- three';
      const expected = '•  one\n•  two\n•  three';
      expect(markdownToSlack(input)).toBe(expected);
    });
  });

  describe('ordered lists', () => {
    it('preserves numbered list items as-is', () => {
      const input = '1. first\n2. second\n3. third';
      expect(markdownToSlack(input)).toBe(input);
    });
  });

  describe('task lists', () => {
    it('converts checked items to ✅', () => {
      expect(markdownToSlack('- [x] done task')).toBe('✅  done task');
    });

    it('converts unchecked items to ☐', () => {
      expect(markdownToSlack('- [ ] pending task')).toBe('☐  pending task');
    });

    it('handles mixed task lists', () => {
      const input = '- [x] done\n- [ ] todo\n- [x] also done';
      const expected = '✅  done\n☐  todo\n✅  also done';
      expect(markdownToSlack(input)).toBe(expected);
    });

    it('handles task list with * prefix', () => {
      expect(markdownToSlack('* [x] done')).toBe('✅  done');
      expect(markdownToSlack('* [ ] todo')).toBe('☐  todo');
    });
  });

  // ── Tables ────────────────────────────────────────────────────────

  describe('tables', () => {
    it('converts a simple table to a code block', () => {
      const input = dedent(`
        | Name | Value |
        |------|-------|
        | foo  | bar   |
      `);
      const result = markdownToSlack(input);
      expect(result).toContain('```');
      expect(result).toContain('Name');
      expect(result).toContain('Value');
      expect(result).toContain('foo');
      expect(result).toContain('bar');
      expect(result).toContain('│');
      expect(result).toContain('─');
    });

    it('strips inline formatting from table cells', () => {
      const input = dedent(`
        | File | Status |
        |------|--------|
        | **bold.ts** | _done_ |
      `);
      const result = markdownToSlack(input);
      expect(result).toContain('bold.ts');
      expect(result).not.toContain('**');
      expect(result).toContain('done');
    });

    it('resolves inline code in table cells (strips backticks)', () => {
      const input = dedent(`
        | File | Change |
        |------|--------|
        | \`main.ts\` | Added feature |
      `);
      const result = markdownToSlack(input);
      expect(result).toContain('main.ts');
      // Should NOT contain the raw placeholder
      expect(result).not.toContain('%%INLINECODE');
      // Backticks should be stripped since it's inside a code block
      // The cell content should just be "main.ts" not "`main.ts`"
    });

    it('aligns columns properly', () => {
      const input = dedent(`
        | Short | Longer header |
        |-------|---------------|
        | a     | b             |
        | longer cell | c      |
      `);
      const result = markdownToSlack(input);
      // All rows between ``` should have │ at the same position
      const lines = result.split('\n').filter((l) => l.includes('│'));
      const positions = lines.map((l) => l.indexOf('│'));
      // All │ should be at the same column position
      expect(new Set(positions).size).toBe(1);
    });

    it('passes through pipe-starting lines without a separator row', () => {
      const input = '| not a table\n| just pipe lines';
      expect(markdownToSlack(input)).toBe(input);
    });

    it('handles table with only header + separator (no data rows)', () => {
      const input = '| A | B |\n|---|---|';
      const result = markdownToSlack(input);
      // Should still produce a code block with just the header
      expect(result).toContain('```');
      expect(result).toContain('A');
    });

    it('handles the exact user-reported table format', () => {
      const input = dedent(`
        | File | Change |
        |------|--------|
        | *\`messages.ts\`* | Allow \`file_share\` subtype through |
        | *\`mentions.ts\`* | Same file extraction logic |
        | *\`file-utils.ts\`* (new) | Shared utility |
        | *\`14-file-index.md\`* | Added entry |
      `);
      const result = markdownToSlack(input);
      expect(result).toContain('```');
      expect(result).toContain('messages.ts');
      expect(result).toContain('mentions.ts');
      expect(result).toContain('file-utils.ts');
      expect(result).not.toContain('%%INLINECODE');
      expect(result).not.toContain('**');
    });

    it('does not mangle text before and after a table', () => {
      const input = 'Here is a **summary**:\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nEnd of report.';
      const result = markdownToSlack(input);
      expect(result).toContain('*summary*');
      expect(result).toContain('```');
      expect(result).toContain('End of report.');
    });
  });

  // ── Mixed / real-world scenarios ──────────────────────────────────

  describe('real-world scenarios', () => {
    it('handles a typical Claude Code response', () => {
      const input = dedent(`
        ## Summary

        I fixed the **authentication** bug in \`auth.ts\`.

        ### Changes

        - Updated the token validation logic
        - Added error handling for expired tokens
        - [Documentation](https://docs.example.com)

        \`\`\`typescript
        if (!token.valid) {
          throw new AuthError('expired');
        }
        \`\`\`

        ---

        ~~Old approach~~ has been replaced.
      `);

      const result = markdownToSlack(input);

      // Headers → bold
      expect(result).toContain('*Summary*');
      expect(result).toContain('*Changes*');
      // Bold → Slack bold
      expect(result).toContain('*authentication*');
      // Inline code preserved
      expect(result).toContain('`auth.ts`');
      // Lists → bullets
      expect(result).toContain('•  Updated the token validation logic');
      // Links → Slack format
      expect(result).toContain('<https://docs.example.com|Documentation>');
      // Code block preserved
      expect(result).toContain("throw new AuthError('expired');");
      // HR
      expect(result).toContain('───');
      // Strikethrough
      expect(result).toContain('~Old approach~');
    });

    it('handles a review bot response with task list and table', () => {
      const input = dedent(`
        ## Code Review

        ### Findings

        - [x] No security issues found
        - [ ] Performance optimization needed in \`query.ts\`
        - [x] Tests passing

        | Severity | File | Issue |
        |----------|------|-------|
        | **Warning** | \`db.ts\` | Missing index |
        | **Info** | \`api.ts\` | Unused import |
      `);

      const result = markdownToSlack(input);

      // Headers
      expect(result).toContain('*Code Review*');
      expect(result).toContain('*Findings*');
      // Task list
      expect(result).toContain('✅  No security issues found');
      expect(result).toContain('☐  Performance optimization needed');
      // Table as code block
      expect(result).toContain('```');
      expect(result).toContain('Warning');
      expect(result).toContain('db.ts');
    });

    it('does not double-convert already-converted Slack formatting', () => {
      // If someone sends Slack mrkdwn through, it shouldn't be mangled further
      const input = '*already bold* and ~already strikethrough~';
      const result = markdownToSlack(input);
      // Should pass through without wrapping in extra formatting
      expect(result).toBe(input);
    });

    it('handles multiple code blocks with text in between', () => {
      const input = '```\nblock1\n```\n\n**bold text**\n\n```\nblock2\n```';
      const result = markdownToSlack(input);
      expect(result).toContain('```\nblock1\n```');
      expect(result).toContain('*bold text*');
      expect(result).toContain('```\nblock2\n```');
    });

    it('handles deeply nested list with formatting', () => {
      const input = '- **Important**: first point\n  - Sub-point with `code`\n- Normal point';
      const result = markdownToSlack(input);
      expect(result).toContain('•  *Important*: first point');
      expect(result).toContain('  •  Sub-point with `code`');
      expect(result).toContain('•  Normal point');
    });
  });
});
