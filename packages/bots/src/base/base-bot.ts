import type {
  BotPlugin,
  BotCommand,
  ParsedCommand,
  BotExecutionConfig,
  SlackBlock,
  TaskCompletePayload,
  BotName,
} from '@bematic/common';
import { parseCommandText } from './command-parser.js';
import * as rb from './response-builder.js';

export abstract class BaseBotPlugin implements BotPlugin {
  abstract name: BotName;
  abstract displayName: string;
  abstract description: string;
  abstract slashCommand: string;
  abstract commands: BotCommand[];
  abstract defaultCommand: string;

  /** System prompt preamble shared by all bots */
  protected get baseSystemPrompt(): string {
    return `You are an AI assistant managed by Bematic Manager. Execute the task precisely and efficiently. Report what you did clearly.

## Post-Task Requirements (ALWAYS do these after making changes)

### 1. Update Documentation
After making code changes, check if the \`Documentation/\` folder needs updating:
- If you **added or removed files**: update \`Documentation/14-file-index.md\` with the new/removed entries.
- If you **changed a package's public API, architecture, or behavior**: update the corresponding package doc (\`03-package-common.md\` through \`07-package-agent.md\`).
- If you **added a new database table, WebSocket message type, or bot**: update the relevant how-to section in \`Documentation/13-coding-conventions.md\` and the schema/protocol docs.
- If you **changed environment variables**: update \`Documentation/11-environment-variables.md\`.
- If you **changed build/deploy steps**: update \`Documentation/12-build-run-deploy.md\`.
- If the change is trivial (typo fix, internal refactor with no API change), skip documentation updates.
Keep documentation concise and consistent with the existing style.

### 2. Commit and Push
After all code and documentation changes are complete:
1. Stage all changed files: \`git add -A\`
2. Write a clear, concise commit message summarizing what changed and why.
3. Commit: \`git commit -m "<message>"\`
4. Push to the current branch: \`git push\`
If the push fails (e.g. no upstream), use: \`git push -u origin HEAD\``;
  }

  /** Bot-specific system prompt (override in subclass) */
  protected abstract getSystemPrompt(): string;

  /** Bot-specific allowed tools (override in subclass) */
  protected abstract getAllowedTools(): string[];

  parseCommand(text: string): ParsedCommand {
    return parseCommandText(this.name, text, this.defaultCommand);
  }

  buildExecutionConfig(
    command: ParsedCommand,
    projectContext: { name: string; localPath: string; defaultModel: string; defaultMaxBudget: number },
  ): BotExecutionConfig {
    const botCommand = this.commands.find(
      (c) => c.name === command.command || c.aliases.includes(command.command),
    );

    const promptTemplate = botCommand?.defaultPromptTemplate ?? '{args}';
    const prompt = promptTemplate.replace('{args}', command.args);

    const model =
      (command.flags['model'] as string | undefined) ?? projectContext.defaultModel;
    const maxBudget =
      (command.flags['budget'] as string | undefined)
        ? parseFloat(command.flags['budget'] as string)
        : projectContext.defaultMaxBudget;

    return {
      systemPrompt: `${this.baseSystemPrompt}\n\n${this.getSystemPrompt()}`,
      prompt,
      model,
      maxBudget,
      allowedTools: this.getAllowedTools(),
    };
  }

  formatResult(result: TaskCompletePayload): SlackBlock[] {
    return rb.taskCompleteBlocks(result.result, {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      estimatedCost: result.estimatedCost,
      durationMs: result.durationMs,
      filesChanged: result.filesChanged,
    });
  }

  formatError(error: string, taskId: string): SlackBlock[] {
    return rb.taskErrorBlocks(error, taskId);
  }
}
