import {
  BOT_KEYWORDS,
  BOT_SLASH_COMMANDS,
  type BotName,
  type BotPlugin,
  type ParsedCommand,
} from '@bematic/common';

class BotRegistryImpl {
  private bots = new Map<BotName, BotPlugin>();

  register(bot: BotPlugin): void {
    this.bots.set(bot.name, bot);
  }

  get(name: BotName): BotPlugin | undefined {
    return this.bots.get(name);
  }

  getAll(): BotPlugin[] {
    return Array.from(this.bots.values());
  }

  /**
   * Resolve a bot from an @mention text.
   * Text format: "@BematicManager code fix the login bug"
   * Returns the bot and parsed command, or undefined if no match.
   */
  resolveFromMention(text: string): { bot: BotPlugin; command: ParsedCommand } | undefined {
    // Strip @mention prefix if present
    const cleaned = text.replace(/<@[A-Z0-9]+>/g, '').trim();
    const firstWord = cleaned.split(/\s+/)[0]?.toLowerCase() ?? '';
    const rest = cleaned.slice(firstWord.length).trim();

    // Find which bot this keyword maps to
    for (const [botName, keywords] of Object.entries(BOT_KEYWORDS)) {
      if (keywords.includes(firstWord)) {
        const bot = this.bots.get(botName as BotName);
        if (bot) {
          const command = bot.parseCommand(rest);
          return { bot, command };
        }
      }
    }

    // No keyword match - default to first bot if there's text
    if (cleaned.length > 0) {
      const defaultBot = this.bots.get('coder' as BotName);
      if (defaultBot) {
        const command = defaultBot.parseCommand(cleaned);
        return { bot: defaultBot, command };
      }
    }

    return undefined;
  }

  /**
   * Resolve a bot from a slash command.
   * Example: "/bm-code fix the login bug"
   */
  resolveFromSlashCommand(
    slashCommand: string,
    text: string,
  ): { bot: BotPlugin; command: ParsedCommand } | undefined {
    const botName = BOT_SLASH_COMMANDS[slashCommand];
    if (!botName) return undefined;

    const bot = this.bots.get(botName);
    if (!bot) return undefined;

    const command = bot.parseCommand(text);
    return { bot, command };
  }
}

export const BotRegistry = new BotRegistryImpl();
