import type { App } from '@slack/bolt';
import type { AppContext } from '../../context.js';
import { registerMentionListener } from './mentions.js';
import { registerMessageListener } from './messages.js';
import { registerCommandListeners } from './commands.js';
import { registerActionListeners } from './actions.js';
import { registerConfigListener } from './config.js';
import { registerAdminListener } from './admin.js';
import { registerAgentsResetListener } from './agents-reset.js';

export function registerAllListeners(app: App, ctx: AppContext) {
  registerMentionListener(app, ctx);
  registerMessageListener(app, ctx);
  registerCommandListeners(app, ctx);
  registerActionListeners(app, ctx);
  registerConfigListener(app, ctx);
  registerAdminListener(app, ctx);
  registerAgentsResetListener(app, ctx);
}
