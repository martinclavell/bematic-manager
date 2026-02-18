/**
 * Slack Bot Integration - Anthropic API Method
 *
 * This example shows how to use skills with the Anthropic API directly
 * from your Slack bot, combining global instructions and project skills
 */

const { App } = require('@slack/bolt');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Initialize Anthropic client
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// Initialize Slack app
const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN
});

// Configuration
const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');
const GLOBAL_INSTRUCTIONS = path.join(os.homedir(), '.claude', 'CLAUDE.md');
const CHANNEL_TO_PROJECT = {
    'C01234567': '/Users/marti/projects/netsuite-sca-project',
    'C07654321': '/Users/marti/projects/react-dashboard',
    'C09876543': '/Users/marti/projects/python-api'
};

/**
 * Load global instructions
 */
function loadGlobalInstructions() {
    try {
        if (fs.existsSync(GLOBAL_INSTRUCTIONS)) {
            return fs.readFileSync(GLOBAL_INSTRUCTIONS, 'utf8');
        }
    } catch (error) {
        console.error('Error loading global instructions:', error);
    }
    return '';
}

/**
 * Load skills for a project
 */
function loadProjectSkills(projectPath) {
    const skills = [];
    const skillsFile = path.join(projectPath, '.claude-skills');

    try {
        if (fs.existsSync(skillsFile)) {
            const skillNames = fs.readFileSync(skillsFile, 'utf8')
                .split('\n')
                .filter(line => line.trim() && !line.startsWith('#'));

            for (const skillName of skillNames) {
                const skillPath = path.join(SKILLS_DIR, `${skillName.trim()}.md`);
                if (fs.existsSync(skillPath)) {
                    skills.push({
                        name: skillName.trim(),
                        content: fs.readFileSync(skillPath, 'utf8')
                    });
                }
            }
        }
    } catch (error) {
        console.error('Error loading project skills:', error);
    }

    return skills;
}

/**
 * Format skills for system prompt
 */
function formatSkillsForPrompt(skills) {
    if (skills.length === 0) return '';

    return skills
        .map(skill => `## Skill: ${skill.name}\n\n${skill.content}`)
        .join('\n\n---\n\n');
}

/**
 * Main Claude command handler
 */
app.command('/claude', async ({ command, ack, say, client }) => {
    await ack();

    const userMessage = command.text;
    const channelId = command.channel_id;
    const userId = command.user_id;
    const projectPath = CHANNEL_TO_PROJECT[channelId];

    if (!projectPath) {
        await say({
            text: '⚠️ This channel is not mapped to a project.',
            thread_ts: command.ts
        });
        return;
    }

    // Load context
    const globalInstructions = loadGlobalInstructions();
    const projectSkills = loadProjectSkills(projectPath);
    const skillNames = projectSkills.map(s => s.name);

    // Send initial acknowledgment
    const acknowledgment = await say({
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: '🤖 *Thinking...*'
                }
            },
            {
                type: 'context',
                elements: [
                    {
                        type: 'mrkdwn',
                        text: `📁 Project: \`${path.basename(projectPath)}\` | 📚 Skills: ${skillNames.join(', ') || 'none'}`
                    }
                ]
            }
        ]
    });

    try {
        // Construct system prompt
        const systemPrompt = `${globalInstructions}

# Project Context

You are helping with a project located at: ${projectPath}

# Active Skills for This Project

${formatSkillsForPrompt(projectSkills)}

# Instructions

Use the above skills and patterns when providing assistance. Follow all the rules and conventions specified in the skills.`;

        // Call Claude API
        const message = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 8192,
            system: systemPrompt,
            messages: [
                {
                    role: 'user',
                    content: userMessage
                }
            ],
            metadata: {
                user_id: userId,
                project: path.basename(projectPath)
            }
        });

        // Extract response text
        const responseText = message.content[0].text;

        // Update message with response
        await client.chat.update({
            channel: channelId,
            ts: acknowledgment.ts,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: responseText
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
                            text: `👤 <@${userId}> | 🤖 ${message.model} | 📊 ${message.usage.input_tokens}→${message.usage.output_tokens} tokens`
                        }
                    ]
                }
            ]
        });

        // Log usage for monitoring
        console.log('Claude API usage:', {
            input_tokens: message.usage.input_tokens,
            output_tokens: message.usage.output_tokens,
            model: message.model,
            project: path.basename(projectPath)
        });

    } catch (error) {
        console.error('Claude API error:', error);

        await client.chat.update({
            channel: channelId,
            ts: acknowledgment.ts,
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
 * Stream response handler for long responses
 */
app.command('/claude-stream', async ({ command, ack, say, client }) => {
    await ack();

    const userMessage = command.text;
    const channelId = command.channel_id;
    const userId = command.user_id;
    const projectPath = CHANNEL_TO_PROJECT[channelId];

    if (!projectPath) {
        await say('⚠️ This channel is not mapped to a project.');
        return;
    }

    // Load context
    const globalInstructions = loadGlobalInstructions();
    const projectSkills = loadProjectSkills(projectPath);

    // Send initial message
    const message = await say({
        text: '🤖 Thinking...',
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: '🤖 *Generating response...*'
                }
            }
        ]
    });

    try {
        const systemPrompt = `${globalInstructions}

# Active Skills

${formatSkillsForPrompt(projectSkills)}

Project: ${projectPath}`;

        // Create streaming response
        const stream = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 8192,
            system: systemPrompt,
            messages: [
                {
                    role: 'user',
                    content: userMessage
                }
            ],
            stream: true
        });

        let fullResponse = '';
        let updateCounter = 0;

        // Process stream
        for await (const messageStreamEvent of stream) {
            if (messageStreamEvent.type === 'content_block_delta') {
                fullResponse += messageStreamEvent.delta.text;

                // Update message every 10 chunks to avoid rate limits
                updateCounter++;
                if (updateCounter % 10 === 0) {
                    await client.chat.update({
                        channel: channelId,
                        ts: message.ts,
                        blocks: [
                            {
                                type: 'section',
                                text: {
                                    type: 'mrkdwn',
                                    text: fullResponse + ' ▌'
                                }
                            }
                        ]
                    });
                }
            }
        }

        // Final update
        await client.chat.update({
            channel: channelId,
            ts: message.ts,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: fullResponse
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
                            text: `👤 <@${userId}> | 📁 ${path.basename(projectPath)}`
                        }
                    ]
                }
            ]
        });

    } catch (error) {
        console.error('Stream error:', error);
        await client.chat.update({
            channel: channelId,
            ts: message.ts,
            text: `❌ Error: ${error.message}`
        });
    }
});

/**
 * Conversation memory handler
 */
const conversations = new Map(); // In production, use Redis or similar

app.command('/claude-chat', async ({ command, ack, say }) => {
    await ack();

    const userMessage = command.text;
    const channelId = command.channel_id;
    const userId = command.user_id;
    const projectPath = CHANNEL_TO_PROJECT[channelId];

    if (!projectPath) {
        await say('⚠️ This channel is not mapped to a project.');
        return;
    }

    // Get or create conversation
    const conversationKey = `${channelId}-${userId}`;
    let conversation = conversations.get(conversationKey) || [];

    // Add user message
    conversation.push({
        role: 'user',
        content: userMessage
    });

    // Limit conversation history (keep last 10 exchanges)
    if (conversation.length > 20) {
        conversation = conversation.slice(-20);
    }

    try {
        // Load context
        const globalInstructions = loadGlobalInstructions();
        const projectSkills = loadProjectSkills(projectPath);

        const systemPrompt = `${globalInstructions}

# Active Skills

${formatSkillsForPrompt(projectSkills)}

You are having a conversation about the project at: ${projectPath}`;

        // Call API with conversation history
        const message = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 4096,
            system: systemPrompt,
            messages: conversation
        });

        const responseText = message.content[0].text;

        // Add assistant response to conversation
        conversation.push({
            role: 'assistant',
            content: responseText
        });

        // Store updated conversation
        conversations.set(conversationKey, conversation);

        // Send response
        await say({
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: responseText
                    }
                },
                {
                    type: 'context',
                    elements: [
                        {
                            type: 'mrkdwn',
                            text: `💬 Conversation mode | Messages: ${conversation.length}`
                        }
                    ]
                }
            ]
        });

    } catch (error) {
        console.error('Chat error:', error);
        await say(`❌ Error: ${error.message}`);
    }
});

/**
 * Clear conversation history
 */
app.command('/claude-clear', async ({ command, ack, say }) => {
    await ack();

    const channelId = command.channel_id;
    const userId = command.user_id;
    const conversationKey = `${channelId}-${userId}`;

    conversations.delete(conversationKey);

    await say('🧹 Conversation history cleared');
});

// Start the app
(async () => {
    await app.start();
    console.log('⚡️ Slack bot is running with Anthropic API integration!');
})();