import type { App } from '@slack/bolt';
import type { NetSuiteConfigManager } from '../../core/config/config-manager.js';
import type { NetSuiteClient } from '../../core/client/netsuite-client.js';
import { RecordService } from '../../services/record/record-service.js';
import { NetSuiteSEOService } from '../../services/seo/seo-service.js';
import type { NetSuiteOAuth1Credentials } from '../../types/common.js';

export interface SlackAdapterConfig {
  /** Configuration manager */
  configManager: NetSuiteConfigManager;
  /** Permission checker */
  checkPermission: (userId: string, permission: string) => Promise<void>;
  /** Project resolver */
  resolveProject: (channelId: string) => { id: string; name: string } | null;
  /** Audit logger */
  logAudit: (action: string, resourceType: string, resourceId: string, userId: string, metadata?: any) => void;
}

/**
 * Slack adapter for NetSuite commands
 * Handles /bm netsuite command routing and UI
 */
export class NetSuiteSlackAdapter {
  constructor(
    private readonly app: App,
    private readonly config: SlackAdapterConfig,
  ) {}

  /**
   * Register Slack command listeners
   */
  register(): void {
    this.registerConfigCommand();
    this.registerGetCommand();
    this.registerSEOCommand();
    this.registerTestCommand();
    this.registerConfigModal();
  }

  private registerConfigCommand(): void {
    this.app.command('/bm', async ({ command, ack, client }) => {
      const args = command.text.trim().split(/\s+/);
      if (args[0]?.toLowerCase() !== 'netsuite' || args[1]?.toLowerCase() !== 'config') {
        return; // Not our command
      }

      await ack();

      try {
        await this.config.checkPermission(command.user_id, 'PROJECT_MANAGE');

        const project = this.config.resolveProject(command.channel_id);
        if (!project) {
          await client.chat.postEphemeral({
            channel: command.channel_id,
            user: command.user_id,
            text: ':x: No project configured for this channel.',
          });
          return;
        }

        // Load existing config if any
        const existingConfig = await this.config.configManager.hasConfig(project.id)
          ? await this.config.configManager.getConfig(project.id)
          : null;

        // Open modal
        await this.openConfigModal(client, command.trigger_id, project, existingConfig);
      } catch (error) {
        await client.chat.postEphemeral({
          channel: command.channel_id,
          user: command.user_id,
          text: `:x: ${error instanceof Error ? error.message : 'Failed to open config'}`,
        });
      }
    });
  }

  private registerGetCommand(): void {
    this.app.command('/bm', async ({ command, ack, respond, client }) => {
      const args = command.text.trim().split(/\s+/);
      if (args[0]?.toLowerCase() !== 'netsuite' || args[1]?.toLowerCase() !== 'get') {
        return;
      }

      await ack();

      const recordType = args[2];
      const recordId = args[3];

      if (!recordType || !recordId) {
        await respond(':x: Usage: `/bm netsuite get <type> <id>`');
        return;
      }

      try {
        await this.config.checkPermission(command.user_id, 'TASK_CREATE');

        const project = this.config.resolveProject(command.channel_id);
        if (!project) {
          await respond(':x: No project configured.');
          return;
        }

        const nsClient = await NetSuiteClient.fromProjectId(project.id, this.config.configManager);
        const recordService = new RecordService(nsClient, {
          restletUrl: nsClient.config.restletUrl!,
        });

        const record = await recordService.getRecord(recordType, recordId);

        const json = JSON.stringify(record, null, 2);
        const truncated = json.length > 3000 ? json.slice(0, 3000) + '\n... (truncated)' : json;

        await client.chat.postMessage({
          channel: command.channel_id,
          text: `:white_check_mark: NetSuite ${recordType} ${recordId}:\n\`\`\`${truncated}\`\`\``,
        });

        this.config.logAudit('netsuite:record:fetched', 'netsuite', `${recordType}:${recordId}`, command.user_id, {
          projectId: project.id,
          recordType,
          recordId,
        });
      } catch (error) {
        await respond(`:x: ${error instanceof Error ? error.message : 'Failed to fetch record'}`);
      }
    });
  }

  private registerSEOCommand(): void {
    this.app.command('/bm', async ({ command, ack, respond, client }) => {
      const args = command.text.trim().split(/\s+/);
      if (args[0]?.toLowerCase() !== 'netsuite' || args[1]?.toLowerCase() !== 'seo') {
        return;
      }

      await ack();

      const baseUrl = args[2];
      if (!baseUrl) {
        await respond(':x: Usage: `/bm netsuite seo <url>`');
        return;
      }

      try {
        await this.config.checkPermission(command.user_id, 'TASK_CREATE');

        const project = this.config.resolveProject(command.channel_id);
        if (!project) {
          await respond(':x: No project configured.');
          return;
        }

        const nsClient = await NetSuiteClient.fromProjectId(project.id, this.config.configManager);
        const seoService = new NetSuiteSEOService(nsClient);

        const debugUrl = seoService.buildDebugUrl(baseUrl);

        await client.chat.postMessage({
          channel: command.channel_id,
          text: `:mag: SEO Debug URL:\n${debugUrl}`,
        });

        this.config.logAudit('netsuite:seo:generated', 'netsuite', baseUrl, command.user_id, {
          projectId: project.id,
          baseUrl,
          debugUrl,
        });
      } catch (error) {
        await respond(`:x: ${error instanceof Error ? error.message : 'Failed to generate SEO URL'}`);
      }
    });
  }

  private registerTestCommand(): void {
    this.app.command('/bm', async ({ command, ack, respond }) => {
      const args = command.text.trim().split(/\s+/);
      if (args[0]?.toLowerCase() !== 'netsuite' || args[1]?.toLowerCase() !== 'test') {
        return;
      }

      await ack();

      try {
        await this.config.checkPermission(command.user_id, 'TASK_CREATE');

        const project = this.config.resolveProject(command.channel_id);
        if (!project) {
          await respond(':x: No project configured.');
          return;
        }

        const nsClient = await NetSuiteClient.fromProjectId(project.id, this.config.configManager);

        // Test connection by making simple RESTlet call
        await nsClient.restlet.get(nsClient.config.restletUrl!, { action: 'ping' });

        await respond(':white_check_mark: NetSuite connection successful!');

        this.config.logAudit('netsuite:connection:tested', 'netsuite', project.id, command.user_id, {
          projectId: project.id,
          success: true,
        });
      } catch (error) {
        await respond(`:x: Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });
  }

  private registerConfigModal(): void {
    this.app.view('netsuite_config_modal', async ({ view, ack, client, body }) => {
      const meta = JSON.parse(view.private_metadata);
      const projectId = meta.projectId as string;
      const channelId = meta.channelId as string;
      const vals = view.state.values;

      // Extract values
      const accountId = vals['account_id']!['value']!.value!;
      const productionUrl = vals['production_url']!['value']!.value!;
      const sandboxUrl = vals['sandbox_url']?.['value']?.value;
      const restletUrl = vals['restlet_url']!['value']!.value!;
      let consumerKey = vals['consumer_key']!['value']!.value!;
      let consumerSecret = vals['consumer_secret']!['value']!.value!;
      let tokenId = vals['token_id']!['value']!.value!;
      let tokenSecret = vals['token_secret']!['value']!.value!;

      // If masked, load existing
      if (consumerKey === '••••••••') {
        const existing = await this.config.configManager.getConfig(projectId);
        const creds = existing.credentials as NetSuiteOAuth1Credentials;
        consumerKey = creds.consumerKey;
        consumerSecret = creds.consumerSecret;
        tokenId = creds.tokenId;
        tokenSecret = creds.tokenSecret;
      }

      await ack();

      await this.config.configManager.saveConfig(projectId, {
        account: {
          accountId,
          productionUrl,
          sandboxUrl,
          environment: 'production',
        },
        credentials: {
          consumerKey,
          consumerSecret,
          tokenId,
          tokenSecret,
        },
        restletUrl,
      });

      await client.chat.postMessage({
        channel: channelId,
        text: ':white_check_mark: NetSuite configuration saved!',
      });

      this.config.logAudit('netsuite:config:saved', 'netsuite', projectId, body.user.id, { projectId, accountId });
    });
  }

  private async openConfigModal(client: any, triggerId: string, project: any, existing: any): Promise<void> {
    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: 'netsuite_config_modal',
        title: { type: 'plain_text', text: 'NetSuite Config' },
        submit: { type: 'plain_text', text: 'Save' },
        private_metadata: JSON.stringify({ projectId: project.id, channelId: 'TODO' }),
        blocks: [
          {
            type: 'input',
            block_id: 'account_id',
            label: { type: 'plain_text', text: 'Account ID' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              initial_value: existing?.account.accountId || '',
            },
          },
          {
            type: 'input',
            block_id: 'production_url',
            label: { type: 'plain_text', text: 'Production URL' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              initial_value: existing?.account.productionUrl || '',
            },
          },
          {
            type: 'input',
            block_id: 'sandbox_url',
            optional: true,
            label: { type: 'plain_text', text: 'Sandbox URL' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              initial_value: existing?.account.sandboxUrl || '',
            },
          },
          {
            type: 'input',
            block_id: 'restlet_url',
            label: { type: 'plain_text', text: 'RESTlet URL' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              initial_value: existing?.restletUrl || '',
            },
          },
          {
            type: 'input',
            block_id: 'consumer_key',
            label: { type: 'plain_text', text: 'Consumer Key' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              initial_value: existing ? '••••••••' : '',
            },
          },
          {
            type: 'input',
            block_id: 'consumer_secret',
            label: { type: 'plain_text', text: 'Consumer Secret' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              initial_value: existing ? '••••••••' : '',
            },
          },
          {
            type: 'input',
            block_id: 'token_id',
            label: { type: 'plain_text', text: 'Token ID' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              initial_value: existing ? '••••••••' : '',
            },
          },
          {
            type: 'input',
            block_id: 'token_secret',
            label: { type: 'plain_text', text: 'Token Secret' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              initial_value: existing ? '••••••••' : '',
            },
          },
        ],
      },
    });
  }
}
