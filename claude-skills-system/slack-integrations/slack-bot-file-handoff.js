/**
 * Slack Bot Integration - File Handoff Method
 *
 * This example shows how to write skills context to a temporary file
 * that Claude Code can read on startup
 */

const { App } = require('@slack/bolt');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Initialize Slack app
const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN
});

// Configuration
const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');
const CONTEXT_DIR = path.join(os.tmpdir(), 'claude-contexts');
const CHANNEL_TO_PROJECT = {
    'C01234567': '/Users/marti/projects/netsuite-sca-project',
    'C07654321': '/Users/marti/projects/react-dashboard',
    'C09876543': '/Users/marti/projects/python-api'
};

// Ensure context directory exists
if (!fs.existsSync(CONTEXT_DIR)) {
    fs.mkdirSync(CONTEXT_DIR, { recursive: true });
}

/**
 * Generate session ID
 */
function generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
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
                    const content = fs.readFileSync(skillPath, 'utf8');
                    skills.push({
                        name: skillName.trim(),
                        content: content
                    });
                }
            }
        }
    } catch (error) {
        console.error('Error loading skills:', error);
    }

    return skills;
}

/**
 * Write context file for Claude Code
 */
function writeContextFile(sessionId, userMessage, projectPath, skills) {
    const contextPath = path.join(CONTEXT_DIR, `claude-context-${sessionId}.md`);

    const content = `# Claude Code Session Context

**Session ID:** ${sessionId}
**Generated:** ${new Date().toISOString()}
**Project:** ${projectPath}

## Active Skills

${skills.map(skill => `### ${skill.name}\n\n${skill.content}`).join('\n\n---\n\n')}

---

## User Request

${userMessage}

---

## Instructions

1. Read and follow all patterns and conventions from the active skills above
2. Work within the project directory: ${projectPath}
3. Apply the domain knowledge from the skills to solve the user's request
4. This context file can be deleted after processing
`;

    fs.writeFileSync(contextPath, content, 'utf8');
    return contextPath;
}

/**
 * Clean up old context files (older than 1 hour)
 */
function cleanupOldContextFiles() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    try {
        const files = fs.readdirSync(CONTEXT_DIR);
        for (const file of files) {
            if (file.startsWith('claude-context-')) {
                const filePath = path.join(CONTEXT_DIR, file);
                const stats = fs.statSync(filePath);
                if (stats.mtime.getTime() < oneHourAgo) {
                    fs.unlinkSync(filePath);
                    console.log(`Cleaned up old context file: ${file}`);
                }
            }
        }
    } catch (error) {
        console.error('Error cleaning up context files:', error);
    }
}

// Run cleanup every 30 minutes
setInterval(cleanupOldContextFiles, 30 * 60 * 1000);

/**
 * Launch Claude Code with context
 */
async function launchClaudeCode(contextFile, projectPath) {
    // Example: Launch VS Code with Claude extension
    // Adjust this based on your Claude Code integration

    return new Promise((resolve, reject) => {
        const args = [
            projectPath,                    // Open project directory
            '--goto', contextFile,          // Open context file
            '--new-window'                  // New window for isolation
        ];

        const vscode = spawn('code', args, {
            detached: true,
            stdio: 'ignore'
        });

        vscode.unref();

        vscode.on('error', reject);
        vscode.on('exit', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`VS Code exited with code ${code}`));
            }
        });

        // Give VS Code time to start
        setTimeout(resolve, 2000);
    });
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

    // Generate session ID
    const sessionId = generateSessionId();

    // Load skills
    const skills = loadProjectSkills(projectPath);
    const skillNames = skills.map(s => s.name);

    // Send acknowledgment with session info
    const acknowledgment = await say({
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: '🚀 *Preparing Claude Code session...*'
                }
            },
            {
                type: 'section',
                fields: [
                    {
                        type: 'mrkdwn',
                        text: `*Session ID:*\n\`${sessionId}\``
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Project:*\n\`${path.basename(projectPath)}\``
                    }
                ]
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Active Skills:* ${skillNames.length > 0 ? skillNames.map(s => `\`${s}\``).join(', ') : '_none_'}`
                }
            }
        ]
    });

    try {
        // Write context file
        const contextFile = writeContextFile(sessionId, userMessage, projectPath, skills);

        // Launch Claude Code (or trigger your integration)
        await launchClaudeCode(contextFile, projectPath);

        // Update message with success
        await client.chat.update({
            channel: channelId,
            ts: acknowledgment.ts,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '✅ *Claude Code session started*'
                    }
                },
                {
                    type: 'section',
                    fields: [
                        {
                            type: 'mrkdwn',
                            text: `*Session ID:*\n\`${sessionId}\``
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Context File:*\n\`${path.basename(contextFile)}\``
                        }
                    ]
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*Your Request:*\n> ${userMessage}`
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
                            text: `The context file will be automatically cleaned up after 1 hour`
                        }
                    ]
                }
            ]
        });

        // Log session info
        console.log('Claude Code session started:', {
            sessionId,
            projectPath,
            contextFile,
            skills: skillNames
        });

    } catch (error) {
        console.error('Error starting Claude Code:', error);

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
 * Manual context file viewer
 */
app.command('/claude-context', async ({ command, ack, say }) => {
    await ack();

    const sessionId = command.text.trim();

    if (!sessionId) {
        // List all active context files
        try {
            const files = fs.readdirSync(CONTEXT_DIR)
                .filter(f => f.startsWith('claude-context-'))
                .map(f => {
                    const stats = fs.statSync(path.join(CONTEXT_DIR, f));
                    const match = f.match(/claude-context-([a-f0-9]+)\.md/);
                    return {
                        sessionId: match ? match[1] : 'unknown',
                        created: stats.mtime,
                        size: stats.size
                    };
                })
                .sort((a, b) => b.created - a.created);

            if (files.length === 0) {
                await say('No active context files found.');
                return;
            }

            const blocks = [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*Active Context Files:*'
                    }
                }
            ];

            files.slice(0, 10).forEach(file => {
                blocks.push({
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `• \`${file.sessionId}\` - ${file.created.toLocaleString()} (${(file.size / 1024).toFixed(1)} KB)`
                    }
                });
            });

            await say({ blocks });
        } catch (error) {
            await say(`❌ Error listing context files: ${error.message}`);
        }
        return;
    }

    // View specific context file
    const contextFile = path.join(CONTEXT_DIR, `claude-context-${sessionId}.md`);

    if (!fs.existsSync(contextFile)) {
        await say(`❌ Context file not found for session: \`${sessionId}\``);
        return;
    }

    try {
        const content = fs.readFileSync(contextFile, 'utf8');
        const stats = fs.statSync(contextFile);

        // Extract first few lines for preview
        const lines = content.split('\n');
        const preview = lines.slice(0, 20).join('\n');
        const hasMore = lines.length > 20;

        await say({
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*Context File Preview:* \`${sessionId}\``
                    }
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `\`\`\`\n${preview}\n\`\`\`${hasMore ? `\n_...and ${lines.length - 20} more lines_` : ''}`
                    }
                },
                {
                    type: 'context',
                    elements: [
                        {
                            type: 'mrkdwn',
                            text: `Created: ${stats.mtime.toLocaleString()} | Size: ${(stats.size / 1024).toFixed(1)} KB`
                        }
                    ]
                }
            ]
        });
    } catch (error) {
        await say(`❌ Error reading context file: ${error.message}`);
    }
});

/**
 * Alternative: Write context to a shared location
 */
app.command('/claude-prepare', async ({ command, ack, say }) => {
    await ack();

    const userMessage = command.text;
    const channelId = command.channel_id;
    const projectPath = CHANNEL_TO_PROJECT[channelId];

    if (!projectPath) {
        await say('⚠️ This channel is not mapped to a project.');
        return;
    }

    // Generate session info
    const sessionId = generateSessionId();
    const skills = loadProjectSkills(projectPath);

    // Write context file to project directory (alternative approach)
    const projectContextFile = path.join(projectPath, `.claude-context-${sessionId}.md`);
    const content = `# Claude Code Context

**Request:** ${userMessage}
**Generated:** ${new Date().toISOString()}

## Active Skills

${skills.map(s => `### ${s.name}\n\n${s.content}`).join('\n\n---\n\n')}
`;

    fs.writeFileSync(projectContextFile, content);

    await say({
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: '✅ *Context file created in project directory*'
                }
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `\`\`\`\n${projectContextFile}\n\`\`\``
                }
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `Claude Code can now read this file when working on your project.\n\nYour request:\n> ${userMessage}`
                }
            }
        ]
    });
});

// Start the app
(async () => {
    await app.start();
    console.log('⚡️ Slack bot is running with file handoff integration!');

    // Initial cleanup
    cleanupOldContextFiles();
})();