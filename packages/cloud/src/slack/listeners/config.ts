import type { App } from '@slack/bolt';
import { Permission, createLogger, generateProjectId, generateId } from '@bematic/common';
import type { AppContext } from '../../context.js';

const logger = createLogger('slack:config');

export function registerConfigListener(app: App, ctx: AppContext) {
  // /bm-config - Open project configuration modal
  app.command('/bm-config', async ({ command, ack, client }) => {
    await ack();

    const { user_id, channel_id, trigger_id } = command;

    try {
      await ctx.authChecker.checkPermission(user_id, Permission.PROJECT_MANAGE);
    } catch {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: ':x: You need admin permissions to configure projects.',
      });
      return;
    }

    // Check if project already exists for this channel
    const existing = ctx.projectResolver.tryResolve(channel_id);

    await client.views.open({
      trigger_id,
      view: {
        type: 'modal',
        callback_id: 'project_config_modal',
        title: { type: 'plain_text', text: 'Project Config' },
        submit: { type: 'plain_text', text: existing ? 'Update' : 'Create' },
        private_metadata: JSON.stringify({ channelId: channel_id }),
        blocks: [
          {
            type: 'input',
            block_id: 'project_name',
            label: { type: 'plain_text', text: 'Project Name' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              initial_value: existing?.name ?? '',
              placeholder: { type: 'plain_text', text: 'e.g. chinoapp' },
            },
          },
          {
            type: 'input',
            block_id: 'local_path',
            label: { type: 'plain_text', text: 'Local Path (on agent machine)' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              initial_value: existing?.localPath ?? '',
              placeholder: { type: 'plain_text', text: 'e.g. F:/Work/Projects/chinoapp' },
            },
          },
          {
            type: 'input',
            block_id: 'agent_id',
            label: { type: 'plain_text', text: 'Agent ID' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              initial_value: existing?.agentId ?? 'agent-local-01',
              placeholder: { type: 'plain_text', text: 'agent-local-01' },
            },
          },
          {
            type: 'input',
            block_id: 'default_model',
            label: { type: 'plain_text', text: 'Default Model' },
            element: {
              type: 'static_select',
              action_id: 'value',
              initial_option: {
                text: { type: 'plain_text', text: existing?.defaultModel === 'claude-opus-4-6' ? 'Claude Opus 4.6' : 'Claude Sonnet 4.5' },
                value: existing?.defaultModel ?? 'claude-sonnet-4-5-20250929',
              },
              options: [
                { text: { type: 'plain_text', text: 'Claude Sonnet 4.5' }, value: 'claude-sonnet-4-5-20250929' },
                { text: { type: 'plain_text', text: 'Claude Opus 4.6' }, value: 'claude-opus-4-6' },
                { text: { type: 'plain_text', text: 'Claude Haiku 4.5' }, value: 'claude-haiku-4-5-20251001' },
              ],
            },
          },
          {
            type: 'input',
            block_id: 'max_budget',
            label: { type: 'plain_text', text: 'Default Max Budget (USD)' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              initial_value: existing?.defaultMaxBudget?.toString() ?? '5.00',
              placeholder: { type: 'plain_text', text: '5.00' },
            },
          },
          { type: 'divider' },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '*Railway Deployment (optional)*\nLink a Railway service for `/bm-admin deploy`' },
          },
          {
            type: 'input',
            block_id: 'railway_project_id',
            optional: true,
            label: { type: 'plain_text', text: 'Railway Project ID' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              initial_value: existing?.railwayProjectId ?? '',
              placeholder: { type: 'plain_text', text: 'UUID from Railway dashboard' },
            },
          },
          {
            type: 'input',
            block_id: 'railway_service_id',
            optional: true,
            label: { type: 'plain_text', text: 'Railway Service ID' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              initial_value: existing?.railwayServiceId ?? '',
              placeholder: { type: 'plain_text', text: 'UUID from Railway dashboard' },
            },
          },
          {
            type: 'input',
            block_id: 'railway_environment_id',
            optional: true,
            label: { type: 'plain_text', text: 'Railway Environment ID' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              initial_value: existing?.railwayEnvironmentId ?? '',
              placeholder: { type: 'plain_text', text: 'Optional - defaults to production' },
            },
          },
        ],
      },
    });
  });

  // Handle modal submission
  app.view('project_config_modal', async ({ view, ack, client, body }) => {
    const meta = JSON.parse(view.private_metadata);
    const channelId = meta.channelId as string;
    const vals = view.state.values;

    const name = vals['project_name']!['value']!.value!;
    const localPath = vals['local_path']!['value']!.value!;
    const agentId = vals['agent_id']!['value']!.value!;
    const defaultModel = vals['default_model']!['value']!.selected_option!.value;
    const maxBudget = parseFloat(vals['max_budget']!['value']!.value!) || 5.0;
    const railwayProjectId = vals['railway_project_id']?.['value']?.value || null;
    const railwayServiceId = vals['railway_service_id']?.['value']?.value || null;
    const railwayEnvironmentId = vals['railway_environment_id']?.['value']?.value || null;

    // Validate
    if (!name || !localPath || !agentId) {
      await ack({
        response_action: 'errors',
        errors: {
          ...(!name ? { project_name: 'Required' } : {}),
          ...(!localPath ? { local_path: 'Required' } : {}),
          ...(!agentId ? { agent_id: 'Required' } : {}),
        },
      });
      return;
    }

    await ack();

    const existing = ctx.projectResolver.tryResolve(channelId);

    if (existing) {
      ctx.projectService.update(existing.id, {
        name,
        localPath,
        agentId,
        defaultModel,
        defaultMaxBudget: maxBudget,
        railwayProjectId,
        railwayServiceId,
        railwayEnvironmentId,
      } as any);

      const railwayInfo = railwayServiceId ? `\n> Railway: \`${railwayServiceId}\`` : '';
      await client.chat.postMessage({
        channel: channelId,
        text: `:white_check_mark: Project *${name}* updated.\n> Path: \`${localPath}\`\n> Agent: \`${agentId}\`\n> Model: \`${defaultModel}\`\n> Budget: $${maxBudget}${railwayInfo}`,
      });
    } else {
      // Auto-provision user as admin if first project
      const userId = body.user?.id;
      if (userId) {
        const dbUser = ctx.userRepo.findBySlackUserId(userId);
        if (!dbUser) {
          ctx.userRepo.create({
            id: generateId('user'),
            slackUserId: userId,
            slackUsername: body.user?.name ?? userId,
            role: 'admin',
          });
        }
      }

      ctx.projectService.create({
        name,
        slackChannelId: channelId,
        localPath,
        agentId,
        defaultModel,
        defaultMaxBudget: maxBudget,
        railwayProjectId,
        railwayServiceId,
        railwayEnvironmentId,
      } as any);

      const railwayInfo = railwayServiceId ? `\n> Railway: \`${railwayServiceId}\`` : '';
      await client.chat.postMessage({
        channel: channelId,
        text: `:white_check_mark: Project *${name}* created!\n> Path: \`${localPath}\`\n> Agent: \`${agentId}\`\n> Model: \`${defaultModel}\`\n> Budget: $${maxBudget}${railwayInfo}\n\nYou can now use \`@BematicManager code <task>\` in this channel.`,
      });
    }

    logger.info({ channelId, name, localPath }, 'Project configured');
  });
}
