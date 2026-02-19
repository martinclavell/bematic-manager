import type { App } from '@slack/bolt';
import { Permission, createLogger } from '@bematic/common';
import type { AppContext } from '../../context.js';

const logger = createLogger('slack:netsuite-command');

/**
 * /bm netsuite command handler
 * Manages NetSuite configuration and operations
 */
export function registerNetSuiteCommandListener(app: App, ctx: AppContext) {
  app.command('/bm', async ({ command, ack, respond, client }) => {
    const { user_id, channel_id, text, trigger_id } = command;
    const args = text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase();

    // Only handle 'netsuite' subcommand
    if (subcommand !== 'netsuite') {
      return; // Let other handlers process it
    }

    await ack();

    const netsuiteSubcommand = args[1]?.toLowerCase() || 'help';
    const subArgs = args.slice(2);

    logger.info({ user: user_id, netsuiteSubcommand, text }, '/bm netsuite command received');

    try {
      switch (netsuiteSubcommand) {
        // ===== CONFIG =====
        case 'config':
        case 'configure':
        case 'setup': {
          await ctx.authChecker.checkPermission(user_id, Permission.PROJECT_MANAGE);

          const project = ctx.projectResolver.tryResolve(channel_id);
          if (!project) {
            await respond(':x: No project configured for this channel. Use `/bm config` first.');
            return;
          }

          const existingConfig = await ctx.netsuiteService.getConfig(project.id);

          await client.views.open({
            trigger_id,
            view: {
              type: 'modal',
              callback_id: 'netsuite_config_modal',
              title: { type: 'plain_text', text: 'NetSuite Config' },
              submit: { type: 'plain_text', text: existingConfig ? 'Update' : 'Save' },
              private_metadata: JSON.stringify({ projectId: project.id, channelId: channel_id }),
              blocks: [
                {
                  type: 'section',
                  text: { type: 'mrkdwn', text: `*Project:* ${project.name}` },
                },
                { type: 'divider' },
                {
                  type: 'input',
                  block_id: 'account_number',
                  label: { type: 'plain_text', text: 'Account Number' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    initial_value: existingConfig?.accountNumber ?? '',
                    placeholder: { type: 'plain_text', text: 'e.g. 1234567' },
                  },
                },
                {
                  type: 'input',
                  block_id: 'production_url',
                  label: { type: 'plain_text', text: 'Production URL' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    initial_value: existingConfig?.productionUrl ?? '',
                    placeholder: { type: 'plain_text', text: 'https://1234567.app.netsuite.com' },
                  },
                },
                {
                  type: 'input',
                  block_id: 'sandbox_url',
                  optional: true,
                  label: { type: 'plain_text', text: 'Sandbox URL (optional)' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    initial_value: existingConfig?.sandboxUrl ?? '',
                    placeholder: { type: 'plain_text', text: 'https://1234567-sb1.app.netsuite.com' },
                  },
                },
                {
                  type: 'input',
                  block_id: 'restlet_url',
                  label: { type: 'plain_text', text: 'RESTlet URL' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    initial_value: existingConfig?.restletUrl ?? '',
                    placeholder: { type: 'plain_text', text: 'https://1234567.restlets.api.netsuite.com/...' },
                  },
                },
                { type: 'divider' },
                {
                  type: 'section',
                  text: { type: 'mrkdwn', text: '*OAuth 1.0 Credentials*' },
                },
                {
                  type: 'input',
                  block_id: 'consumer_key',
                  label: { type: 'plain_text', text: 'Consumer Key' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    initial_value: existingConfig ? '••••••••' : '',
                    placeholder: { type: 'plain_text', text: 'OAuth Consumer Key' },
                  },
                },
                {
                  type: 'input',
                  block_id: 'consumer_secret',
                  label: { type: 'plain_text', text: 'Consumer Secret' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    initial_value: existingConfig ? '••••••••' : '',
                    placeholder: { type: 'plain_text', text: 'OAuth Consumer Secret' },
                  },
                },
                {
                  type: 'input',
                  block_id: 'token_id',
                  label: { type: 'plain_text', text: 'Token ID' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    initial_value: existingConfig ? '••••••••' : '',
                    placeholder: { type: 'plain_text', text: 'OAuth Token ID' },
                  },
                },
                {
                  type: 'input',
                  block_id: 'token_secret',
                  label: { type: 'plain_text', text: 'Token Secret' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    initial_value: existingConfig ? '••••••••' : '',
                    placeholder: { type: 'plain_text', text: 'OAuth Token Secret' },
                  },
                },
                {
                  type: 'context',
                  elements: [
                    { type: 'mrkdwn', text: '_Credentials are encrypted and stored securely_' },
                  ],
                },
              ],
            },
          });
          break;
        }

        // ===== GET =====
        case 'get':
        case 'fetch': {
          await ctx.authChecker.checkPermission(user_id, Permission.TASK_CREATE);

          const project = ctx.projectResolver.tryResolve(channel_id);
          if (!project) {
            await respond(':x: No project configured for this channel. Use `/bm config` first.');
            return;
          }

          const recordType = subArgs[0];
          const recordId = subArgs[1];

          if (!recordType || !recordId) {
            await respond(':x: Usage: `/bm netsuite get <record-type> <record-id>`\n\nExample: `/bm netsuite get customer 1233`');
            return;
          }

          await respond(':hourglass_flowing_sand: Fetching NetSuite record...');

          try {
            const data = await ctx.netsuiteService.fetchRecord(project.id, recordType, recordId);

            const jsonStr = JSON.stringify(data, null, 2);
            const truncated = jsonStr.length > 3000 ? jsonStr.slice(0, 3000) + '\n... (truncated)' : jsonStr;

            await client.chat.postMessage({
              channel: channel_id,
              text: `:white_check_mark: *NetSuite Record:* ${recordType} ${recordId}`,
              blocks: [
                {
                  type: 'section',
                  text: { type: 'mrkdwn', text: `:white_check_mark: *NetSuite Record:* \`${recordType}\` \`${recordId}\`` },
                },
                {
                  type: 'section',
                  text: { type: 'mrkdwn', text: `\`\`\`${truncated}\`\`\`` },
                },
              ],
            });

            ctx.auditLogRepo.log(
              'netsuite:record:fetched',
              'netsuite',
              `${recordType}:${recordId}`,
              user_id,
              { projectId: project.id, recordType, recordId }
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            await client.chat.postMessage({
              channel: channel_id,
              text: `:x: Failed to fetch NetSuite record: ${message}`,
            });
          }
          break;
        }

        // ===== SEO =====
        case 'seo':
        case 'seo-debug': {
          await ctx.authChecker.checkPermission(user_id, Permission.TASK_CREATE);

          const project = ctx.projectResolver.tryResolve(channel_id);
          if (!project) {
            await respond(':x: No project configured for this channel. Use `/bm config` first.');
            return;
          }

          const baseUrl = subArgs[0];
          if (!baseUrl) {
            await respond(':x: Usage: `/bm netsuite seo <url>`\n\nExample: `/bm netsuite seo www.christianartgifts.com`');
            return;
          }

          const debugUrl = ctx.netsuiteService.buildSEODebugUrl(baseUrl);

          await client.chat.postMessage({
            channel: channel_id,
            text: `:mag: *SEO Debug URL Generated*`,
            blocks: [
              {
                type: 'section',
                text: { type: 'mrkdwn', text: `:mag: *SEO Debug URL for:* \`${baseUrl}\`` },
              },
              {
                type: 'section',
                text: { type: 'mrkdwn', text: `<${debugUrl}|Open Debug URL>` },
              },
              {
                type: 'context',
                elements: [
                  { type: 'mrkdwn', text: '_Parameters: `seodebug=T`, `preview=<timestamp>`, `seonojscache=T`_' },
                ],
              },
            ],
          });

          ctx.auditLogRepo.log(
            'netsuite:seo:analyzed',
            'netsuite',
            baseUrl,
            user_id,
            { projectId: project.id, baseUrl, debugUrl }
          );
          break;
        }

        // ===== TEST =====
        case 'test':
        case 'test-connection': {
          await ctx.authChecker.checkPermission(user_id, Permission.TASK_CREATE);

          const project = ctx.projectResolver.tryResolve(channel_id);
          if (!project) {
            await respond(':x: No project configured for this channel. Use `/bm config` first.');
            return;
          }

          await respond(':hourglass_flowing_sand: Testing NetSuite connection...');

          const result = await ctx.netsuiteService.testConnection(project.id);

          const icon = result.success ? ':white_check_mark:' : ':x:';
          await client.chat.postMessage({
            channel: channel_id,
            text: `${icon} ${result.message}`,
          });

          ctx.auditLogRepo.log(
            'netsuite:connection:tested',
            'netsuite',
            project.id,
            user_id,
            { projectId: project.id, success: result.success }
          );
          break;
        }

        // ===== HELP =====
        case 'help':
        case '?':
        default:
          await respond(
            '*NetSuite Integration - /bm netsuite*\n\n' +
            '*Configuration:*\n' +
            '`/bm netsuite config` - Configure NetSuite credentials & endpoints\n\n' +
            '*Operations:*\n' +
            '`/bm netsuite get <type> <id>` - Fetch record via RESTlet (e.g. `customer 1233`)\n' +
            '`/bm netsuite seo <url>` - Generate SEO debug URL with prerender flags\n' +
            '`/bm netsuite test` - Test NetSuite connection & authentication\n\n' +
            '*Examples:*\n' +
            '• `/bm netsuite get customer 1233`\n' +
            '• `/bm netsuite seo www.christianartgifts.com`\n'
          );
          break;
      }
    } catch (error) {
      logger.error({ error, netsuiteSubcommand }, 'Error handling /bm netsuite command');
      const message = error instanceof Error ? error.message : 'An unexpected error occurred';
      await respond(`:x: ${message}`);
    }
  });

  // Handle modal submission
  app.view('netsuite_config_modal', async ({ view, ack, client, body }) => {
    const meta = JSON.parse(view.private_metadata);
    const projectId = meta.projectId as string;
    const channelId = meta.channelId as string;
    const vals = view.state.values;

    const accountNumber = vals['account_number']!['value']!.value!;
    const productionUrl = vals['production_url']!['value']!.value!;
    const sandboxUrl = vals['sandbox_url']?.['value']?.value || undefined;
    const restletUrl = vals['restlet_url']!['value']!.value!;
    const consumerKey = vals['consumer_key']!['value']!.value!;
    const consumerSecret = vals['consumer_secret']!['value']!.value!;
    const tokenId = vals['token_id']!['value']!.value!;
    const tokenSecret = vals['token_secret']!['value']!.value!;

    // Validate required fields
    if (!accountNumber || !productionUrl || !restletUrl || !consumerKey || !consumerSecret || !tokenId || !tokenSecret) {
      await ack({
        response_action: 'errors',
        errors: {
          ...(!accountNumber ? { account_number: 'Required' } : {}),
          ...(!productionUrl ? { production_url: 'Required' } : {}),
          ...(!restletUrl ? { restlet_url: 'Required' } : {}),
          ...(!consumerKey ? { consumer_key: 'Required' } : {}),
          ...(!consumerSecret ? { consumer_secret: 'Required' } : {}),
          ...(!tokenId ? { token_id: 'Required' } : {}),
          ...(!tokenSecret ? { token_secret: 'Required' } : {}),
        },
      });
      return;
    }

    // If credentials are masked (••••••••), fetch existing values
    const existingConfig = await ctx.netsuiteService.getConfig(projectId);
    const finalConsumerKey = consumerKey === '••••••••' && existingConfig ? existingConfig.consumerKey : consumerKey;
    const finalConsumerSecret = consumerSecret === '••••••••' && existingConfig ? existingConfig.consumerSecret : consumerSecret;
    const finalTokenId = tokenId === '••••••••' && existingConfig ? existingConfig.tokenId : tokenId;
    const finalTokenSecret = tokenSecret === '••••••••' && existingConfig ? existingConfig.tokenSecret : tokenSecret;

    await ack();

    try {
      await ctx.netsuiteService.saveConfig(projectId, {
        accountNumber,
        productionUrl,
        sandboxUrl,
        restletUrl,
        consumerKey: finalConsumerKey,
        consumerSecret: finalConsumerSecret,
        tokenId: finalTokenId,
        tokenSecret: finalTokenSecret,
      });

      await client.chat.postMessage({
        channel: channelId,
        text: `:white_check_mark: NetSuite configuration ${existingConfig ? 'updated' : 'saved'}!\n` +
          `> Account: \`${accountNumber}\`\n` +
          `> Production: \`${productionUrl}\`\n` +
          (sandboxUrl ? `> Sandbox: \`${sandboxUrl}\`\n` : '') +
          `> RESTlet: \`${restletUrl}\`\n\n` +
          'You can now use `/bm netsuite get` and `/bm netsuite seo` commands.',
      });

      ctx.auditLogRepo.log(
        existingConfig ? 'netsuite:config:updated' : 'netsuite:config:created',
        'netsuite',
        projectId,
        body.user?.id,
        { projectId, accountNumber }
      );

      logger.info({ projectId, accountNumber }, 'NetSuite config saved');
    } catch (error) {
      logger.error({ error, projectId }, 'Failed to save NetSuite config');
      await client.chat.postMessage({
        channel: channelId,
        text: ':x: Failed to save NetSuite configuration. Please try again.',
      });
    }
  });
}
