import { Limits } from '../constants/limits.js';

/**
 * Options for truncating messages with different strategies
 */
export interface TruncationOptions {
  /** Maximum length (defaults to recommended Slack limit) */
  maxLength?: number;
  /** Strategy: 'head' (keep beginning), 'tail' (keep end), 'smart' (keep important parts) */
  strategy?: 'head' | 'tail' | 'smart';
  /** Indicator to add when truncated */
  indicator?: string;
  /** Preserve code blocks during truncation */
  preserveCodeBlocks?: boolean;
}

/**
 * Represents a section of text with metadata about its importance
 */
interface TextSection {
  content: string;
  start: number;
  end: number;
  priority: number; // Higher = more important
  type: 'code' | 'header' | 'text';
}

/**
 * Truncate a message intelligently based on the specified strategy.
 *
 * Enterprise considerations:
 * - HEAD strategy: Best for streaming (users see beginning first)
 * - TAIL strategy: Avoid for user-facing (loses context)
 * - SMART strategy: Best for final results (preserves structure)
 */
export function truncateMessage(text: string, options: TruncationOptions = {}): {
  truncated: string;
  wasTruncated: boolean;
  originalLength: number;
} {
  const {
    maxLength = Limits.SLACK_MESSAGE_RECOMMENDED_LENGTH,
    strategy = 'head',
    indicator = '\n\n_...message truncated (too long for Slack)_',
    preserveCodeBlocks = true,
  } = options;

  const originalLength = text.length;

  // No truncation needed
  if (text.length <= maxLength) {
    return { truncated: text, wasTruncated: false, originalLength };
  }

  let truncated: string;

  switch (strategy) {
    case 'tail':
      // Keep the end (legacy behavior - not recommended)
      truncated = truncateTail(text, maxLength, indicator);
      break;

    case 'smart':
      // Intelligent truncation preserving structure
      truncated = truncateSmart(text, maxLength, indicator, preserveCodeBlocks);
      break;

    case 'head':
    default:
      // Keep the beginning (recommended for streaming)
      truncated = truncateHead(text, maxLength, indicator);
      break;
  }

  return { truncated, wasTruncated: true, originalLength };
}

/**
 * Truncate keeping the beginning (HEAD strategy)
 * Best for: Streaming messages, progress updates
 */
function truncateHead(text: string, maxLength: number, indicator: string): string {
  const availableLength = maxLength - indicator.length;
  if (availableLength <= 0) {
    return text.slice(0, maxLength);
  }
  return text.slice(0, availableLength) + indicator;
}

/**
 * Truncate keeping the end (TAIL strategy)
 * Best for: Rare cases where conclusion is most important
 */
function truncateTail(text: string, maxLength: number, indicator: string): string {
  const availableLength = maxLength - indicator.length;
  if (availableLength <= 0) {
    return text.slice(-maxLength);
  }
  return indicator + text.slice(-availableLength);
}

/**
 * Smart truncation that preserves important sections
 * Best for: Final results, structured content
 *
 * Strategy:
 * 1. Identify code blocks, headers, and key sections
 * 2. Prioritize keeping complete structures
 * 3. Truncate less important plain text sections
 */
function truncateSmart(
  text: string,
  maxLength: number,
  indicator: string,
  preserveCodeBlocks: boolean,
): string {
  const sections = analyzeSections(text);
  const availableLength = maxLength - indicator.length;

  if (availableLength <= 0) {
    return text.slice(0, maxLength);
  }

  // Sort sections by priority (highest first)
  const sortedSections = [...sections].sort((a, b) => b.priority - a.priority);

  // Greedily select sections that fit
  const selectedSections: TextSection[] = [];
  let currentLength = 0;

  for (const section of sortedSections) {
    const sectionLength = section.content.length;

    // Always try to include code blocks if preserving them
    if (preserveCodeBlocks && section.type === 'code') {
      if (currentLength + sectionLength <= availableLength) {
        selectedSections.push(section);
        currentLength += sectionLength;
      }
    } else if (currentLength + sectionLength <= availableLength) {
      selectedSections.push(section);
      currentLength += sectionLength;
    }
  }

  // If we couldn't fit anything, fall back to head truncation
  if (selectedSections.length === 0) {
    return truncateHead(text, maxLength, indicator);
  }

  // Reconstruct text in original order
  selectedSections.sort((a, b) => a.start - b.start);

  let result = '';
  let lastEnd = 0;

  for (const section of selectedSections) {
    // Add gap indicator if we skipped content
    if (section.start > lastEnd && result.length > 0) {
      result += '\n\n_...[content omitted]..._\n\n';
    }
    result += section.content;
    lastEnd = section.end;
  }

  // Add final indicator
  if (lastEnd < text.length) {
    result += indicator;
  }

  return result;
}

/**
 * Analyze text to identify important sections
 */
function analyzeSections(text: string): TextSection[] {
  const sections: TextSection[] = [];
  const lines = text.split('\n');
  let currentPos = 0;

  // Find code blocks
  const codeBlockRegex = /```[\s\S]*?```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    sections.push({
      content: match[0],
      start: match.index,
      end: match.index + match[0].length,
      priority: 10, // High priority for code blocks
      type: 'code',
    });
  }

  // Find headers (markdown style)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(/^#{1,6}\s+(.+)$/);

    if (headerMatch) {
      const start = text.indexOf(line, currentPos);
      sections.push({
        content: line,
        start,
        end: start + line.length,
        priority: 8, // High priority for headers
        type: 'header',
      });
    }

    currentPos += line.length + 1; // +1 for newline
  }

  // Fill gaps with regular text sections (lower priority)
  const sortedSpecialSections = sections.sort((a, b) => a.start - b.start);
  let lastEnd = 0;

  for (const section of sortedSpecialSections) {
    if (section.start > lastEnd) {
      const plainText = text.slice(lastEnd, section.start);
      if (plainText.trim().length > 0) {
        sections.push({
          content: plainText,
          start: lastEnd,
          end: section.start,
          priority: 5, // Lower priority for plain text
          type: 'text',
        });
      }
    }
    lastEnd = section.end;
  }

  // Add trailing text
  if (lastEnd < text.length) {
    const trailingText = text.slice(lastEnd);
    if (trailingText.trim().length > 0) {
      sections.push({
        content: trailingText,
        start: lastEnd,
        end: text.length,
        priority: 5,
        type: 'text',
      });
    }
  }

  return sections;
}

/**
 * Truncate text for a Slack section block (3000 char limit per block)
 * Returns multiple blocks if needed to display full content
 */
export function truncateForSectionBlock(text: string): string[] {
  const maxLength = Limits.SLACK_SECTION_BLOCK_MAX_LENGTH;

  if (text.length <= maxLength) {
    return [text];
  }

  // Split into multiple chunks, trying to break at natural boundaries
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to find a natural break point (newline) near the limit
    let breakPoint = maxLength;
    const searchStart = Math.max(0, maxLength - 200); // Look back up to 200 chars
    const lastNewline = remaining.lastIndexOf('\n', maxLength);

    if (lastNewline > searchStart) {
      breakPoint = lastNewline + 1;
    }

    chunks.push(remaining.slice(0, breakPoint).trimEnd());
    remaining = remaining.slice(breakPoint).trimStart();
  }

  return chunks;
}
