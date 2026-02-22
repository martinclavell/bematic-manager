/**
 * Command Registry - Single source of truth for all /bm subcommands
 *
 * This registry enables:
 * 1. Auto-generated help messages
 * 2. Centralized command metadata
 * 3. Type-safe command routing
 * 4. Easy addition of new commands
 */

import type { AllMiddlewareArgs, SlackCommandMiddlewareArgs } from '@slack/bolt';
import type { AppContext } from '../../context.js';

export interface CommandMetadata {
  /** Command name (primary) */
  name: string;
  /** Command aliases */
  aliases?: string[];
  /** Short description for help text */
  description: string;
  /** Usage example */
  usage?: string;
  /** Additional usage examples */
  examples?: string[];
  /** Required permission */
  permission?: string;
  /** Command category for grouping in help */
  category: string;
  /** Whether command is hidden from help */
  hidden?: boolean;
}

export type CommandHandler = (
  args: SlackCommandMiddlewareArgs & AllMiddlewareArgs,
  ctx: AppContext,
  subArgs: string[]
) => Promise<void>;

export interface CommandDefinition extends CommandMetadata {
  handler: CommandHandler;
}

/**
 * Global command registry
 */
class CommandRegistry {
  private commands = new Map<string, CommandDefinition>();
  private aliases = new Map<string, string>(); // alias -> primary name

  /**
   * Register a command with metadata and handler
   */
  register(definition: CommandDefinition): void {
    // Register primary command
    this.commands.set(definition.name, definition);

    // Register aliases
    if (definition.aliases) {
      for (const alias of definition.aliases) {
        this.aliases.set(alias, definition.name);
      }
    }
  }

  /**
   * Get command by name or alias
   */
  get(nameOrAlias: string): CommandDefinition | undefined {
    const primaryName = this.aliases.get(nameOrAlias) ?? nameOrAlias;
    return this.commands.get(primaryName);
  }

  /**
   * Get all commands (excluding hidden)
   */
  getAll(includeHidden = false): CommandDefinition[] {
    return Array.from(this.commands.values()).filter(
      (cmd) => includeHidden || !cmd.hidden
    );
  }

  /**
   * Get commands by category
   */
  getByCategory(category: string): CommandDefinition[] {
    return this.getAll().filter((cmd) => cmd.category === category);
  }

  /**
   * Get all categories
   */
  getCategories(): string[] {
    const categories = new Set<string>();
    for (const cmd of this.commands.values()) {
      if (!cmd.hidden) {
        categories.add(cmd.category);
      }
    }
    return Array.from(categories).sort();
  }

  /**
   * Generate help text for all commands
   */
  generateHelpText(): string {
    const categories = this.getCategories();
    const sections: string[] = ['*Bematic Manager - /bm Commands Reference*\n'];

    for (const category of categories) {
      const commands = this.getByCategory(category);
      if (commands.length === 0) continue;

      sections.push(`*${category}:*`);

      for (const cmd of commands) {
        const aliases = cmd.aliases?.length
          ? ` (aliases: ${cmd.aliases.map((a) => `\`${a}\``).join(', ')})`
          : '';

        const usage = cmd.usage ? ` ${cmd.usage}` : '';
        sections.push(`\`/bm ${cmd.name}${usage}\`${aliases} - ${cmd.description}`);
      }

      sections.push(''); // Empty line between categories
    }

    sections.push(
      '*Help:*\n' +
      '`/bm help` or `/bm ?` - Show this help message\n\n' +
      '*For coding tasks*, use natural language mentions:\n' +
      '• `@BematicManager fix the login bug`\n' +
      '• `@BematicManager review this PR`\n' +
      '• `code refactor the auth module`\n' +
      '• `review security in payment flow`'
    );

    return sections.join('\n');
  }

  /**
   * Generate help text for a specific command
   */
  generateCommandHelp(nameOrAlias: string): string | undefined {
    const cmd = this.get(nameOrAlias);
    if (!cmd) return undefined;

    const aliases = cmd.aliases?.length
      ? ` (aliases: ${cmd.aliases.map((a) => `\`${a}\``).join(', ')})`
      : '';

    const sections: string[] = [
      `*Command: /bm ${cmd.name}*${aliases}\n`,
      `*Description:* ${cmd.description}\n`,
    ];

    if (cmd.usage) {
      sections.push(`*Usage:* \`/bm ${cmd.name} ${cmd.usage}\`\n`);
    }

    if (cmd.examples && cmd.examples.length > 0) {
      sections.push('*Examples:*');
      for (const example of cmd.examples) {
        sections.push(`• ${example}`);
      }
    }

    return sections.join('\n');
  }
}

export const commandRegistry = new CommandRegistry();
