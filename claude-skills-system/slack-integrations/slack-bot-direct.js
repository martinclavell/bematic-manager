/**
 * Slack Bot Integration - Direct Injection Method
 *
 * This example shows how to load skills and inject them directly
 * into the prompt before sending to Claude Code
 */

const { App } = require('@slack/bolt');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Your Slack app credentials
const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN
});

// Map Slack channels to project directories
const CHANNEL_TO_PROJECT = {
    'C01234567': '/Users/marti/projects/netsuite-sca-project',
    'C07654321': '/Users/marti/projects/react-dashboard',
    'C09876543': '/Users/marti/projects/python-api'
};

// Path to the skills loader script
const SKILLS_LOADER = path.join(process.env.HOME, 'bin', 'load-skills');

/**
 * Load skills for a specific project
 */
function loadSkillsForProject(projectPath) {
    try {
        // Execute the skills loader
        const skillsContext = execSync(`"${SKILLS_LOADER}" --silent "${projectPath}"`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'inherit'] // stderr to console, stdout captured
        });

        return skillsContext;
    } catch (error) {
        console.error(`Failed to load skills for ${projectPath}:`, error.message);
        return '';
    }
}

/**
 * Get active skills list for a project (for display)
 */
function getActiveSkills(projectPath) {
    try {
        const skillsFile = path.join(projectPath, '.claude-skills');
        if (fs.existsSync(skillsFile)) {
            const content = fs.readFileSync(skillsFile, 'utf8');
            return content
                .split('\n')
                .filter(line => line.trim() && !line.startsWith('#'))
                .map(skill => skill.trim());
        }
    } catch (error) {
        console.error('Error reading skills file:', error);
    }
    return [];
}

/**
 * Main command handler
 */
app.command('/claude', async ({ command, ack, say, client }) => {
    // Acknowledge command receipt
    await ack();

    const userMessage = command.text;
    const channelId = command.channel_id;
    const userId = command.user_id;

    // Get project path from channel mapping
    const projectPath = CHANNEL_TO_PROJECT[channelId];

    if (!projectPath) {
        await say({
            text: '⚠️ This channel is not mapped to a project. Please contact your administrator.',
            thread_ts: command.ts
        });
        return;
    }

    // Send initial acknowledgment
    const activeSkills = getActiveSkills(projectPath);
    const acknowledgment = await say({
        text: `🤖 Processing your request...`,
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `🤖 *Processing your request...*`
                }
            },
            {
                type: 'context',
                elements: [
                    {
                        type: 'mrkdwn',
                        text: `📁 Project: \`${path.basename(projectPath)}\``
                    },
                    {
                        type: 'mrkdwn',
                        text: `📚 Skills: ${activeSkills.length > 0 ? activeSkills.map(s => `\`${s}\``).join(', ') : '_none_'}`
                    }
                ]
            }
        ]
    });

    try {
        // Load skills context
        const skillsContext = loadSkillsForProject(projectPath);

        // Construct the enhanced prompt
        const enhancedPrompt = `# Active Skills

${skillsContext}

---

# User Request

${userMessage}

---

Project Path: ${projectPath}`;

        // Send to Claude Code (implement your integration here)
        const response = await sendToClaudeCode(enhancedPrompt, projectPath);

        // Update the message with the response
        await client.chat.update({
            channel: channelId,
            ts: acknowledgment.ts,
            text: response.text || 'Response received',
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: response.text
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'context',
                    elements: [
                        {
                            type: 'mrkdwn',
                            text: `👤 <@${userId}> | 📁 \`${path.basename(projectPath)}\` | 📚 Skills: ${activeSkills.join(', ') || 'none'}`
                        }
                    ]
                }
            ]
        });

    } catch (error) {
        console.error('Error processing Claude request:', error);

        await client.chat.update({
            channel: channelId,
            ts: acknowledgment.ts,
            text: '❌ An error occurred',
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `❌ *Error:* ${error.message}`
                    }
                }
            ]
        });
    }
});

/**
 * Handle slash command to manage skills
 */
app.command('/claude-skills', async ({ command, ack, say }) => {
    await ack();

    const [subcommand, ...args] = command.text.split(' ');
    const channelId = command.channel_id;
    const projectPath = CHANNEL_TO_PROJECT[channelId];

    if (!projectPath) {
        await say('⚠️ This channel is not mapped to a project.');
        return;
    }

    switch (subcommand) {
        case 'list':
            const activeSkills = getActiveSkills(projectPath);
            await say({
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*Active Skills for ${path.basename(projectPath)}:*`
                        }
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: activeSkills.length > 0
                                ? activeSkills.map(skill => `• \`${skill}\``).join('\n')
                                : '_No active skills_'
                        }
                    }
                ]
            });
            break;

        case 'add':
            const skillToAdd = args[0];
            if (!skillToAdd) {
                await say('Usage: `/claude-skills add <skill-name>`');
                return;
            }

            try {
                execSync(`cd "${projectPath}" && claude-skills add ${skillToAdd}`, {
                    encoding: 'utf8'
                });
                await say(`✅ Added skill: \`${skillToAdd}\``);
            } catch (error) {
                await say(`❌ Failed to add skill: ${error.message}`);
            }
            break;

        case 'remove':
            const skillToRemove = args[0];
            if (!skillToRemove) {
                await say('Usage: `/claude-skills remove <skill-name>`');
                return;
            }

            try {
                execSync(`cd "${projectPath}" && claude-skills remove ${skillToRemove}`, {
                    encoding: 'utf8'
                });
                await say(`✅ Removed skill: \`${skillToRemove}\``);
            } catch (error) {
                await say(`❌ Failed to remove skill: ${error.message}`);
            }
            break;

        default:
            await say({
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '*Claude Skills Commands:*'
                        }
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '• `/claude-skills list` - Show active skills\n' +
                                  '• `/claude-skills add <skill>` - Add a skill\n' +
                                  '• `/claude-skills remove <skill>` - Remove a skill'
                        }
                    }
                ]
            });
    }
});

/**
 * Mock function - Replace with your actual Claude Code integration
 */
async function sendToClaudeCode(prompt, projectPath) {
    // This is where you would integrate with Claude Code
    // For example:
    // - Direct API call to Anthropic
    // - Call to your Claude Code server
    // - Integration with VSCode extension

    console.log('Sending to Claude Code:', {
        promptLength: prompt.length,
        projectPath: projectPath
    });

    // Mock response
    return {
        text: "I've analyzed your request with the active skills context. Here's what I would do:\n\n" +
              "1. First, I would examine the existing code structure\n" +
              "2. Then implement the requested feature following the patterns from the active skills\n" +
              "3. Finally, ensure all tests pass\n\n" +
              "_This is a mock response. Implement your actual Claude Code integration here._"
    };
}

// Start the app
(async () => {
    await app.start();
    console.log('⚡️ Slack bot is running with skills integration!');
})();