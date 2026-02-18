import type { App } from '@slack/bolt';
import type { AppContext } from '../../context.js';
import { registerMentionListener } from './mentions.js';
import { registerMessageListener } from './messages.js';
import { registerCommandListeners } from './commands.js';
import { registerActionListeners } from './actions.js';
import { registerBmCommandListener, registerConfigModalHandler } from './bm-command.js';
import { registerAdminListener } from './admin.js';
import { registerAgentsResetListener } from './agents-reset.js';

export function registerAllListeners(app: App, ctx: AppContext) {
  registerMentionListener(app, ctx);
  registerMessageListener(app, ctx);
  registerBmCommandListener(app, ctx); // New unified /bm command
  registerConfigModalHandler(app, ctx); // Config modal submission handler
  registerCommandListeners(app, ctx); // Legacy bot-specific commands (deprecated)
  registerActionListeners(app, ctx);
  registerAdminListener(app, ctx); // Keep for backwards compatibility
  registerAgentsResetListener(app, ctx);
}
