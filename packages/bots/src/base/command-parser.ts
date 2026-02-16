import type { BotName } from '@bematic/common';
import type { ParsedCommand } from '@bematic/common';

/**
 * Parse raw text into a structured command.
 * Format: "command --flag value rest of args"
 * Example: "fix --file src/app.ts the login bug" -> { command: "fix", args: "the login bug", flags: { file: "src/app.ts" } }
 */
export function parseCommandText(
  botName: BotName,
  text: string,
  defaultCommand: string,
): ParsedCommand {
  const trimmed = text.trim();
  const tokens = tokenize(trimmed);

  let command = defaultCommand;
  const flags: Record<string, string | boolean> = {};
  const argParts: string[] = [];

  let i = 0;

  // First token might be the command name
  if (tokens.length > 0 && !tokens[0]!.startsWith('--')) {
    command = tokens[0]!;
    i = 1;
  }

  // Parse remaining tokens for flags and args
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token.startsWith('--')) {
      const flagName = token.slice(2);
      // Check if next token is a value (not another flag and not empty)
      if (i + 1 < tokens.length && !tokens[i + 1]!.startsWith('--')) {
        flags[flagName] = tokens[i + 1]!;
        i += 2;
      } else {
        flags[flagName] = true;
        i += 1;
      }
    } else {
      argParts.push(token);
      i += 1;
    }
  }

  return {
    botName,
    command,
    args: argParts.join(' '),
    flags,
    rawText: trimmed,
  };
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (const ch of text) {
    if (inQuotes) {
      if (ch === quoteChar) {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}
