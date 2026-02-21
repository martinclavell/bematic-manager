import type { SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import type { AppContext } from '../../context.js';
import { createLogger, Permission } from '@bematic/common';

const logger = createLogger('admin-global-contexts');

/**
 * Admin commands for managing global Claude contexts
 *
 * Commands:
 * - /admin-contexts list
 * - /admin-contexts stats
 * - /admin-contexts add <category> <name> <content>
 * - /admin-contexts update <id> <content>
 * - /admin-contexts enable <id>
 * - /admin-contexts disable <id>
 * - /admin-contexts delete <id>
 * - /admin-contexts reload
 */

/**
 * List all global contexts
 */
export async function handleListContexts(
  args: SlackCommandMiddlewareArgs & AllMiddlewareArgs,
  ctx: AppContext,
) {
  const { ack, respond, command } = args;
  await ack();

  try {
    const userId = command.user_id;
    await ctx.authChecker.checkPermission(userId, Permission.USER_MANAGE);

    const contexts = ctx.globalContextService.listAll();

    if (contexts.length === 0) {
      await respond({
        text: '📋 No global contexts found.',
        response_type: 'ephemeral',
      });
      return;
    }

    const lines = contexts.map((c) => {
      const status = c.enabled ? '✅' : '❌';
      const source = c.source === 'file' ? '📄' : '💾';
      const id = c.id ?? 'N/A';
      const project = c.projectId ? ` (Project: ${c.projectId.slice(0, 8)}...)` : '';
      return `${status} ${source} \`${id}\` - *${c.category}* / ${c.name} [Priority: ${c.priority}, Scope: ${c.scope}${project}]`;
    });

    await respond({
      text: `📋 *Global Contexts (${contexts.length})*\n\n${lines.join('\n')}\n\n💾 = Database | 📄 = File | ✅ = Enabled | ❌ = Disabled`,
      response_type: 'ephemeral',
    });
  } catch (error) {
    logger.error({ error, userId: command.user_id }, 'Failed to list contexts');
    await respond({
      text: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
      response_type: 'ephemeral',
    });
  }
}

/**
 * Show context statistics
 */
export async function handleContextStats(
  args: SlackCommandMiddlewareArgs & AllMiddlewareArgs,
  ctx: AppContext,
) {
  const { ack, respond, command } = args;
  await ack();

  try {
    const userId = command.user_id;
    await ctx.authChecker.checkPermission(userId, Permission.USER_MANAGE);

    const stats = ctx.globalContextService.getStats();

    await respond({
      text: `📊 *Global Context Statistics*

Total Contexts: ${stats.totalContexts}
Enabled: ${stats.enabledContexts}
File-based: ${stats.fileContexts}
Database: ${stats.databaseContexts}
Cache Size: ${stats.cacheSize} entries
Categories: ${stats.categories.join(', ')}`,
      response_type: 'ephemeral',
    });
  } catch (error) {
    logger.error({ error, userId: command.user_id }, 'Failed to get context stats');
    await respond({
      text: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
      response_type: 'ephemeral',
    });
  }
}

/**
 * Add a new global context
 * Usage: /admin-contexts add <category> <name> <content>
 */
export async function handleAddContext(
  args: SlackCommandMiddlewareArgs & AllMiddlewareArgs,
  ctx: AppContext,
) {
  const { ack, respond, command } = args;
  await ack();

  try {
    const userId = command.user_id;
    await ctx.authChecker.checkPermission(userId, Permission.USER_MANAGE);

    const parts = command.text.split(' ').slice(1); // Skip 'add'
    if (parts.length < 3) {
      await respond({
        text: '❌ Usage: `/admin-contexts add <category> <name> <content>`\n\nExample: `/admin-contexts add security "API Security" "Never expose API keys in logs"`',
        response_type: 'ephemeral',
      });
      return;
    }

    const category = parts[0];
    const name = parts[1].replace(/^["']|["']$/g, ''); // Remove quotes
    const content = parts.slice(2).join(' ');

    const context = ctx.globalContextService.create(
      {
        category,
        name,
        content,
        enabled: true,
        priority: 100,
        scope: 'global',
      },
      userId,
    );

    await respond({
      text: `✅ Created global context: \`${context.id}\`\n\nCategory: ${category}\nName: ${name}\nEnabled: Yes\nPriority: 100`,
      response_type: 'ephemeral',
    });
  } catch (error) {
    logger.error({ error, userId: command.user_id }, 'Failed to add context');
    await respond({
      text: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
      response_type: 'ephemeral',
    });
  }
}

/**
 * Update context content
 * Usage: /admin-contexts update <id> <new_content>
 */
export async function handleUpdateContext(
  args: SlackCommandMiddlewareArgs & AllMiddlewareArgs,
  ctx: AppContext,
) {
  const { ack, respond, command } = args;
  await ack();

  try {
    const userId = command.user_id;
    await ctx.authChecker.checkPermission(userId, Permission.USER_MANAGE);

    const parts = command.text.split(' ').slice(1); // Skip 'update'
    if (parts.length < 2) {
      await respond({
        text: '❌ Usage: `/admin-contexts update <id> <new_content>`',
        response_type: 'ephemeral',
      });
      return;
    }

    const id = parts[0];
    const content = parts.slice(1).join(' ');

    ctx.globalContextService.update(id, { content }, userId);

    await respond({
      text: `✅ Updated context \`${id}\``,
      response_type: 'ephemeral',
    });
  } catch (error) {
    logger.error({ error, userId: command.user_id }, 'Failed to update context');
    await respond({
      text: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
      response_type: 'ephemeral',
    });
  }
}

/**
 * Enable a context
 * Usage: /admin-contexts enable <id>
 */
export async function handleEnableContext(
  args: SlackCommandMiddlewareArgs & AllMiddlewareArgs,
  ctx: AppContext,
) {
  const { ack, respond, command } = args;
  await ack();

  try {
    const userId = command.user_id;
    await ctx.authChecker.checkPermission(userId, Permission.USER_MANAGE);

    const parts = command.text.split(' ').slice(1); // Skip 'enable'
    if (parts.length !== 1) {
      await respond({
        text: '❌ Usage: `/admin-contexts enable <id>`',
        response_type: 'ephemeral',
      });
      return;
    }

    const id = parts[0];
    ctx.globalContextService.setEnabled(id, true, userId);

    await respond({
      text: `✅ Enabled context \`${id}\``,
      response_type: 'ephemeral',
    });
  } catch (error) {
    logger.error({ error, userId: command.user_id }, 'Failed to enable context');
    await respond({
      text: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
      response_type: 'ephemeral',
    });
  }
}

/**
 * Disable a context
 * Usage: /admin-contexts disable <id>
 */
export async function handleDisableContext(
  args: SlackCommandMiddlewareArgs & AllMiddlewareArgs,
  ctx: AppContext,
) {
  const { ack, respond, command } = args;
  await ack();

  try {
    const userId = command.user_id;
    await ctx.authChecker.checkPermission(userId, Permission.USER_MANAGE);

    const parts = command.text.split(' ').slice(1); // Skip 'disable'
    if (parts.length !== 1) {
      await respond({
        text: '❌ Usage: `/admin-contexts disable <id>`',
        response_type: 'ephemeral',
      });
      return;
    }

    const id = parts[0];
    ctx.globalContextService.setEnabled(id, false, userId);

    await respond({
      text: `✅ Disabled context \`${id}\``,
      response_type: 'ephemeral',
    });
  } catch (error) {
    logger.error({ error, userId: command.user_id }, 'Failed to disable context');
    await respond({
      text: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
      response_type: 'ephemeral',
    });
  }
}

/**
 * Delete a context
 * Usage: /admin-contexts delete <id>
 */
export async function handleDeleteContext(
  args: SlackCommandMiddlewareArgs & AllMiddlewareArgs,
  ctx: AppContext,
) {
  const { ack, respond, command } = args;
  await ack();

  try {
    const userId = command.user_id;
    await ctx.authChecker.checkPermission(userId, Permission.USER_MANAGE);

    const parts = command.text.split(' ').slice(1); // Skip 'delete'
    if (parts.length !== 1) {
      await respond({
        text: '❌ Usage: `/admin-contexts delete <id>`',
        response_type: 'ephemeral',
      });
      return;
    }

    const id = parts[0];
    ctx.globalContextService.delete(id, userId);

    await respond({
      text: `✅ Deleted context \`${id}\``,
      response_type: 'ephemeral',
    });
  } catch (error) {
    logger.error({ error, userId: command.user_id }, 'Failed to delete context');
    await respond({
      text: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
      response_type: 'ephemeral',
    });
  }
}

/**
 * Reload file-based contexts
 * Usage: /admin-contexts reload
 */
export async function handleReloadContexts(
  args: SlackCommandMiddlewareArgs & AllMiddlewareArgs,
  ctx: AppContext,
) {
  const { ack, respond, command } = args;
  await ack();

  try {
    const userId = command.user_id;
    await ctx.authChecker.checkPermission(userId, Permission.USER_MANAGE);

    ctx.globalContextService.reloadFileContexts();

    await respond({
      text: `✅ Reloaded file-based contexts and cleared cache`,
      response_type: 'ephemeral',
    });
  } catch (error) {
    logger.error({ error, userId: command.user_id }, 'Failed to reload contexts');
    await respond({
      text: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
      response_type: 'ephemeral',
    });
  }
}

/**
 * Main router for /admin-contexts command
 */
export async function handleAdminContextsCommand(
  args: SlackCommandMiddlewareArgs & AllMiddlewareArgs,
  ctx: AppContext,
) {
  const { command } = args;
  const subcommand = command.text.split(' ')[0];

  switch (subcommand) {
    case 'list':
      return handleListContexts(args, ctx);
    case 'stats':
      return handleContextStats(args, ctx);
    case 'add':
      return handleAddContext(args, ctx);
    case 'update':
      return handleUpdateContext(args, ctx);
    case 'enable':
      return handleEnableContext(args, ctx);
    case 'disable':
      return handleDisableContext(args, ctx);
    case 'delete':
      return handleDeleteContext(args, ctx);
    case 'reload':
      return handleReloadContexts(args, ctx);
    default:
      await args.ack();
      await args.respond({
        text: `📚 *Global Contexts Admin Commands*

\`/admin-contexts list\` - List all contexts
\`/admin-contexts stats\` - Show statistics
\`/admin-contexts add <category> <name> <content>\` - Add new context
\`/admin-contexts update <id> <content>\` - Update context
\`/admin-contexts enable <id>\` - Enable context
\`/admin-contexts disable <id>\` - Disable context
\`/admin-contexts delete <id>\` - Delete context
\`/admin-contexts reload\` - Reload file-based contexts`,
        response_type: 'ephemeral',
      });
  }
}
